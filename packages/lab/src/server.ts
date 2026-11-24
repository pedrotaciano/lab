/**
 * The lab HTTP/WebSocket server: REST API over teams and chats, `/ws` for the
 * estado stream and per-chat transcript frames, and the web UI.
 */
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";
import type { Server, ServerWebSocket } from "bun";
import { Anexos } from "./anexos";
import { ChatProcess, ErroLab, type SinalChat, sortearNome } from "./chat";
import { type EnviarFrame, PonteChat } from "./frames";
import { detectarEgregore, MemoriaEgregore } from "./memoria";
import { type RegistroChat, Store } from "./store";
import type { Autor, Estado, MensagemCliente, MensagemServidor, ResumoChat, Time } from "./tipos";
import { lerLoginDoDono } from "./tailscale";
import { Transcricao } from "./transcricao";
import pagina from "../web/index.html";

const WEB = path.resolve(import.meta.dir, "../web");
const ARTE = path.join(WEB, "arte");
const INTERVALO_ESTADO_MS = 100;
const INTERVALO_PASTAS_MS = 10_000;

interface DadosSocket {
	autor: Autor;
	/** chatId → frame sink registered on that chat's bridge. */
	assinaturas: Map<string, EnviarFrame>;
}

type Socket = ServerWebSocket<DadosSocket>;

export interface OpcoesServidor {
	host: string;
	port: number;
}

export class Laboratorio {
	readonly #store: Store;
	readonly #anexos: Anexos;
	readonly #transcricao = new Transcricao();
	readonly #chats = new Map<string, ChatProcess>();
	readonly #pontes = new Map<string, PonteChat>();
	readonly #sockets = new Set<Socket>();
	readonly #ausentes = new Set<string>();
	/** Egregore teams (team id → its memory). */
	readonly #memorias = new Map<string, MemoriaEgregore>();
	#servidor: Server<DadosSocket> | null = null;
	#dono: Autor | null = null;
	/** This Mac's own tailnet login: a visitor through `tailscale serve` with it is the owner. */
	#loginTailscaleDono: string | null = null;
	#voz: boolean | null = null;
	#timerEstado: NodeJS.Timeout | undefined;
	#ultimoEstado = 0;
	#timerPastas: NodeJS.Timeout | undefined;

	constructor(casa: string) {
		this.#store = new Store(casa);
		this.#anexos = new Anexos(casa);
	}

	get url(): string | null {
		const servidor = this.#servidor;
		return servidor ? `http://${servidor.hostname}:${servidor.port}` : null;
	}

	/** Load state and listen on `port`, or the next free port above it. */
	async iniciar(opcoes: OpcoesServidor): Promise<string> {
		await this.#store.carregar();
		for (const registro of this.#store.chats) this.#registrarChat(registro);
		this.#dono = await donoDaMaquina();
		await Promise.all([this.#verificarPastas(), this.#verificarTailscale()]);
		this.#timerPastas = setInterval(() => {
			void this.#verificarPastas();
			void this.#verificarTailscale();
		}, INTERVALO_PASTAS_MS);
		let ultimoErro: unknown;
		for (let porta = opcoes.port; porta < opcoes.port + 20; porta++) {
			// A wildcard listener (`*:port`) does not stop a bind to 127.0.0.1 on macOS, yet takes its connections.
			if (await alguemOuve(opcoes.host, porta)) continue;
			try {
				this.#servidor = this.#servir(opcoes.host, porta);
				return this.url!;
			} catch (err) {
				if (!emUso(err)) throw err;
				ultimoErro = err;
			}
		}
		throw ultimoErro ?? new Error(`nenhuma porta livre entre ${opcoes.port} e ${opcoes.port + 19}`);
	}

	/** Stop every omp and the server. */
	async parar(): Promise<void> {
		clearInterval(this.#timerPastas);
		clearTimeout(this.#timerEstado);
		this.#transcricao.parar();
		for (const memoria of this.#memorias.values()) memoria.fechar();
		this.#memorias.clear();
		for (const ponte of this.#pontes.values()) ponte.fechar();
		this.#pontes.clear();
		await Promise.all([...this.#chats.values()].map(chat => chat.encerrar()));
		await this.#store.gravado();
		this.#servidor?.stop(true);
		this.#servidor = null;
	}

	estado(): Estado {
		const pessoas = new Map<string, Autor>();
		for (const socket of this.#sockets) pessoas.set(socket.data.autor.login, socket.data.autor);
		return {
			times: this.#store.times.map(time => this.#timeDoEstado(time)),
			chats: this.#store.chats.map(registro => this.#chats.get(registro.id)!.resumo()),
			pessoas: [...pessoas.values()],
			voz: this.#voz,
		};
	}

	// ── server ──────────────────────────────────────────────────────────────

	#servir(host: string, port: number): Server<DadosSocket> {
		const api =
			(handler: (req: Request, autor: Autor, server: Server<DadosSocket>) => Promise<unknown> | unknown) =>
			async (req: Request, server: Server<DadosSocket>): Promise<Response> => {
				try {
					if (req.method !== "GET" && req.method !== "DELETE" && !ehJson(req)) {
						throw new ErroLab(415, "envie JSON (Content-Type: application/json)");
					}
					const resultado = await handler(req, this.#autorDe(req, server), server);
					return resultado instanceof Response ? resultado : Response.json(resultado);
				} catch (err) {
					return respostaDeErro(err);
				}
			};
		const chatDe = (req: Request): ChatProcess => {
			const id = (req as Bun.BunRequest<"/api/chats/:id">).params.id;
			const chat = this.#chats.get(id);
			if (!chat) throw new ErroLab(404, "chat não encontrado");
			return chat;
		};
		const memoriaDe = (req: Request): MemoriaEgregore => {
			const id = (req as Bun.BunRequest<"/api/times/:id">).params.id;
			if (!this.#store.time(id)) throw new ErroLab(404, "time não encontrado");
			const memoria = this.#memorias.get(id);
			if (!memoria) throw new ErroLab(404, "este time não é um Egregore");
			return memoria;
		};
		return Bun.serve<DadosSocket>({
			hostname: host,
			port,
			idleTimeout: 120,
			routes: {
				"/": pagina,
				"/arte/*": (req: Request) => arte(new URL(req.url).pathname),
				"/api/estado": { GET: api(() => this.estado()) },
				"/api/eu": { GET: api((_req, autor) => autor) },
				"/api/pastas": { GET: api(req => listarPastas(new URL(req.url).searchParams.get("caminho"))) },
				"/api/times": { POST: api(async req => this.#criarTime(await corpo(req))) },
				"/api/times/:id": {
					DELETE: api(async req => {
						await this.#removerTime((req as Bun.BunRequest<"/api/times/:id">).params.id);
						return { ok: true };
					}),
				},
				"/api/times/:id/memoria": {
					GET: api(req => memoriaDe(req).listar(new URL(req.url).searchParams.get("q") ?? "")),
				},
				"/api/times/:id/memoria/arquivo": {
					GET: api(
						async req =>
							new Response(await memoriaDe(req).arquivo(new URL(req.url).searchParams.get("caminho") ?? ""), {
								headers: { "content-type": "text/markdown; charset=utf-8" },
							}),
					),
				},
				"/api/times/:id/memoria/sincronia": { GET: api(req => memoriaDe(req).sincronia()) },
				"/api/times/:id/memoria/sincronizar": { POST: api(req => memoriaDe(req).sincronizar()) },
				"/api/chats": { POST: api(async (req, autor) => this.#criarChat(await corpo(req), autor)) },
				"/api/chats/:id": {
					DELETE: api(async req => {
						await this.#removerChat(chatDe(req).id);
						return { ok: true };
					}),
				},
				"/api/chats/:id/mensagem": {
					POST: api(async (req, autor) => {
						const chat = chatDe(req);
						const { texto, anexos } = await corpo(req);
						if (typeof texto !== "string") throw new ErroLab(400, "texto obrigatório");
						const ids = Array.isArray(anexos) ? anexos.filter(id => typeof id === "string") : [];
						const mensagem = await this.#anexos.mensagem(chat.id, texto, ids, autor.nome);
						await chat.enviar(mensagem.texto, fromDe(autor), mensagem.imagens);
						return { ok: true };
					}),
				},
				"/api/chats/:id/anexos": {
					POST: api(async req => this.#anexos.receber(chatDe(req).id, await corpo(req))),
				},
				"/api/chats/:id/modelos": { GET: api(async req => ({ modelos: await chatDe(req).modelos() })) },
				"/api/chats/:id/modelo": {
					POST: api(async req => {
						const { provider, id } = await corpo(req);
						if (typeof provider !== "string" || typeof id !== "string") {
							throw new ErroLab(400, "provider e id obrigatórios");
						}
						return chatDe(req).mudarModelo(provider, id);
					}),
				},
				"/api/chats/:id/esforco": {
					POST: api(async req => {
						const { nivel } = await corpo(req);
						if (typeof nivel !== "string") throw new ErroLab(400, "nivel obrigatório");
						return chatDe(req).mudarEsforco(nivel);
					}),
				},
				"/api/chats/:id/compactar": {
					POST: api(async req => {
						const { instrucoes } = await corpo(req);
						return chatDe(req).compactar(typeof instrucoes === "string" ? instrucoes.trim() : undefined);
					}),
				},
				"/api/chats/:id/uso": { GET: api(async req => chatDe(req).uso()) },
				"/api/transcricao": { GET: api(() => this.#transcricao.estado()) },
				"/api/transcricao/aquecer": { POST: api(() => this.#transcricao.aquecer()) },
				"/api/transcrever": {
					POST: api(async req => {
						const { dados, tipo } = await corpo(req);
						if (typeof dados !== "string" || !dados) throw new ErroLab(400, "mande o áudio em `dados` (base64)");
						const audio = Buffer.from(dados, "base64");
						return { texto: await this.#transcricao.transcrever(audio, typeof tipo === "string" ? tipo : "audio/webm") };
					}),
				},
				"/api/chats/:id/parar": {
					POST: api(async req => {
						await chatDe(req).parar();
						return { ok: true };
					}),
				},
				"/api/chats/:id/reabrir": {
					POST: api(async req => {
						const chat = chatDe(req);
						await chat.reabrir();
						return chat.resumo();
					}),
				},
				"/api/chats/:id/resposta": {
					POST: api(async req => {
						const chat = chatDe(req);
						const { reqId, valor } = await corpo(req);
						if (typeof reqId !== "string") throw new ErroLab(400, "reqId obrigatório");
						chat.responder(reqId, valor);
						return { ok: true };
					}),
				},
				"/api/chats/:id/ultima": { GET: api(async req => ({ texto: await chatDe(req).ultima() })) },
				"/api/chats/:id/voz": {
					POST: api(async req => {
						const { sdp } = await corpo(req);
						if (typeof sdp !== "string") throw new ErroLab(400, "sdp obrigatório");
						return chatDe(req).voz(sdp);
					}),
					DELETE: api(async req => {
						await chatDe(req).pararVoz();
						return { ok: true };
					}),
				},
				"/api/chats/:id/voz/mudo": {
					POST: api(async req => {
						const { mudo } = await corpo(req);
						if (mudo !== undefined && typeof mudo !== "boolean") throw new ErroLab(400, "mudo deve ser booleano");
						return chatDe(req).mudo(mudo);
					}),
				},
				"/ws": (req: Request, server: Server<DadosSocket>) => {
					if (!mesmaOrigem(req)) return new Response("Forbidden", { status: 403 });
					const autor = this.#autorDe(req, server);
					if (server.upgrade(req, { data: { autor, assinaturas: new Map() } })) return undefined;
					return new Response("Upgrade Required", { status: 426 });
				},
			},
			fetch: () => Response.json({ erro: "não encontrado" }, { status: 404 }),
			websocket: {
				open: socket => {
					this.#sockets.add(socket);
					socket.subscribe("estado");
					socket.send(JSON.stringify({ t: "estado", estado: this.estado() } satisfies MensagemServidor));
					this.#agendarEstado();
				},
				message: (socket, mensagem) => this.#aoMensagem(socket, mensagem),
				close: socket => {
					this.#sockets.delete(socket);
					for (const [chatId, enviar] of socket.data.assinaturas) this.#desassinar(chatId, enviar);
					socket.data.assinaturas.clear();
					this.#agendarEstado();
				},
			},
		});
	}

	#aoMensagem(socket: Socket, bruta: string | Buffer): void {
		let mensagem: MensagemCliente;
		try {
			mensagem = JSON.parse(String(bruta)) as MensagemCliente;
		} catch {
			return;
		}
		const chatId = typeof mensagem.chatId === "string" ? mensagem.chatId : "";
		const chat = this.#chats.get(chatId);
		if (!chat) return;
		if (mensagem.t === "assinar") {
			if (socket.data.assinaturas.has(chatId)) return;
			const enviar: EnviarFrame = frame => {
				socket.send(JSON.stringify({ t: "chat", chatId, frame } satisfies MensagemServidor));
			};
			socket.data.assinaturas.set(chatId, enviar);
			let ponte = this.#pontes.get(chatId);
			if (!ponte) {
				ponte = new PonteChat(chat);
				this.#pontes.set(chatId, ponte);
			}
			void ponte.assinar(enviar);
		} else if (mensagem.t === "desassinar") {
			const enviar = socket.data.assinaturas.get(chatId);
			if (!enviar) return;
			socket.data.assinaturas.delete(chatId);
			this.#desassinar(chatId, enviar);
		}
	}

	#desassinar(chatId: string, enviar: EnviarFrame): void {
		const ponte = this.#pontes.get(chatId);
		if (!ponte) return;
		ponte.desassinar(enviar);
		if (ponte.vazia) {
			ponte.fechar();
			this.#pontes.delete(chatId);
		}
	}

	/**
	 * Who sent `req`. Identity headers (Tailscale serve, the Carly plugin) are
	 * trusted only on loopback connections, where `tailscale serve` proxies from.
	 */
	#autorDe(req: Request, server: Server<DadosSocket>): Autor {
		const ip = server.requestIP(req)?.address ?? "";
		if (!ehLoopback(ip)) return { login: `ip:${ip}`, nome: "Convidado", foto: null, tipo: "membro" };
		if (req.headers.get("x-lab-autor")?.toLowerCase() === "carly") {
			return { login: "carly", nome: "Carly", foto: null, tipo: "carly" };
		}
		const login = req.headers.get("tailscale-user-login");
		if (login) {
			const foto = req.headers.get("tailscale-user-profile-pic") || null;
			if (login === this.#loginTailscaleDono) return { ...this.#dono!, foto: foto ?? this.#dono!.foto };
			return {
				login,
				nome: req.headers.get("tailscale-user-name") || login,
				foto,
				tipo: "membro",
			};
		}
		return this.#dono!;
	}

	// ── estado ──────────────────────────────────────────────────────────────

	/** Broadcast estado at most once per {@link INTERVALO_ESTADO_MS}. */
	#agendarEstado(): void {
		if (this.#timerEstado || !this.#servidor) return;
		const espera = Math.max(0, this.#ultimoEstado + INTERVALO_ESTADO_MS - Date.now());
		this.#timerEstado = setTimeout(() => {
			this.#timerEstado = undefined;
			this.#ultimoEstado = Date.now();
			this.#servidor?.publish(
				"estado",
				JSON.stringify({ t: "estado", estado: this.estado() } satisfies MensagemServidor),
			);
		}, espera);
	}

	async #verificarPastas(): Promise<void> {
		let mudou = false;
		for (const time of this.#store.times) {
			const ausente = !(await ehPasta(time.pasta));
			if (!ausente && (await this.#verificarEgregore(time))) mudou = true;
			if (ausente === this.#ausentes.has(time.id)) continue;
			if (ausente) this.#ausentes.add(time.id);
			else this.#ausentes.delete(time.id);
			mudou = true;
		}
		if (mudou) this.#agendarEstado();
	}

	/** Learn the owner's tailnet login once Tailscale is installed and logged in; it doesn't change after. */
	async #verificarTailscale(): Promise<void> {
		if (this.#loginTailscaleDono) return;
		this.#loginTailscaleDono = await lerLoginDoDono();
		if (this.#loginTailscaleDono) logger.debug("lab: tailnet owner", { login: this.#loginTailscaleDono });
	}

	/** Start or stop following the team's Egregore memory; true when the team became or stopped being one. */
	async #verificarEgregore(time: Time): Promise<boolean> {
		const info = await detectarEgregore(time.pasta);
		const atual = this.#memorias.get(time.id);
		if (atual && info && atual.info.org === info.org && atual.info.memoria === info.memoria) {
			await atual.verificar();
			return false;
		}
		atual?.fechar();
		this.#memorias.delete(time.id);
		if (info) {
			const memoria = new MemoriaEgregore(time.pasta, info, () => this.#avisarMemoria(time.id));
			this.#memorias.set(time.id, memoria);
			await memoria.verificar();
		}
		return atual !== undefined || info !== null;
	}

	#avisarMemoria(timeId: string): void {
		this.#servidor?.publish("estado", JSON.stringify({ t: "memoria", timeId } satisfies MensagemServidor));
	}

	#timeDoEstado(time: Time): Time {
		return {
			...time,
			...(this.#ausentes.has(time.id) ? { ausente: true } : {}),
			egregore: this.#memorias.get(time.id)?.info ?? null,
		};
	}

	// ── teams & chats ───────────────────────────────────────────────────────

	async #criarTime(dados: Record<string, unknown>): Promise<Time> {
		if (typeof dados.pasta !== "string" || !dados.pasta.trim()) throw new ErroLab(400, "pasta obrigatória");
		const pasta = expandirCaminho(dados.pasta);
		if (!(await ehPasta(pasta))) throw new ErroLab(400, "pasta não encontrada");
		const nome = typeof dados.nome === "string" && dados.nome.trim() ? dados.nome.trim() : path.basename(pasta);
		const time = this.#store.criarTime(nome, pasta);
		this.#ausentes.delete(time.id);
		await this.#verificarEgregore(time);
		this.#agendarEstado();
		return this.#timeDoEstado(time);
	}

	async #removerTime(id: string): Promise<void> {
		if (!this.#store.time(id)) throw new ErroLab(404, "time não encontrado");
		const chats = this.#store.chats.filter(chat => chat.timeId === id).map(chat => chat.id);
		// Forget the records first: estado() pairs every stored chat with its live process.
		this.#store.removerTime(id);
		this.#ausentes.delete(id);
		this.#memorias.get(id)?.fechar();
		this.#memorias.delete(id);
		this.#agendarEstado();
		await Promise.all(chats.map(chatId => this.#fecharChat(chatId)));
	}

	async #criarChat(dados: Record<string, unknown>, autor: Autor): Promise<ResumoChat> {
		const time = typeof dados.timeId === "string" ? this.#store.time(dados.timeId) : undefined;
		if (!time) throw new ErroLab(404, "time não encontrado");
		const usados = new Set(this.#store.chats.filter(chat => chat.timeId === time.id).map(chat => chat.nome));
		const pedido = typeof dados.nome === "string" ? dados.nome.trim() : "";
		if (pedido && usados.has(pedido)) throw new ErroLab(409, "nome já usado neste time");
		const papel = typeof dados.papel === "string" && dados.papel.trim() ? dados.papel.trim() : null;
		const registro = this.#store.criarChat(time.id, pedido || sortearNome(usados), papel);
		const chat = this.#registrarChat(registro);
		if (typeof dados.mensagem === "string" && dados.mensagem.trim()) {
			// The omp takes seconds to start; failures land in the chat's `erro`.
			chat.enviar(dados.mensagem, fromDe(autor)).catch(err => {
				logger.warn("lab: first message failed", { chat: chat.id, error: String(err) });
			});
		}
		this.#agendarEstado();
		return chat.resumo();
	}

	async #removerChat(id: string): Promise<void> {
		// Forget the record first: estado() pairs every stored chat with its live process.
		this.#store.removerChat(id);
		this.#agendarEstado();
		await this.#fecharChat(id);
	}

	async #fecharChat(id: string): Promise<void> {
		const ponte = this.#pontes.get(id);
		if (ponte) {
			ponte.fechar();
			this.#pontes.delete(id);
		}
		for (const socket of this.#sockets) socket.data.assinaturas.delete(id);
		const chat = this.#chats.get(id);
		this.#chats.delete(id);
		await chat?.encerrar();
	}

	#registrarChat(registro: RegistroChat): ChatProcess {
		const time = this.#store.time(registro.timeId)!;
		const chat = new ChatProcess({
			registro,
			time,
			aoSessao: sessionFile => this.#store.atualizarChat(registro.id, { sessionFile }),
			aoVoz: disponivel => {
				if (this.#voz === disponivel) return;
				this.#voz = disponivel;
				this.#agendarEstado();
			},
		});
		chat.ouvir(sinal => this.#aoSinalDoChat(registro.id, sinal));
		this.#chats.set(registro.id, chat);
		return chat;
	}

	#aoSinalDoChat(chatId: string, sinal: SinalChat): void {
		if (sinal.tipo === "resumo") {
			this.#agendarEstado();
			return;
		}
		if (sinal.tipo !== "rpc") return;
		const frame = sinal.frame;
		let mensagem: MensagemServidor;
		switch (frame.type) {
			case "live_phase":
				mensagem = {
					t: "voz",
					chatId,
					fase: frame.phase as NonNullable<Extract<MensagemServidor, { t: "voz" }>["fase"]>,
				};
				break;
			case "live_transcript":
				mensagem = {
					t: "voz",
					chatId,
					transcricao: {
						role: frame.role === "assistant" ? "assistant" : "user",
						turn: Number(frame.turn),
						text: String(frame.text),
						final: frame.final === true,
					},
				};
				break;
			case "live_end":
				mensagem = { t: "voz", chatId, fim: { erro: typeof frame.error === "string" ? frame.error : null } };
				break;
			default:
				return;
		}
		const texto = JSON.stringify(mensagem);
		for (const socket of this.#sockets) if (socket.data.assinaturas.has(chatId)) socket.send(texto);
	}
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** The owner sends plain messages; everyone else is named on theirs. */
function fromDe(autor: Autor): string | undefined {
	return autor.tipo === "dono" ? undefined : autor.nome;
}

function ehLoopback(ip: string): boolean {
	return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function ehJson(req: Request): boolean {
	return req.headers.get("content-type")?.toLowerCase().includes("application/json") === true;
}

/** Refuse cross-site WebSocket upgrades (a page on another origin talking to this lab). */
function mesmaOrigem(req: Request): boolean {
	const origem = req.headers.get("origin");
	if (!origem) return true;
	try {
		return new URL(origem).host === req.headers.get("host");
	} catch {
		return false;
	}
}

async function corpo(req: Request): Promise<Record<string, unknown>> {
	let dados: unknown;
	try {
		dados = await req.json();
	} catch {
		throw new ErroLab(400, "JSON inválido");
	}
	if (typeof dados !== "object" || dados === null || Array.isArray(dados))
		throw new ErroLab(400, "esperado um objeto JSON");
	return dados as Record<string, unknown>;
}

function respostaDeErro(err: unknown): Response {
	if (err instanceof ErroLab) return Response.json({ erro: err.message }, { status: err.status });
	logger.error("lab: request failed", { error: err instanceof Error ? err.stack : String(err) });
	return Response.json({ erro: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

/** Something already accepts TCP connections on `host:port`. */
async function alguemOuve(host: string, port: number): Promise<boolean> {
	const alvo = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
	try {
		const socket = await Promise.race([
			Bun.connect({ hostname: alvo, port, socket: { data() {} } }),
			Bun.sleep(500).then(() => null),
		]);
		socket?.end();
		return socket !== null;
	} catch {
		return false;
	}
}

function emUso(err: unknown): boolean {
	return (err as NodeJS.ErrnoException | undefined)?.code === "EADDRINUSE" || /EADDRINUSE|in use/i.test(String(err));
}

function expandirCaminho(caminho: string): string {
	const limpo = caminho.trim();
	if (limpo === "~") return os.homedir();
	if (limpo.startsWith("~/")) return path.join(os.homedir(), limpo.slice(2));
	return path.resolve(limpo);
}

async function ehPasta(caminho: string): Promise<boolean> {
	const info = await fs.stat(caminho).catch(() => null);
	return info?.isDirectory() === true;
}

async function listarPastas(caminho: string | null): Promise<{ caminho: string; pastas: string[] }> {
	const alvo = expandirCaminho(caminho || "~");
	let itens: Dirent[];
	try {
		itens = await fs.readdir(alvo, { withFileTypes: true });
	} catch (err) {
		if (isEnoent(err)) throw new ErroLab(404, "pasta não encontrada");
		throw new ErroLab(400, `não deu para ler a pasta: ${(err as Error).message}`);
	}
	const pastas: string[] = [];
	for (const item of itens) {
		if (item.name.startsWith(".")) continue;
		if (item.isDirectory() || (item.isSymbolicLink() && (await ehPasta(path.join(alvo, item.name)))))
			pastas.push(item.name);
	}
	pastas.sort((a, b) => a.localeCompare(b, "pt-BR"));
	return { caminho: alvo, pastas };
}

/** Static art files under `web/arte`. */
async function arte(caminhoUrl: string): Promise<Response> {
	let relativo: string;
	try {
		relativo = decodeURIComponent(caminhoUrl.slice("/arte/".length));
	} catch {
		return new Response("Bad Request", { status: 400 });
	}
	if (relativo.split(/[\\/]/).includes("..")) return new Response("Forbidden", { status: 403 });
	const arquivo = Bun.file(path.join(ARTE, relativo));
	if (!(await arquivo.exists())) return new Response("Not Found", { status: 404 });
	return new Response(arquivo);
}

/** The machine owner: OS login, named by `git config user.name` when set. */
async function donoDaMaquina(): Promise<Autor> {
	const login = os.userInfo().username;
	let nome = login;
	try {
		const config = await Bun.file(path.join(os.homedir(), ".gitconfig")).text();
		let naSecaoUser = false;
		for (const linha of config.split("\n")) {
			const limpa = linha.trim();
			if (limpa.startsWith("[")) naSecaoUser = /^\[user\]$/i.test(limpa);
			else if (naSecaoUser) {
				const valor = limpa
					.match(/^name\s*=\s*(.+)$/i)?.[1]
					?.trim()
					.replace(/^"(.*)"$/, "$1");
				if (valor) {
					nome = valor;
					break;
				}
			}
		}
	} catch (err) {
		if (!isEnoent(err)) logger.debug("lab: unreadable ~/.gitconfig", { error: String(err) });
	}
	return { login, nome, foto: null, tipo: "dono" };
}

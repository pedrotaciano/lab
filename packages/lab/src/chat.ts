/**
 * One omp per chat: the fork's own CLI in `rpc-ui --no-ui` mode, spawned on
 * demand in the team folder, driven over JSONL (protocol v2), and summarized
 * as a {@link ResumoChat}.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RpcFrameDecoder } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-frame";
import type { RpcModelPickerResult } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-model-picker";
import type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcPromptResultFrame,
	RpcSessionState,
} from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-types";
import type { TodoPhase } from "@oh-my-pi/pi-coding-agent/modes/rpc/wire/rpc-wire.generated";
import { defaultFormData, fieldError, fieldQuestions, type HtmlFormData } from "@oh-my-pi/pi-tui/html-form/data";
import { parseHtmlForm, spansText } from "@oh-my-pi/pi-tui/html-form/parse";
import { type ChildProcess, isRecord, logger, ptree, readJsonl } from "@oh-my-pi/pi-utils";
import type { RegistroChat } from "./store";
import type {
	ControlesChat,
	LabUiRequest,
	ModeloOpcao,
	ResumoChat,
	StatusChat,
	Time,
	TodoResumo,
	UsoChat,
} from "./tipos";

/** HTTP-mappable failure: the server answers `{erro}` with `status`. */
export class ErroLab extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ErroLab";
	}
}

/** Anything omp writes that is not a response to one of our commands. */
export type FrameRpc = Record<string, unknown> & { type: string };

/** An image the model receives with a prompt (RPC `images`). */
export type Imagem = NonNullable<Extract<RpcCommand, { type: "prompt" }>["images"]>[number];

/** What a chat tells its listeners. */
export type SinalChat =
	| { tipo: "resumo" }
	/** A fresh omp is up (bridges must re-send their snapshot). */
	| { tipo: "inicio" }
	/** The omp is gone (closed or crashed). */
	| { tipo: "fim" }
	| { tipo: "rpc"; frame: FrameRpc }
	| { tipo: "pergunta"; request: LabUiRequest }
	| { tipo: "pergunta-fim"; reqId: number };

const CLI = Bun.resolveSync("@oh-my-pi/pi-coding-agent/cli", import.meta.dir);
const PRAZO_PADRAO_MS = 30_000;
const PRAZO_INICIO_MS = 90_000;
const PRAZO_VOZ_MS = 60_000;
/** omp summarizes with a model call: minutes on a long conversation. */
const PRAZO_COMPACTAR_MS = 10 * 60_000;
const RESPOSTA_CURTA = 280;

const NOMES = [
	"Ana",
	"Bruno",
	"Carla",
	"Davi",
	"Elisa",
	"Felipe",
	"Gabriela",
	"Heitor",
	"Iara",
	"João",
	"Júlia",
	"Kauã",
	"Laura",
	"Lucas",
	"Marina",
	"Mateus",
	"Nina",
	"Otávio",
	"Paula",
	"Rafael",
	"Sofia",
	"Tiago",
	"Valentina",
	"Vitor",
	"Yasmin",
	"Caio",
	"Beatriz",
	"Pedro",
	"Lívia",
	"Enzo",
	"Helena",
	"Gustavo",
	"Alice",
	"Miguel",
	"Clara",
	"Arthur",
	"Manuela",
	"Bernardo",
	"Luísa",
	"Samuel",
];

/** A short Brazilian first name not in `usados`; numbered once every name is taken. */
export function sortearNome(usados: ReadonlySet<string>): string {
	const livres = NOMES.filter(nome => !usados.has(nome));
	if (livres.length > 0) return livres[Math.floor(Math.random() * livres.length)]!;
	for (let n = 2; ; n++) {
		for (const nome of NOMES) if (!usados.has(`${nome} ${n}`)) return `${nome} ${n}`;
	}
}

interface Pendente {
	resolve(data: unknown): void;
	reject(error: Error): void;
	timer: NodeJS.Timeout;
}

interface Pergunta {
	request: LabUiRequest;
	rpc: Extract<RpcExtensionUIRequest, { method: "select" | "confirm" | "input" | "editor" | "form" }>;
	timer?: NodeJS.Timeout;
}

type Processo = ChildProcess<"pipe">;

export interface OpcoesChat {
	registro: RegistroChat;
	time: Time;
	/** The omp reported its session file (persist it for `--resume`). */
	aoSessao(sessionFile: string): void;
	/** The omp reported whether live voice can sign in. */
	aoVoz(disponivel: boolean): void;
}

export class ChatProcess {
	readonly #registro: RegistroChat;
	readonly #time: Time;
	readonly #opcoes: OpcoesChat;
	readonly #ouvintes = new Set<(sinal: SinalChat) => void>();
	readonly #pendentes = new Map<string, Pendente>();
	readonly #perguntas = new Map<string, Pergunta>();
	readonly #promptsAbertos = new Set<string>();
	#processo: Processo | null = null;
	#subindo: Promise<void> | null = null;
	#encerrando = false;
	#seq = 0;
	#seqPergunta = 0;
	#agenteRodando = false;
	#atividade: string | null = null;
	#todo: TodoResumo | null = null;
	#ultimaResposta: string | null = null;
	#ultimaCompleta: string | null = null;
	#modelo: string | null = null;
	#erro: string | null = null;
	#estado: RpcSessionState | null = null;
	/** A compaction runs (ours, or omp's own near the limit). */
	#compactando = false;
	#atualizadoEm = Date.now();

	constructor(opcoes: OpcoesChat) {
		this.#opcoes = opcoes;
		this.#registro = opcoes.registro;
		this.#time = opcoes.time;
	}

	get id(): string {
		return this.#registro.id;
	}

	get time(): Time {
		return this.#time;
	}

	get vivo(): boolean {
		return this.#processo !== null;
	}

	/** Latest `get_state` snapshot of the running omp; null before the first one. */
	get estadoSessao(): RpcSessionState | null {
		return this.#estado;
	}

	/** Questions waiting for an answer, oldest first. */
	get perguntas(): LabUiRequest[] {
		return [...this.#perguntas.values()].map(pergunta => pergunta.request);
	}

	ouvir(ouvinte: (sinal: SinalChat) => void): () => void {
		this.#ouvintes.add(ouvinte);
		return () => this.#ouvintes.delete(ouvinte);
	}

	resumo(): ResumoChat {
		const primeira = this.#perguntas.values().next().value;
		return {
			id: this.#registro.id,
			timeId: this.#registro.timeId,
			nome: this.#registro.nome,
			papel: this.#registro.papel,
			status: this.#status(),
			atividade: this.#atividade,
			todo: this.#todo,
			pergunta: primeira ? { reqId: primeira.request.rpcId, titulo: primeira.request.title } : null,
			ultimaResposta: this.#ultimaResposta,
			modelo: this.#modelo,
			erro: this.#erro,
			controles: this.#controles(),
			atualizadoEm: this.#atualizadoEm,
		};
	}

	/** Start the omp unless it already runs; resolves once it answers commands. */
	garantir(): Promise<void> {
		if (this.#processo && !this.#subindo) return Promise.resolve();
		this.#subindo ??= this.#iniciar().finally(() => {
			this.#subindo = null;
		});
		return this.#subindo;
	}

	/** Restart after a crash: clears the error and starts the omp. */
	async reabrir(): Promise<void> {
		this.#erro = null;
		this.#mudou();
		await this.garantir();
	}

	/**
	 * Send a message; a running turn gets it as a follow-up. `from` names a participant other than
	 * the owner; `imagens` go to the model as images.
	 */
	async enviar(texto: string, from?: string, imagens: readonly Imagem[] = []): Promise<void> {
		if (!texto.trim()) throw new ErroLab(400, "texto vazio");
		const id = this.#novoId();
		// Open before the omp starts, so the chat reads as working from the first moment.
		this.#promptsAbertos.add(id);
		this.#erro = null;
		this.#atividade ??= "pensando";
		this.#mudou();
		try {
			await this.garantir();
			// Only consulted while the session streams: then the message waits for the running turn.
			const data = await this.#pedirComId<{ agentInvoked?: boolean } | undefined>(id, {
				type: "prompt",
				message: texto,
				streamingBehavior: "followUp",
				...(imagens.length > 0 ? { images: [...imagens] } : {}),
				...(from ? { from } : {}),
			});
			if (data?.agentInvoked === false) this.#fecharPrompt(id);
		} catch (err) {
			this.#fecharPrompt(id);
			throw err;
		}
	}

	async parar(): Promise<void> {
		if (!this.#processo) return;
		await this.pedir({ type: "abort" });
	}

	/** omp's model picker (its order: the recent ones first), each row with its context window. */
	async modelos(): Promise<ModeloOpcao[]> {
		await this.garantir();
		const [picker, disponiveis] = await Promise.all([
			this.pedir<RpcModelPickerResult>({ type: "get_model_picker", limit: 500 }, PRAZO_INICIO_MS),
			this.pedir<{ models: Array<{ provider: string; id: string; contextWindow?: number }> }>(
				{ type: "get_available_models" },
				PRAZO_INICIO_MS,
			),
		]);
		const janelas = new Map(disponiveis.models.map(m => [`${m.provider}/${m.id}`, m.contextWindow ?? null]));
		return picker.rows.map(row => ({
			provider: row.provider,
			id: row.id,
			nome: row.name,
			contexto: janelas.get(`${row.provider}/${row.id}`) ?? null,
			esforcos: row.thinking ?? [],
			atual: row.current === true,
		}));
	}

	/** Switch the chat's model; omp's session keeps it (resume brings it back). */
	async mudarModelo(provider: string, modelId: string): Promise<ResumoChat> {
		await this.garantir();
		await this.pedir({ type: "set_model", provider, modelId });
		await this.#lerEstado();
		return this.resumo();
	}

	/** Set the thinking selector (`auto` = padrão); only one the active model accepts. */
	async mudarEsforco(nivel: string): Promise<ResumoChat> {
		await this.garantir();
		const aceitos = this.#estado?.thinkingLevels ?? [];
		const level = aceitos.find(aceito => aceito === nivel);
		if (!level) throw new ErroLab(400, "esforço indisponível neste modelo");
		await this.pedir({ type: "set_thinking_level", level });
		await this.#lerEstado();
		return this.resumo();
	}

	/** Summarize the conversation now (omp's /compact); only while idle, a turn would be aborted. */
	async compactar(instrucoes?: string): Promise<{ tokensAntes: number }> {
		if (!this.#processo) throw new ErroLab(409, "chat parado");
		if (this.#trabalhando() || this.#perguntas.size > 0) throw new ErroLab(409, "O chat está trabalhando.");
		if (this.#compactando) throw new ErroLab(409, "Já está compactando.");
		this.#compactando = true;
		this.#mudou();
		try {
			const data = await this.pedir<{ tokensBefore: number }>(
				{ type: "compact", ...(instrucoes ? { customInstructions: instrucoes } : {}) },
				PRAZO_COMPACTAR_MS,
			);
			return { tokensAntes: data.tokensBefore };
		} finally {
			this.#compactando = false;
			this.#mudou();
			void this.#lerEstado().catch(() => {});
		}
	}

	/** The whole session's cost and tokens so far. */
	async uso(): Promise<UsoChat> {
		await this.garantir();
		const data = await this.pedir<{ cost: number; tokens: { total: number } }>({ type: "get_session_stats" });
		return { custo: data.cost, tokens: data.tokens.total };
	}

	/** Answer a pending question; `valor` null cancels it. */
	responder(rpcId: string, valor: unknown): void {
		const pergunta = this.#perguntas.get(rpcId);
		if (!pergunta) throw new ErroLab(404, "pergunta não encontrada");
		const resposta = respostaPara(pergunta.rpc, valor);
		this.#escrever(resposta);
		this.#tirarPergunta(rpcId);
	}

	/** Full text of the latest final answer, or null when there is none. */
	async ultima(): Promise<string | null> {
		if (this.#ultimaCompleta !== null) return this.#ultimaCompleta;
		if (!this.#processo && !this.#registro.sessionFile) return null;
		await this.garantir();
		await this.#lerFinal();
		return this.#ultimaCompleta;
	}

	async voz(sdpOffer: string): Promise<{ sdp: string; voz: string }> {
		if (!sdpOffer) throw new ErroLab(400, "sdp vazio");
		await this.garantir();
		const data = await this.pedir<{ voice: string; sdpAnswer: string }>(
			{ type: "live_connect", sdpOffer },
			PRAZO_VOZ_MS,
		);
		return { sdp: data.sdpAnswer, voz: data.voice };
	}

	async pararVoz(): Promise<void> {
		if (!this.#processo) return;
		await this.pedir({ type: "live_stop" });
	}

	async mudo(mudo?: boolean): Promise<{ mudo: boolean }> {
		if (!this.#processo) throw new ErroLab(409, "chat parado");
		const data = await this.pedir<{ muted: boolean }>(
			mudo === undefined ? { type: "live_mute" } : { type: "live_mute", muted: mudo },
		);
		return { mudo: data.muted };
	}

	/** Send one RPC command and resolve with its `data`; rejects on failure or timeout. */
	pedir<T = unknown>(command: RpcCommand, prazoMs = PRAZO_PADRAO_MS): Promise<T> {
		return this.#pedirComId<T>(this.#novoId(), command, prazoMs);
	}

	/** Stop the omp (stdin close, then the process group) and wait for it to exit. */
	async encerrar(): Promise<void> {
		const processo = this.#processo;
		if (!processo) return;
		this.#encerrando = true;
		try {
			try {
				processo.stdin.end();
			} catch {
				// stdin already closed
			}
			const saiu = await Promise.race([
				processo.exited.then(
					() => true,
					() => true,
				),
				Bun.sleep(2_000).then(() => false),
			]);
			if (!saiu || processo.exitCode === null) processo.kill(undefined, 1_500);
			await processo.exited.catch(() => {});
		} finally {
			this.#encerrando = false;
		}
	}

	// ── internals ───────────────────────────────────────────────────────────

	#status(): StatusChat {
		if (this.#perguntas.size > 0) return "esperando";
		// Also while the omp starts for a message: an exit clears both flags.
		if (this.#trabalhando()) return "trabalhando";
		if (this.#erro !== null) return "erro";
		return this.#processo ? "livre" : "parado";
	}

	#controles(): ControlesChat | null {
		const estado = this.#estado;
		if (!estado) return null;
		const uso = estado.contextUsage;
		return {
			modelo: estado.model
				? { provider: estado.model.provider, id: estado.model.id, nome: estado.model.name || estado.model.id }
				: null,
			esforco: estado.configuredThinkingLevel ?? estado.thinkingLevel ?? null,
			esforcos: estado.thinkingLevels ?? [],
			contexto:
				uso && uso.contextWindow > 0
					? { tokens: uso.tokens, janela: uso.contextWindow, pct: Math.round((uso.tokens / uso.contextWindow) * 100) }
					: null,
			compactando: this.#compactando || estado.isCompacting,
		};
	}

	#trabalhando(): boolean {
		return this.#agenteRodando || this.#promptsAbertos.size > 0;
	}

	#mudou(): void {
		this.#atualizadoEm = Date.now();
		this.#emitir({ tipo: "resumo" });
	}

	#emitir(sinal: SinalChat): void {
		for (const ouvinte of this.#ouvintes) {
			try {
				ouvinte(sinal);
			} catch (err) {
				logger.error("lab: chat listener failed", { chat: this.id, error: String(err) });
			}
		}
	}

	#novoId(): string {
		return `lab-${++this.#seq}`;
	}

	#pedirComId<T>(id: string, command: RpcCommand, prazoMs = PRAZO_PADRAO_MS): Promise<T> {
		if (!this.#processo) return Promise.reject(new ErroLab(409, "chat parado"));
		const { promise, resolve, reject } = Promise.withResolvers<T>();
		const timer = setTimeout(() => {
			this.#pendentes.delete(id);
			reject(new ErroLab(504, `omp não respondeu a ${command.type}`));
		}, prazoMs);
		this.#pendentes.set(id, { resolve: data => resolve(data as T), reject, timer });
		try {
			this.#escrever({ ...command, id });
		} catch (err) {
			clearTimeout(timer);
			this.#pendentes.delete(id);
			reject(err instanceof Error ? err : new Error(String(err)));
		}
		return promise;
	}

	#escrever(frame: RpcCommand | RpcExtensionUIResponse): void {
		const processo = this.#processo;
		if (!processo) throw new ErroLab(409, "chat parado");
		processo.stdin.write(`${JSON.stringify(frame)}\n`);
		processo.stdin.flush();
	}

	async #iniciar(): Promise<void> {
		const pasta = await fs.stat(this.#time.pasta).catch(() => null);
		if (!pasta?.isDirectory()) {
			this.#erro = "pasta não encontrada";
			this.#mudou();
			throw new ErroLab(409, this.#erro);
		}
		const args = [process.execPath, CLI, "--mode", "rpc-ui", "--no-ui"];
		const sessionFile = this.#registro.sessionFile;
		if (sessionFile && (await Bun.file(sessionFile).exists())) args.push("--resume", sessionFile);
		const processo = ptree.spawn(args, {
			cwd: this.#time.pasta,
			env: { ...Bun.env, PI_NO_PTY: "1", PI_NO_TITLE: "1" },
			stdin: "pipe",
			detached: true,
		});
		this.#processo = processo;
		const pronto = Promise.withResolvers<boolean>();
		void this.#ler(processo, pronto);
		void processo.exited.then(
			code => this.#saiu(processo, `o omp saiu (código ${code})`),
			(err: unknown) => this.#saiu(processo, `o omp parou: ${err instanceof Error ? err.message : String(err)}`),
		);
		const prazo = setTimeout(() => pronto.reject(new Error("o omp não ficou pronto")), PRAZO_INICIO_MS);
		try {
			const v2 = await pronto.promise;
			if (v2) await this.pedir({ type: "negotiate_protocol", protocolVersion: 2 }, PRAZO_INICIO_MS);
			await this.#lerEstado(PRAZO_INICIO_MS);
		} catch (err) {
			const motivo = err instanceof Error ? err.message : String(err);
			this.#erro = `${motivo}${stderrFinal(processo)}`;
			await this.encerrar();
			this.#mudou();
			throw new ErroLab(502, this.#erro);
		} finally {
			clearTimeout(prazo);
		}
		this.#erro = null;
		this.#emitir({ tipo: "inicio" });
		this.#mudou();
		void this.pedir<{ providers: Array<{ id: string; authenticated: boolean }> }>({
			type: "get_login_providers",
		}).then(
			data => this.#opcoes.aoVoz(data.providers.some(p => p.id === "openai-codex" && p.authenticated)),
			() => {},
		);
	}

	async #ler(processo: Processo, pronto: PromiseWithResolvers<boolean>): Promise<void> {
		const decoder = new RpcFrameDecoder();
		let viuPronto = false;
		try {
			for await (const linha of readJsonl<unknown>(processo.stdout)) {
				if (!viuPronto && isRecord(linha) && linha.type === "ready") {
					viuPronto = true;
					const versoes = linha.supportedProtocolVersions;
					pronto.resolve(Array.isArray(versoes) && versoes.includes(2));
					continue;
				}
				const frame = decoder.push(linha);
				if (frame && this.#processo === processo) this.#tratar(frame as FrameRpc);
			}
		} catch (err) {
			logger.warn("lab: omp output unreadable", { chat: this.id, error: String(err) });
			if (this.#processo === processo) processo.kill(undefined, 1_000);
		}
		if (!viuPronto) pronto.reject(new Error("o omp fechou a saída antes de ficar pronto"));
	}

	#saiu(processo: Processo, motivo: string): void {
		if (this.#processo !== processo) return;
		const esperado = this.#encerrando;
		this.#processo = null;
		this.#estado = null;
		const erro = new ErroLab(409, "o omp parou");
		for (const pendente of this.#pendentes.values()) {
			clearTimeout(pendente.timer);
			pendente.reject(erro);
		}
		this.#pendentes.clear();
		for (const rpcId of this.#perguntas.keys()) this.#tirarPergunta(rpcId);
		this.#promptsAbertos.clear();
		this.#agenteRodando = false;
		this.#atividade = null;
		this.#compactando = false;
		if (!esperado) this.#erro = `${motivo}${stderrFinal(processo)}`;
		this.#emitir({ tipo: "fim" });
		this.#mudou();
	}

	#tratar(frame: FrameRpc): void {
		if (frame.type === "response" && typeof frame.id === "string") {
			const pendente = this.#pendentes.get(frame.id);
			if (pendente) {
				this.#pendentes.delete(frame.id);
				clearTimeout(pendente.timer);
				if (frame.success === true) pendente.resolve(frame.data);
				else pendente.reject(new ErroLab(502, typeof frame.error === "string" ? frame.error : "falha no omp"));
				return;
			}
		}
		switch (frame.type) {
			case "agent_start":
				this.#agenteRodando = true;
				this.#atividade = "pensando";
				this.#mudou();
				break;
			case "agent_end":
				if (frame.isTerminal === false) break;
				this.#agenteRodando = false;
				if (!this.#trabalhando()) this.#atividade = null;
				this.#mudou();
				void this.#aoFimDoTurno();
				break;
			case "prompt_result": {
				const resultado = frame as unknown as RpcPromptResultFrame;
				if (resultado.status === "error") this.#erro = resultado.error?.message ?? "o turno falhou";
				if (resultado.id) this.#fecharPrompt(resultado.id);
				break;
			}
			case "message_update": {
				const evento = frame.assistantMessageEvent;
				const tipo = isRecord(evento) && typeof evento.type === "string" ? evento.type : "";
				const atividade = tipo.startsWith("text") ? "escrevendo" : tipo.startsWith("thinking") ? "pensando" : null;
				if (atividade && this.#atividade !== atividade) {
					this.#atividade = atividade;
					this.#mudou();
				}
				break;
			}
			case "tool_execution_start":
				this.#atividade = atividadeDaFerramenta(String(frame.toolName), frame.args, this.#time.pasta);
				this.#mudou();
				break;
			case "tool_execution_end":
				if (frame.toolName === "todo" && frame.isError !== true) {
					// The todo tool's `details` ({op, phases}); `view` reads without changing the list.
					const details = isRecord(frame.result) ? frame.result.details : undefined;
					if (isRecord(details) && details.op !== "view" && Array.isArray(details.phases))
						this.#todo = resumoTodo(details.phases as TodoPhase[]);
				}
				if (this.#trabalhando()) this.#atividade = "pensando";
				this.#mudou();
				break;
			case "todo_auto_clear":
				this.#todo = null;
				this.#mudou();
				break;
			case "model_changed":
			case "thinking_level_changed":
				void this.#lerEstado().catch(() => {});
				break;
			case "auto_compaction_start":
			case "manual_compaction_start":
				this.#compactando = true;
				this.#mudou();
				break;
			case "auto_compaction_end":
			case "manual_compaction_end":
				this.#compactando = false;
				this.#mudou();
				void this.#lerEstado().catch(() => {});
				break;
			case "extension_ui_request":
				this.#aoPedidoDeUi(frame as unknown as RpcExtensionUIRequest);
				break;
		}
		this.#emitir({ tipo: "rpc", frame });
	}

	#fecharPrompt(id: string): void {
		if (!this.#promptsAbertos.delete(id)) return;
		if (!this.#trabalhando()) this.#atividade = null;
		this.#mudou();
	}

	async #aoFimDoTurno(): Promise<void> {
		try {
			await Promise.all([this.#lerFinal(), this.#lerEstado()]);
		} catch (err) {
			logger.debug("lab: refresh after turn failed", { chat: this.id, error: String(err) });
		}
	}

	async #lerFinal(): Promise<void> {
		const data = await this.pedir<{ text?: string | null }>({ type: "get_last_assistant_text" });
		// `text` is absent (not null) when the session has no assistant answer yet.
		const ultima = data.text ?? null;
		this.#ultimaCompleta = ultima;
		this.#ultimaResposta = ultima === null ? null : encurtar(ultima, RESPOSTA_CURTA);
		this.#mudou();
	}

	async #lerEstado(prazoMs = PRAZO_PADRAO_MS): Promise<void> {
		const estado = await this.pedir<RpcSessionState>({ type: "get_state" }, prazoMs);
		this.#estado = estado;
		this.#modelo = estado.model ? estado.model.name || estado.model.id : null;
		this.#todo = resumoTodo(estado.todoPhases ?? []);
		if (estado.sessionFile && estado.sessionFile !== this.#registro.sessionFile) {
			this.#opcoes.aoSessao(estado.sessionFile);
		}
		this.#mudou();
	}

	#aoPedidoDeUi(pedido: RpcExtensionUIRequest): void {
		switch (pedido.method) {
			case "cancel":
				this.#tirarPergunta(pedido.targetId);
				return;
			case "select":
			case "confirm":
			case "input":
			case "editor":
			case "form": {
				const reqId = ++this.#seqPergunta;
				const request = pedidoParaLab(pedido, reqId);
				const pergunta: Pergunta = { request, rpc: pedido };
				const prazo = "timeout" in pedido ? pedido.timeout : undefined;
				// omp resolves a timed-out dialog to its default by itself; drop it here too.
				if (prazo && prazo > 0) pergunta.timer = setTimeout(() => this.#tirarPergunta(pedido.id), prazo);
				this.#perguntas.set(pedido.id, pergunta);
				this.#emitir({ tipo: "pergunta", request });
				this.#mudou();
				return;
			}
			default:
				// `ask` needs set_ask_dialog (never sent); the rest are fire-and-forget.
				return;
		}
	}

	#tirarPergunta(rpcId: string): void {
		const pergunta = this.#perguntas.get(rpcId);
		if (!pergunta) return;
		clearTimeout(pergunta.timer);
		this.#perguntas.delete(rpcId);
		this.#emitir({ tipo: "pergunta-fim", reqId: pergunta.request.reqId });
		this.#mudou();
	}
}

// ── pure helpers ──────────────────────────────────────────────────────────

function stderrFinal(processo: Processo): string {
	const tail = processo.peekStderr().trim();
	return tail ? `: ${encurtar(tail.split("\n").slice(-5).join("\n"), 600)}` : "";
}

function encurtar(texto: string, max: number): string {
	const limpo = texto.trim();
	return limpo.length <= max ? limpo : `${limpo.slice(0, max - 1).trimEnd()}…`;
}

function resumoTodo(phases: readonly TodoPhase[]): TodoResumo | null {
	let feitas = 0;
	let total = 0;
	let atual: string | null = null;
	for (const phase of phases) {
		for (const task of phase.tasks) {
			if (task.status === "abandoned") continue;
			total++;
			if (task.status === "completed") feitas++;
			else if (task.status === "in_progress" && atual === null) atual = task.content;
		}
	}
	return total === 0 ? null : { feitas, total, atual };
}

/** Path for display: relative inside the team folder, `~` for home. */
function caminhoCurto(alvo: string, pasta: string): string {
	const absoluto = path.resolve(pasta, alvo);
	const relativo = path.relative(pasta, absoluto);
	if (relativo && !relativo.startsWith("..") && !path.isAbsolute(relativo)) return relativo;
	const casa = os.homedir();
	return absoluto.startsWith(`${casa}${path.sep}`) ? `~${absoluto.slice(casa.length)}` : absoluto;
}

function texto(args: unknown, campo: string): string | null {
	if (!isRecord(args)) return null;
	const valor = args[campo];
	return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Short phrase of what a tool call does: "lendo src/app.ts", "rodando bun test". */
export function atividadeDaFerramenta(ferramenta: string, args: unknown, pasta: string): string {
	const alvo = (campo: string) => {
		const valor = texto(args, campo);
		return valor ? caminhoCurto(valor.split(/[;:](?=\d|$)/)[0]!, pasta) : null;
	};
	const curto = (valor: string | null) => (valor ? encurtar(valor.split("\n")[0]!, 60) : null);
	switch (ferramenta) {
		case "read": {
			const caminho = alvo("path");
			return caminho ? `lendo ${curto(caminho)}` : "lendo";
		}
		case "write": {
			const caminho = alvo("path");
			return caminho ? `escrevendo ${curto(caminho)}` : "escrevendo";
		}
		case "edit":
		case "ast_edit": {
			const bloco = texto(args, "input");
			const caminho = bloco?.match(/^\[([^\]#]+)#/m)?.[1];
			return caminho ? `editando ${curto(caminhoCurto(caminho, pasta))}` : "editando";
		}
		case "bash": {
			const comando = texto(args, "command");
			return comando ? `rodando ${curto(comando)}` : "rodando um comando";
		}
		case "grep":
		case "ast_grep": {
			const padrao = texto(args, "pattern");
			return padrao ? `buscando ${curto(padrao)}` : "buscando";
		}
		case "glob":
			return "procurando arquivos";
		case "web_search": {
			const busca = texto(args, "query");
			return busca ? `pesquisando ${curto(busca)}` : "pesquisando";
		}
		case "fetch":
			return "abrindo uma página";
		case "task":
			return "delegando";
		case "todo":
			return "atualizando as tarefas";
		case "ask":
			return "perguntando";
		case "eval":
			return "executando código";
		case "browser":
			return "usando o navegador";
		case "lsp":
			return "consultando o código";
		case "wait":
			return "esperando";
		default:
			return `usando ${ferramenta}`;
	}
}

function tituloDoForm(html: string): string {
	try {
		const form = parseHtmlForm(html);
		const primeira = fieldQuestions(form).values().next().value;
		if (primeira) return primeira;
		const secao = form.sections.find(section => section.title.length > 0);
		if (secao) return spansText(secao.title);
	} catch (err) {
		logger.debug("lab: unreadable form html", { error: String(err) });
	}
	return "Pergunta";
}

function pedidoParaLab(pedido: Pergunta["rpc"], reqId: number): LabUiRequest {
	const rpcId = pedido.id;
	switch (pedido.method) {
		case "select":
			return {
				kind: "select",
				reqId,
				rpcId,
				method: "select",
				title: pedido.title,
				options: pedido.options.map((label, index) => {
					const description = pedido.optionDetails?.[index]?.description;
					return description ? { label, description } : label;
				}),
				...(pedido.initialIndex !== undefined ? { initialIndex: pedido.initialIndex } : {}),
				...(pedido.selectionMarker ? { selectionMarker: pedido.selectionMarker } : {}),
				...(pedido.checkedIndices ? { checkedIndices: pedido.checkedIndices } : {}),
				...(pedido.markableCount !== undefined ? { markableCount: pedido.markableCount } : {}),
			};
		case "confirm":
			return {
				kind: "select",
				reqId,
				rpcId,
				method: "confirm",
				title: pedido.title,
				options: ["Sim", "Não"],
				helpText: pedido.message,
				approval: true,
			};
		case "input":
			return { kind: "editor", reqId, rpcId, method: "input", title: pedido.title };
		case "editor":
			return {
				kind: "editor",
				reqId,
				rpcId,
				method: "editor",
				title: pedido.title,
				...(pedido.prefill !== undefined ? { prefill: pedido.prefill } : {}),
			};
		case "form":
			return { kind: "form", reqId, rpcId, method: "form", title: tituloDoForm(pedido.html), html: pedido.html };
	}
}

function respostaPara(pedido: Pergunta["rpc"], valor: unknown): RpcExtensionUIResponse {
	const id = pedido.id;
	if (valor === null || valor === undefined) return { type: "extension_ui_response", id, cancelled: true };
	switch (pedido.method) {
		case "confirm":
			if (typeof valor === "boolean") return { type: "extension_ui_response", id, confirmed: valor };
			if (valor === "Sim" || valor === "Não")
				return { type: "extension_ui_response", id, confirmed: valor === "Sim" };
			throw new ErroLab(400, "valor deve ser true ou false");
		case "select":
		case "input":
		case "editor":
			if (typeof valor !== "string") throw new ErroLab(400, "valor deve ser texto");
			return { type: "extension_ui_response", id, value: valor };
		case "form":
			return { type: "extension_ui_response", id, data: dadosDoForm(pedido.html, valor) };
	}
}

/**
 * Submitted form data over the form's defaults (hidden inputs, preselected options,
 * prefilled text), as a browser submits it, checked against the form: omp fails the
 * whole ask on invalid data.
 */
function dadosDoForm(html: string, valor: unknown): HtmlFormData {
	if (!isRecord(valor)) throw new ErroLab(400, "valor deve ser um objeto {nome: valor}");
	const form = parseHtmlForm(html);
	const dados = defaultFormData(form);
	for (const [nome, campo] of Object.entries(valor)) {
		if (typeof campo === "string" || typeof campo === "number") dados[nome] = campo;
		else if (Array.isArray(campo) && campo.every(item => typeof item === "string")) dados[nome] = campo;
		else throw new ErroLab(400, `valor inválido em ${nome}`);
	}
	const perguntas = fieldQuestions(form);
	for (const campo of form.fields) {
		const problema = fieldError(campo, dados[campo.name]);
		if (problema) throw new ErroLab(400, `${perguntas.get(campo) ?? campo.name}: ${problema}`);
	}
	return dados;
}

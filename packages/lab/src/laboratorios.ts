/**
 * The other laboratórios of the entry lab (`<casa>/laboratorios.json`): each one is a plain `lab`
 * server with its own home, reached on loopback. A `local` lab runs on this machine as its own
 * detached process (it outlives the entry lab); an `ssh` lab is reached through an SSH tunnel that
 * the entry lab keeps open as its child. The entry lab polls each one's `/api/estado`, and proxies
 * the page's data to it: `/l/<id>/api/*` over HTTP and `/l/<id>/ws` as a WebSocket pipe.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $which, type ChildProcess, isEnoent, isPidAlive, logger, ptree } from "@oh-my-pi/pi-utils";
import type { Autor, Estado, EstadoLaboratorio, ResumoLaboratorio } from "./tipos";

/** The entry lab itself: the page at `/`. */
export const ID_ENTRADA = "mac";
const NOME_ENTRADA = "Mac";

const CLI = path.join(import.meta.dir, "cli.ts");
const INTERVALO_MS = 3_000;
/** Poll this often while a lab is coming up. */
const INTERVALO_SUBINDO_MS = 500;
const PRAZO_ESTADO_MS = 2_500;
/** How long a starting lab or a fresh tunnel counts as "conectando". */
const PRAZO_SUBIDA_MS = 20_000;
const ESPERA_MIN_MS = 1_000;
const ESPERA_MAX_MS = 30_000;
/** Failed polls through a live tunnel before the remote port is read again. */
const FALHAS_ATE_RELER = 3;
const ID_VALIDO = /^[a-z0-9][a-z0-9_-]*$/i;

interface RegistroBase {
	id: string;
	nome: string;
	/** Machine label shown in mono; default: this machine's for `local`, the id for `ssh`. */
	maquina?: string;
}

export interface RegistroLocal extends RegistroBase {
	tipo: "local";
	casa: string;
	porta: number;
}

export interface RegistroSsh extends RegistroBase {
	tipo: "ssh";
	host: string;
	chave?: string;
	/** The lab's home on the remote machine (default `~/.lab`): its `servidor.json` gives the port. */
	casa?: string;
	/** Used only when the remote `servidor.json` can't be read. */
	portaRemota: number;
}

export type RegistroLab = RegistroLocal | RegistroSsh;

/** This machine's label: "mac" on macOS, else the short hostname. */
function maquinaLocal(): string {
	return process.platform === "darwin" ? "mac" : (os.hostname().split(".")[0] ?? "local");
}

function expandir(caminho: string): string {
	if (caminho === "~") return os.homedir();
	if (caminho.startsWith("~/")) return path.join(os.homedir(), caminho.slice(2));
	return path.resolve(caminho);
}

const texto = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const porta = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < 65536;

/** The registry; none (or unreadable) is one lab, the entry. Bad entries are skipped with a warning. */
export async function lerRegistro(casa: string): Promise<RegistroLab[]> {
	const arquivo = path.join(casa, "laboratorios.json");
	let bruto: unknown;
	try {
		bruto = await Bun.file(arquivo).json();
	} catch (err) {
		if (!isEnoent(err)) logger.warn("lab: unreadable laboratorios.json", { arquivo, error: String(err) });
		return [];
	}
	if (!Array.isArray(bruto)) {
		logger.warn("lab: laboratorios.json is not a list", { arquivo });
		return [];
	}
	const vistos = new Set([ID_ENTRADA]);
	const labs: RegistroLab[] = [];
	for (const item of bruto as Record<string, unknown>[]) {
		const id = item?.id;
		if (!texto(id) || !ID_VALIDO.test(id) || vistos.has(id) || !texto(item.nome)) {
			logger.warn("lab: skipping laboratório (id/nome)", { item: JSON.stringify(item) });
			continue;
		}
		const base = { id, nome: item.nome.trim(), ...(texto(item.maquina) ? { maquina: item.maquina.trim() } : {}) };
		if (item.tipo === "local" && texto(item.casa) && porta(item.porta)) {
			labs.push({ ...base, tipo: "local", casa: expandir(item.casa), porta: item.porta });
		} else if (item.tipo === "ssh" && texto(item.host) && porta(item.portaRemota)) {
			labs.push({
				...base,
				tipo: "ssh",
				host: item.host,
				portaRemota: item.portaRemota,
				...(texto(item.chave) ? { chave: expandir(item.chave) } : {}),
				...(texto(item.casa) ? { casa: item.casa } : {}),
			});
		} else {
			logger.warn("lab: skipping laboratório (tipo)", { id });
			continue;
		}
		vistos.add(id);
	}
	return labs;
}

// ── how a lab is reached ──────────────────────────────────────────────────────

/** Keeps one lab reachable on a loopback URL. */
interface Via {
	/** Base URL of the lab's API now, or null while it is unreachable. */
	readonly url: string | null;
	/** Starting the lab / opening the tunnel. */
	readonly subindo: boolean;
	/** Make it reachable: start it / open the tunnel; `agora` also restarts a running but silent one. */
	ligar(agora: boolean): Promise<void>;
	/** Refresh `url` before a poll; returns why there is none. */
	verificar(): Promise<string | null>;
	/** Why it is down when `url` exists yet `/api/estado` fails. */
	semResposta(falhas: number): string;
	/** The lab answered: reset retry backoff. */
	respondeu(): void;
	desligar(): void;
}

interface RegistroServidor {
	pid: number;
	port: number;
	url: string;
}

async function lerServidor(casa: string): Promise<RegistroServidor | null> {
	try {
		const registro = (await Bun.file(path.join(casa, "servidor.json")).json()) as RegistroServidor;
		return typeof registro.pid === "number" && typeof registro.url === "string" ? registro : null;
	} catch {
		return null;
	}
}

/** A lab on this machine, started as its own detached process so it outlives the entry lab. */
class ViaLocal implements Via {
	url: string | null = null;
	#subindoAte = 0;
	#ligando: Promise<void> | null = null;

	constructor(readonly registro: RegistroLocal) {}

	get subindo(): boolean {
		return Date.now() < this.#subindoAte;
	}

	ligar(agora: boolean): Promise<void> {
		this.#ligando ??= this.#ligar(agora).finally(() => {
			this.#ligando = null;
		});
		return this.#ligando;
	}

	async #ligar(agora: boolean): Promise<void> {
		const atual = await lerServidor(this.registro.casa);
		if (atual && isPidAlive(atual.pid)) {
			this.url = atual.url;
			// A live pid that doesn't answer: start another (the CLI takes over servidor.json).
			if (!agora || (await responde(atual.url))) return;
		}
		await fs.mkdir(this.registro.casa, { recursive: true });
		const log = await fs.open(path.join(this.registro.casa, "lab.log"), "a");
		try {
			const filho = Bun.spawn([process.execPath, CLI, "--port", String(this.registro.porta), "--no-abrir"], {
				cwd: this.registro.casa,
				env: { ...Bun.env, LAB_CASA: this.registro.casa },
				stdin: "ignore",
				stdout: log.fd,
				stderr: log.fd,
				detached: true,
			});
			filho.unref();
			logger.debug("lab: started laboratório", { id: this.registro.id, pid: filho.pid });
		} finally {
			await log.close();
		}
		this.#subindoAte = Date.now() + PRAZO_SUBIDA_MS;
		while (this.subindo) {
			await Bun.sleep(INTERVALO_SUBINDO_MS);
			const novo = await lerServidor(this.registro.casa);
			if (novo && novo.pid !== atual?.pid && isPidAlive(novo.pid)) {
				this.url = novo.url;
				break;
			}
		}
		this.#subindoAte = 0;
	}

	async verificar(): Promise<string | null> {
		if (this.#ligando) return this.url ? null : "ligando";
		const atual = await lerServidor(this.registro.casa);
		this.url = atual && isPidAlive(atual.pid) ? atual.url : null;
		return this.url ? null : "desligado";
	}

	semResposta(): string {
		return "o lab não responde";
	}

	respondeu(): void {}

	/** Never stopped by the entry lab: it lives on its own. */
	desligar(): void {}
}

/** A lab on another machine, through `ssh -N -L <local>:127.0.0.1:<remote>`; the tunnel is our child. */
class ViaSsh implements Via {
	url: string | null = null;
	#tunel: ChildProcess | null = null;
	#portaRemota: number | null = null;
	/** The tunnel's local end; `url` is set once ssh listens there. */
	#local = 0;
	/** The remote `servidor.json` was missing at the last read. */
	#semServidor = false;
	#abertoEm = 0;
	#espera = ESPERA_MIN_MS;
	#timer: NodeJS.Timeout | undefined;
	#ligando: Promise<void> | null = null;
	#desligado = false;

	constructor(readonly registro: RegistroSsh) {}

	get subindo(): boolean {
		return this.#ligando !== null || (this.#tunel !== null && Date.now() - this.#abertoEm < PRAZO_SUBIDA_MS);
	}

	get #casaRemota(): string {
		return this.registro.casa ?? "~/.lab";
	}

	ligar(agora: boolean): Promise<void> {
		this.#desligado = false;
		if (agora) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
			this.#espera = ESPERA_MIN_MS;
		}
		this.#ligando ??= this.#abrir(agora).finally(() => {
			this.#ligando = null;
		});
		return this.#ligando;
	}

	#opcoesSsh(): string[] {
		return [
			"-o",
			"BatchMode=yes",
			"-o",
			"ConnectTimeout=10",
			"-o",
			"ServerAliveInterval=15",
			...(this.registro.chave ? ["-i", this.registro.chave] : []),
		];
	}

	/** The remote lab's real port from its `servidor.json` (the CLI moves off a busy port). */
	async #lerPortaRemota(ssh: string): Promise<number> {
		const casa = this.#casaRemota;
		const arquivo = `${casa.startsWith("~/") ? `~/${aspas(casa.slice(2))}` : aspas(casa)}/servidor.json`;
		const resultado = await ptree.exec([ssh, ...this.#opcoesSsh(), this.registro.host, `cat ${arquivo}`], {
			timeout: 15_000,
			allowNonZero: true,
			allowAbort: true,
		});
		if (resultado.ok) {
			try {
				const registro = JSON.parse(resultado.stdout) as Partial<RegistroServidor>;
				if (porta(registro.port)) {
					this.#semServidor = false;
					return registro.port;
				}
			} catch {}
		}
		this.#semServidor = /no such file/i.test(resultado.stderr);
		if (!this.#semServidor && resultado.stderr.trim()) {
			logger.debug("lab: remote servidor.json unreadable", {
				id: this.registro.id,
				stderr: resultado.stderr.trim(),
			});
		}
		return this.registro.portaRemota;
	}

	async #abrir(agora: boolean): Promise<void> {
		if (this.#tunel && !agora) return;
		this.#fecharTunel();
		const ssh = $which("ssh");
		if (!ssh) {
			logger.warn("lab: ssh not found", { id: this.registro.id });
			return;
		}
		const remota = await this.#lerPortaRemota(ssh);
		if (this.#desligado) return;
		const local = portaLivre();
		this.#portaRemota = remota;
		const tunel = ptree.spawn(
			[
				ssh,
				"-N",
				"-L",
				`${local}:127.0.0.1:${remota}`,
				"-o",
				"ExitOnForwardFailure=yes",
				...this.#opcoesSsh(),
				this.registro.host,
			],
			{ stdin: "ignore" },
		);
		this.#tunel = tunel;
		this.#local = local;
		this.#abertoEm = Date.now();
		logger.debug("lab: ssh tunnel started", { id: this.registro.id, local, remota, pid: tunel.pid });
		void tunel.exited.then(
			code => this.#caiu(tunel, `ssh saiu (${code})`),
			(err: unknown) => this.#caiu(tunel, String(err)),
		);
	}

	#caiu(tunel: ChildProcess, motivo: string): void {
		if (this.#tunel !== tunel) return;
		this.#tunel = null;
		this.url = null;
		logger.warn("lab: ssh tunnel dropped", {
			id: this.registro.id,
			motivo: tunel.exitReason?.message.trim() || motivo,
		});
		if (this.#desligado) return;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.ligar(false);
		}, this.#espera);
		this.#espera = Math.min(this.#espera * 2, ESPERA_MAX_MS);
	}

	/** The tunnel counts once ssh listens on the local port (it binds it after logging in). */
	async verificar(): Promise<string | null> {
		if (!this.#tunel) return "sem túnel";
		if (!this.url) {
			if (!(await alguemOuve("127.0.0.1", this.#local))) return "sem túnel";
			this.url = `http://127.0.0.1:${this.#local}`;
		}
		return null;
	}

	semResposta(falhas: number): string {
		// The tunnel is up but nobody answers: maybe the remote lab moved to another port.
		if (falhas === FALHAS_ATE_RELER && this.#tunel && !this.#ligando) void this.#conferirPorta();
		return this.#semServidor ? `o lab não responde em ${this.#casaRemota}` : "o lab não responde";
	}

	async #conferirPorta(): Promise<void> {
		const ssh = $which("ssh");
		if (!ssh) return;
		const remota = await this.#lerPortaRemota(ssh);
		if (remota !== this.#portaRemota && !this.#desligado) await this.ligar(true);
	}

	respondeu(): void {
		this.#espera = ESPERA_MIN_MS;
	}

	#fecharTunel(): void {
		const tunel = this.#tunel;
		this.#tunel = null;
		this.url = null;
		tunel?.kill();
	}

	desligar(): void {
		this.#desligado = true;
		clearTimeout(this.#timer);
		this.#fecharTunel();
	}
}

function aspas(s: string): string {
	return `'${s.replaceAll("'", "'\\''")}'`;
}

/** Something already accepts TCP connections on `host:port`. */
export async function alguemOuve(host: string, port: number): Promise<boolean> {
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

/** A free loopback TCP port, chosen by the kernel. */
function portaLivre(): number {
	const ouvinte = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
	const livre = ouvinte.port;
	ouvinte.stop(true);
	return livre;
}

async function responde(url: string): Promise<boolean> {
	try {
		return (await fetch(`${url}/api/estado`, { signal: AbortSignal.timeout(PRAZO_ESTADO_MS) })).ok;
	} catch {
		return false;
	}
}

// ── one lab ───────────────────────────────────────────────────────────────────

/** A registered lab: how it's reached and what its last poll said. */
export class LabRemoto {
	readonly id: string;
	readonly nome: string;
	readonly maquina: string;
	readonly #via: Via;
	readonly #aoMudar: () => void;
	#estado: EstadoLaboratorio = "conectando";
	#motivo: string | undefined;
	#trabalhando = 0;
	#esperando = 0;
	#falhas = 0;
	#timer: NodeJS.Timeout | undefined;
	#parado = false;

	constructor(registro: RegistroLab, aoMudar: () => void) {
		this.id = registro.id;
		this.nome = registro.nome;
		this.maquina = registro.maquina ?? (registro.tipo === "local" ? maquinaLocal() : registro.id);
		this.#via = registro.tipo === "local" ? new ViaLocal(registro) : new ViaSsh(registro);
		this.#aoMudar = aoMudar;
	}

	/** Loopback base URL of the lab's API, when it is up. */
	get url(): string | null {
		return this.#estado === "online" ? this.#via.url : null;
	}

	get online(): boolean {
		return this.#estado === "online";
	}

	get motivo(): string | undefined {
		return this.#motivo;
	}

	resumo(): ResumoLaboratorio {
		return {
			id: this.id,
			nome: this.nome,
			maquina: this.maquina,
			estado: this.#estado,
			...(this.#motivo ? { motivo: this.#motivo } : {}),
			trabalhando: this.#trabalhando,
			esperando: this.#esperando,
		};
	}

	iniciar(): void {
		void this.#via
			.ligar(false)
			.catch(err => logger.warn("lab: laboratório start failed", { id: this.id, error: String(err) }));
		this.#agendar(0);
	}

	/** `POST /api/laboratorios/:id/tentar`: start / reconnect now. */
	async tentar(): Promise<void> {
		if (this.#estado === "online") {
			this.#agendar(0);
			return;
		}
		this.#falhas = 0;
		this.#mudar("conectando", undefined, 0, 0);
		this.#agendar(INTERVALO_SUBINDO_MS);
		await this.#via.ligar(true);
		this.#agendar(0);
	}

	parar(): void {
		this.#parado = true;
		clearTimeout(this.#timer);
		this.#via.desligar();
	}

	#agendar(ms: number): void {
		if (this.#parado) return;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#sondar(), ms);
	}

	async #sondar(): Promise<void> {
		const falta = await this.#via.verificar();
		const url = this.#via.url;
		let estado: Estado | null = null;
		if (!falta && url) {
			try {
				const resposta = await fetch(`${url}/api/estado`, { signal: AbortSignal.timeout(PRAZO_ESTADO_MS) });
				if (resposta.ok) estado = (await resposta.json()) as Estado;
			} catch {
				estado = null;
			}
		}
		if (estado) {
			this.#falhas = 0;
			this.#via.respondeu();
			this.#mudar(
				"online",
				undefined,
				estado.chats.filter(chat => chat.status === "trabalhando").length,
				estado.chats.filter(chat => chat.status === "esperando").length,
			);
		} else {
			this.#falhas++;
			const motivo = falta ?? this.#via.semResposta(this.#falhas);
			// Background retries of a lab already down stay "fora"; only the first start and Tentar connect.
			if (this.#estado === "conectando" && (this.#via.subindo || this.#falhas < 2)) {
				this.#mudar("conectando", undefined, 0, 0);
			} else this.#mudar("fora", motivo, 0, 0);
		}
		this.#agendar(this.#estado === "conectando" ? INTERVALO_SUBINDO_MS : INTERVALO_MS);
	}

	#mudar(estado: EstadoLaboratorio, motivo: string | undefined, trabalhando: number, esperando: number): void {
		if (
			estado === this.#estado &&
			motivo === this.#motivo &&
			trabalhando === this.#trabalhando &&
			esperando === this.#esperando
		) {
			return;
		}
		this.#estado = estado;
		this.#motivo = motivo;
		this.#trabalhando = trabalhando;
		this.#esperando = esperando;
		this.#aoMudar();
	}
}

// ── all of them ───────────────────────────────────────────────────────────────

export class Laboratorios {
	readonly #casa: string;
	readonly #aoMudar: () => void;
	readonly #labs = new Map<string, LabRemoto>();

	constructor(casa: string, aoMudar: () => void) {
		this.#casa = casa;
		this.#aoMudar = aoMudar;
	}

	async iniciar(): Promise<void> {
		for (const registro of await lerRegistro(this.#casa)) {
			const lab = new LabRemoto(registro, this.#aoMudar);
			this.#labs.set(lab.id, lab);
			lab.iniciar();
		}
	}

	/** A registered lab other than the entry. */
	lab(id: string): LabRemoto | undefined {
		return this.#labs.get(id);
	}

	/** Known id: the entry or a registered one. */
	conhece(id: string): boolean {
		return id === ID_ENTRADA || this.#labs.has(id);
	}

	/** The entry first (from its own estado), then the registry's order. */
	lista(entrada: Estado): ResumoLaboratorio[] {
		return [
			{
				id: ID_ENTRADA,
				nome: NOME_ENTRADA,
				maquina: maquinaLocal(),
				estado: "online",
				trabalhando: entrada.chats.filter(chat => chat.status === "trabalhando").length,
				esperando: entrada.chats.filter(chat => chat.status === "esperando").length,
			},
			...[...this.#labs.values()].map(lab => lab.resumo()),
		];
	}

	parar(): void {
		for (const lab of this.#labs.values()) lab.parar();
	}
}

// ── proxy ─────────────────────────────────────────────────────────────────────

/** Identity headers a lab trusts on loopback, for the person the entry lab identified. */
export function cabecalhosDoAutor(autor: Autor): Record<string, string> {
	if (autor.tipo === "carly") return { "x-lab-autor": "carly" };
	// The entry lab's owner owns every lab it is the entry of.
	if (autor.tipo === "dono") return { "x-lab-autor": "dono" };
	return {
		"tailscale-user-login": autor.login,
		"tailscale-user-name": autor.nome,
		...(autor.foto ? { "tailscale-user-profile-pic": autor.foto } : {}),
	};
}

/** Request headers passed upstream; identity is never taken from the browser. */
const CABECALHOS_IDA = ["accept", "accept-language", "content-type", "if-none-match", "range"];
/** Response headers that describe the upstream connection, not the body we stream on. */
const CABECALHOS_FORA: Record<string, true> = {
	connection: true,
	"content-encoding": true,
	"content-length": true,
	"keep-alive": true,
	"transfer-encoding": true,
};

/** `/l/<id>/api/...` → `<url>/api/...`: any method, body and answer streamed. */
export async function proxiarHttp(req: Request, url: string, caminho: string, autor: Autor): Promise<Response> {
	const destino = new URL(caminho + new URL(req.url).search, url);
	const cabecalhos = new Headers(cabecalhosDoAutor(autor));
	for (const nome of CABECALHOS_IDA) {
		const valor = req.headers.get(nome);
		if (valor) cabecalhos.set(nome, valor);
	}
	const comCorpo = req.method !== "GET" && req.method !== "HEAD";
	let resposta: Response;
	try {
		resposta = await fetch(destino, {
			method: req.method,
			headers: cabecalhos,
			body: comCorpo ? req.body : undefined,
			signal: req.signal,
			redirect: "manual",
		});
	} catch (err) {
		logger.debug("lab: proxy request failed", { destino: destino.href, error: String(err) });
		return Response.json({ erro: "o lab não responde" }, { status: 502 });
	}
	const volta = new Headers();
	for (const [nome, valor] of resposta.headers) if (!CABECALHOS_FORA[nome]) volta.set(nome, valor);
	return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers: volta });
}

/** How that lab's own `laboratorios` frame starts (`JSON.stringify` keeps `t` first). */
const QUADRO_LABORATORIOS = '{"t":"laboratorios"';

interface Cliente {
	send(dados: string): unknown;
	close(codigo?: number, motivo?: string): void;
}

/**
 * The page's `/l/<id>/ws` piped to that lab's `/ws`. When the lab is down the page's socket stays
 * open (it still gets the entry's `laboratorios` frames) and is closed once the lab is back, so the
 * page reconnects and subscribes afresh.
 */
export class TuboWs {
	readonly lab: string;
	readonly #cliente: Cliente;
	readonly #online: () => boolean;
	#upstream: WebSocket | null = null;
	#aberto = false;
	#fila: string[] = [];
	#fechado = false;
	#vigia: NodeJS.Timeout | undefined;

	constructor(lab: string, cliente: Cliente, online: () => boolean) {
		this.lab = lab;
		this.#cliente = cliente;
		this.#online = online;
	}

	/** Open the upstream socket, or wait for the lab when there is no URL. */
	conectar(url: string | null, autor: Autor): void {
		if (!url) {
			this.#esperar();
			return;
		}
		const endereco = `${url.replace(/^http/, "ws")}/ws`;
		const upstream = new WebSocket(endereco, { headers: cabecalhosDoAutor(autor) });
		this.#upstream = upstream;
		upstream.onopen = () => {
			this.#aberto = true;
			for (const dados of this.#fila) upstream.send(dados);
			this.#fila = [];
		};
		upstream.onmessage = evento => {
			// That lab's own list of laboratórios (just itself) is not the entry's.
			if (typeof evento.data === "string" && !evento.data.startsWith(QUADRO_LABORATORIOS)) {
				this.#cliente.send(evento.data);
			}
		};
		upstream.onclose = () => {
			if (this.#upstream !== upstream || this.#fechado) return;
			this.#upstream = null;
			if (this.#aberto) {
				// The lab went away mid-session: the page reconnects and resubscribes.
				this.fechar();
				this.#cliente.close(1012, "o lab caiu");
			} else {
				this.#fila = [];
				this.#esperar();
			}
		};
	}

	/** A message from the page. */
	enviar(dados: string): void {
		if (this.#aberto) this.#upstream?.send(dados);
		else if (this.#upstream) this.#fila.push(dados);
	}

	fechar(): void {
		this.#fechado = true;
		clearInterval(this.#vigia);
		const upstream = this.#upstream;
		this.#upstream = null;
		upstream?.close();
	}

	#esperar(): void {
		clearInterval(this.#vigia);
		this.#vigia = setInterval(() => {
			if (!this.#online()) return;
			this.fechar();
			this.#cliente.close(1012, "o lab voltou");
		}, INTERVALO_SUBINDO_MS);
	}
}

/**
 * Contract types of the lab server, shared with the web UI and the Tern plugin.
 * Type-only: importing this module pulls no runtime code.
 */
import type { CollabUiRequest, HostFrame } from "@oh-my-pi/pi-wire";

/**
 * - parado: no process
 * - livre: process alive, no turn running
 * - trabalhando: a turn is running
 * - esperando: a question (ask/form or another extension UI request) is pending
 * - erro: the process died or the last turn failed
 */
export type StatusChat = "parado" | "livre" | "trabalhando" | "esperando" | "erro";

export interface TodoResumo {
	feitas: number;
	total: number;
	atual: string | null;
}

export interface PerguntaResumo {
	/** RPC id of the pending `extension_ui_request`; what `POST /api/chats/:id/resposta` takes. */
	reqId: string;
	titulo: string;
}

export interface ResumoChat {
	id: string;
	timeId: string;
	nome: string;
	papel: string | null;
	status: StatusChat;
	/** Short phrase of what the chat does now: "lendo src/app.ts", "rodando bun test", "pensando". */
	atividade: string | null;
	todo: TodoResumo | null;
	pergunta: PerguntaResumo | null;
	/** Start (up to ~280 chars) of the latest final answer. */
	ultimaResposta: string | null;
	modelo: string | null;
	erro: string | null;
	/** Model, effort and context of the running omp (its session keeps them); null without one. */
	controles: ControlesChat | null;
	/** Epoch ms. */
	atualizadoEm: number;
}

export interface ModeloChat {
	provider: string;
	id: string;
	nome: string;
}

export interface ControlesChat {
	modelo: ModeloChat | null;
	/** omp's configured thinking selector: `auto` (padrão), `off`, `low` … `max`. */
	esforco: string | null;
	/** Selectors the active model accepts (`off`, `auto`, then its efforts). */
	esforcos: string[];
	/** The conversation's share of the model's window, as omp counted it at the end of the last turn. */
	contexto: { tokens: number; janela: number; pct: number } | null;
	compactando: boolean;
}

/** A row of the model picker (`GET /api/chats/:id/modelos`), in omp's picker order. */
export interface ModeloOpcao extends ModeloChat {
	/** Context window in tokens, when known. */
	contexto: number | null;
	/** The model's effort slider, low to high; empty without one. */
	esforcos: string[];
	atual: boolean;
}

/** `GET /api/chats/:id/uso`: the whole session so far. */
export interface UsoChat {
	custo: number;
	tokens: number;
}

/** A file sent from the page (`POST /api/chats/:id/anexos`), until the next message takes it. */
export interface AnexoEnviado {
	id: string;
	nome: string;
	tamanho: number;
	/** It goes to the model as an image (RPC `images`), besides its path. */
	imagem: boolean;
}

/** `GET /api/transcricao`: whether this machine can transcribe the microphone, and if not why. */
export type EstadoTranscricao = { disponivel: true; modelo: string } | { disponivel: false; motivo: string };

export interface Time {
	id: string;
	nome: string;
	pasta: string;
	criadoEm: number;
	/** The folder is gone from disk (checked every few seconds); omitted while it exists. */
	ausente?: boolean;
	/** The folder is an Egregore instance; always set in `Estado` (null when it is not). */
	egregore?: EgregoreTime | null;
}

/** An Egregore instance (`egregore.json`, or listed in `~/.egregore/instances.json`). */
export interface EgregoreTime {
	/** The organization's name (`org_name`). */
	org: string;
	/** Absolute path of the instance's `memory/` (a symlink to the memory repo, as Egregore links it). */
	memoria: string;
}

export type SecaoMemoriaId =
	| "handoffs"
	| "decisoes"
	| "descobertas"
	| "padroes"
	| "perguntas"
	| "quests"
	| "wraps"
	| "pessoas"
	| "identidade";

export interface ItemMemoria {
	/** Path inside `memory/` (`handoffs/2026-11/24-pedro-x.md`); what `/memoria/arquivo` takes. */
	caminho: string;
	titulo: string;
	/** Who committed the file first; null while it is not committed. */
	autor: { nome: string; login?: string } | null;
	/** Epoch ms of that first commit (else the frontmatter date, else the file's mtime). */
	data: number;
	primeiraLinha: string;
	/** The first commit is this machine's git identity (`user.email` of the memory repo). */
	meu: boolean;
}

export interface SecaoMemoria {
	id: SecaoMemoriaId;
	nome: string;
	/** Newest first; with `q`, only the matches. */
	itens: ItemMemoria[];
}

/** `GET /api/times/:id/memoria?q=`. */
export interface MemoriaTime {
	/** `memory/` is on this machine. */
	presente: boolean;
	/** Without `memory/`: the Egregore command that brings it. */
	comando: string | null;
	secoes: SecaoMemoria[];
}

/** `GET /api/times/:id/memoria/sincronia`: the memory repo against its `origin`. */
export interface SincroniaMemoria {
	/** The team's commits not here yet. */
	atras: number;
	/** Local commits not pushed yet. */
	frente: number;
	sincronizando: boolean;
	/** Why the last fetch or sync failed. */
	erro?: string;
}

export interface Autor {
	login: string;
	nome: string;
	foto: string | null;
	tipo: "dono" | "carly" | "membro";
}

export interface Estado {
	times: Time[];
	chats: ResumoChat[];
	/** Who has the lab open now (one per login, from the open WebSockets). */
	pessoas: Autor[];
	/** Live voice is usable (Codex sign-in found); null until the first omp of this lab run reported it. */
	voz: boolean | null;
}

/**
 * - online: its `/api/estado` answers
 * - conectando: starting it / opening the tunnel, before the first answer
 * - fora: down; `motivo` says why ("sem túnel", "o lab não responde", "desligado")
 */
export type EstadoLaboratorio = "online" | "conectando" | "fora";

/** `GET /api/laboratorios` on the entry lab: itself first, then `laboratorios.json`'s order. */
export interface ResumoLaboratorio {
	id: string;
	nome: string;
	/** The machine it runs on, a short mono label ("mac", "ec2"). */
	maquina: string;
	estado: EstadoLaboratorio;
	motivo?: string;
	/** Chats working / waiting for you there, from its last estado (0 while not online). */
	trabalhando: number;
	esperando: number;
}

/**
 * A pending extension UI request as the browser receives it. `select`/`editor`
 * kinds are wire `CollabUiRequest`s (so collab-web's `GuestClient` queues them);
 * `form` (the `ask` tool) carries the raw HTML for the UI to render.
 *
 * - `reqId`: numeric id for `GuestClient`'s queue and `ui-request-end`.
 * - `rpcId`: the RPC request id; `POST /api/chats/:id/resposta` takes it as `reqId`.
 * - `method`: the RPC method, which decides the answer's `valor` type:
 *   form → `{ [name]: string | number | string[] }`, select/input/editor → string,
 *   confirm → boolean (or the option label "Sim"/"Não"); `null` cancels any of them.
 */
export type LabUiRequest =
	| (Extract<CollabUiRequest, { kind: "select" }> & { rpcId: string; method: "select" | "confirm" })
	| (Extract<CollabUiRequest, { kind: "editor" }> & { rpcId: string; method: "input" | "editor" })
	| { kind: "form"; reqId: number; rpcId: string; method: "form"; title: string; html: string };

/** Frame relayed for a subscribed chat: a wire `HostFrame`, with `ui-request` widened to {@link LabUiRequest}. */
export type LabHostFrame = Exclude<HostFrame, { t: "ui-request" }> | { t: "ui-request"; request: LabUiRequest };

export type LivePhase = "connecting" | "listening" | "working" | "speaking" | "muted" | "error";

export interface LiveTranscricao {
	role: "user" | "assistant";
	turn: number;
	text: string;
	final: boolean;
}

/** Server → browser WebSocket messages. */
export type MensagemServidor =
	| { t: "estado"; estado: Estado }
	| { t: "chat"; chatId: string; frame: LabHostFrame }
	| { t: "voz"; chatId: string; fase?: LivePhase; transcricao?: LiveTranscricao; fim?: { erro: string | null } }
	/** An Egregore team's memory (files or sync state) changed: refetch it. */
	| { t: "memoria"; timeId: string }
	/** The entry lab's laboratórios changed (sent also on connect, and over proxied sockets). */
	| { t: "laboratorios"; laboratorios: ResumoLaboratorio[] };

/** Browser → server WebSocket messages. */
export type MensagemCliente = { t: "assinar"; chatId: string } | { t: "desassinar"; chatId: string };

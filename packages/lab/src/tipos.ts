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
	/** Epoch ms. */
	atualizadoEm: number;
}

export interface Time {
	id: string;
	nome: string;
	pasta: string;
	criadoEm: number;
	/** The folder is gone from disk (checked every few seconds); omitted while it exists. */
	ausente?: boolean;
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
	| { t: "voz"; chatId: string; fase?: LivePhase; transcricao?: LiveTranscricao; fim?: { erro: string | null } };

/** Browser → server WebSocket messages. */
export type MensagemCliente = { t: "assinar"; chatId: string } | { t: "desassinar"; chatId: string };

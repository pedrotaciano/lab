// One chat's replica in the browser, fed by the `{t:"chat"}` frames of /ws: the logic of
// collab-web's GuestClient#applyFrame (welcome + snapshot chunks, entries, streaming events, state,
// ui requests), without its relay socket. Immutable snapshots for useSyncExternalStore; streaming
// frames publish at most once per animation frame.
import type { ActiveTool } from "@oh-my-pi/collab-web/src/lib/client";
import type { AssistantMessage, HostFrame, SessionEntry, SessionState } from "@oh-my-pi/pi-wire";
import type { LabHostFrame, LabUiRequest } from "../tipos";

export interface FotoChat {
	/** True from the subscription until the transcript snapshot is complete. */
	carregando: boolean;
	entries: readonly SessionEntry[];
	state: SessionState | null;
	stream: AssistantMessage | null;
	streamDone: boolean;
	activeTools: ReadonlyMap<string, ActiveTool>;
	working: boolean;
	pergunta: LabUiRequest | null;
	/** The host's last error notice (a failed retry, a frame error), if any. */
	aviso: string | null;
}

type Evento = Extract<HostFrame, { t: "event" }>["event"];

export class ReplicaChat {
	readonly #ouvintes = new Set<() => void>();
	#entries: SessionEntry[] = [];
	#publicadas: readonly SessionEntry[] = [];
	#pendente: { entries: SessionEntry[]; live: SessionEntry[]; total: number } | null = null;
	#esperandoBoasVindas = true;
	#state: SessionState | null = null;
	#stream: AssistantMessage | null = null;
	#streamDone = false;
	#tools: ReadonlyMap<string, ActiveTool> = new Map();
	#working = false;
	#pergunta: LabUiRequest | null = null;
	#fila: LabUiRequest[] = [];
	#aviso: string | null = null;
	#foto: FotoChat;
	#cancelarQuadro: number | null = null;

	constructor(readonly chatId: string) {
		this.#foto = this.#montar();
	}

	subscribe = (ouvinte: () => void): (() => void) => {
		this.#ouvintes.add(ouvinte);
		return () => this.#ouvintes.delete(ouvinte);
	};

	getSnapshot = (): FotoChat => this.#foto;

	/** The socket reconnected: a new welcome follows; the rows on screen stay until it completes. */
	reiniciar(): void {
		this.#esperandoBoasVindas = true;
		this.#pendente = null;
		this.#publicar();
	}

	/** The question was answered here: show the next one at once (the server's end frame follows). */
	respondida(reqId: number): void {
		if (this.#pergunta?.reqId === reqId) this.#proxima();
		this.#publicar();
	}

	aplicar(frame: LabHostFrame): void {
		switch (frame.t) {
			case "welcome":
				this.#esperandoBoasVindas = false;
				if (frame.entryCount === 0) {
					this.#entries = [];
					this.#publicadas = [];
					this.#pendente = null;
				} else {
					this.#pendente = { entries: [], live: [], total: frame.entryCount };
				}
				this.#state = frame.state;
				this.#stream = null;
				this.#streamDone = false;
				this.#tools = new Map();
				this.#working = frame.state.isStreaming;
				this.#pergunta = null;
				this.#fila = [];
				this.#aviso = null;
				break;
			case "snapshot-chunk": {
				const pendente = this.#pendente;
				if (pendente === null) return;
				pendente.entries.push(...frame.entries);
				if (!frame.final && pendente.entries.length < pendente.total) return;
				this.#entries = pendente.entries;
				this.#entries.push(...pendente.live);
				this.#publicadas = [...this.#entries];
				this.#pendente = null;
				break;
			}
			case "entry":
				if (this.#streamDone && frame.entry.type === "message" && frame.entry.message.role === "assistant") {
					this.#stream = null;
					this.#streamDone = false;
				}
				if (this.#pendente !== null) {
					this.#pendente.live.push(frame.entry);
					return;
				}
				this.#entries.push(frame.entry);
				this.#publicadas = [...this.#entries];
				break;
			case "event":
				this.#evento(frame.event);
				break;
			case "state":
				this.#state = frame.state;
				this.#working = frame.state.isStreaming;
				if (!frame.state.isStreaming) {
					this.#tools = new Map();
					if (this.#streamDone) {
						this.#stream = null;
						this.#streamDone = false;
					}
				}
				break;
			case "ui-request":
				if (this.#pergunta) this.#fila = [...this.#fila, frame.request];
				else this.#pergunta = frame.request;
				break;
			case "ui-request-end":
				if (this.#pergunta?.reqId === frame.reqId) this.#proxima();
				else this.#fila = this.#fila.filter(pedido => pedido.reqId !== frame.reqId);
				break;
			case "error":
				this.#aviso = frame.message;
				break;
			default:
				return;
		}
		// Streaming tokens and tool output publish once per animation frame; everything else at once.
		const streaming =
			frame.t === "event" && (frame.event.type === "message_update" || frame.event.type === "tool_execution_update");
		if (streaming) this.#adiar();
		else this.#publicar();
	}

	#evento(evento: Evento): void {
		switch (evento.type) {
			case "message_start":
			case "message_update":
				if (evento.message.role === "assistant") {
					this.#stream = evento.message;
					this.#streamDone = false;
				}
				break;
			case "message_end":
				if (evento.message.role === "assistant") {
					this.#stream = evento.message;
					this.#streamDone = true;
				}
				break;
			case "tool_execution_start":
				this.#tools = new Map(this.#tools).set(evento.toolCallId, {
					toolCallId: evento.toolCallId,
					toolName: evento.toolName,
					args: evento.args,
					intent: evento.intent,
					startedAt: Date.now(),
				});
				break;
			case "tool_execution_update": {
				const antes = this.#tools.get(evento.toolCallId);
				this.#tools = new Map(this.#tools).set(
					evento.toolCallId,
					antes
						? { ...antes, partialResult: evento.partialResult }
						: {
								toolCallId: evento.toolCallId,
								toolName: evento.toolName,
								args: evento.args,
								partialResult: evento.partialResult,
								startedAt: Date.now(),
							},
				);
				break;
			}
			case "tool_execution_end": {
				const proximo = new Map(this.#tools);
				proximo.delete(evento.toolCallId);
				this.#tools = proximo;
				break;
			}
			case "agent_start":
				this.#working = true;
				this.#aviso = null;
				break;
			case "agent_end":
				this.#working = false;
				break;
			case "auto_retry_end":
				if (!evento.success) this.#aviso = evento.finalError ?? null;
				break;
			default:
				break;
		}
	}

	#proxima(): void {
		const [proxima, ...resto] = this.#fila;
		this.#pergunta = proxima ?? null;
		this.#fila = resto;
	}

	#montar(): FotoChat {
		return {
			carregando: this.#esperandoBoasVindas || this.#pendente !== null,
			entries: this.#publicadas,
			state: this.#state,
			stream: this.#stream,
			streamDone: this.#streamDone,
			activeTools: this.#tools,
			working: this.#working,
			pergunta: this.#pergunta,
			aviso: this.#aviso,
		};
	}

	#adiar(): void {
		if (this.#cancelarQuadro !== null) return;
		this.#cancelarQuadro = requestAnimationFrame(() => {
			this.#cancelarQuadro = null;
			this.#publicar();
		});
	}

	#publicar(): void {
		if (this.#cancelarQuadro !== null) {
			cancelAnimationFrame(this.#cancelarQuadro);
			this.#cancelarQuadro = null;
		}
		this.#foto = this.#montar();
		for (const ouvinte of this.#ouvintes) ouvinte();
	}
}

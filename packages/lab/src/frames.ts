/**
 * RPC → browser bridge for one chat: the pi-wire `HostFrame` stream that
 * collab-web's `GuestClient`/`Transcript` render (welcome + snapshot, then
 * live `entry`/`event`/`state`/`ui-request` frames). One bridge per chat,
 * alive while someone is subscribed.
 */
import type { RpcSessionState } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-types";
import { logger } from "@oh-my-pi/pi-utils";
import { type AgentEvent, COLLAB_PROTO, type SessionEntry, type SessionState } from "@oh-my-pi/pi-wire";
import { entradaParaTela } from "./anexos";
import type { ChatProcess, FrameRpc, SinalChat } from "./chat";
import type { LabHostFrame } from "./tipos";

export type EnviarFrame = (frame: LabHostFrame) => void;

/** Session events the guest client consumes, by RPC frame type. */
const EVENTOS: Record<string, true> = {
	agent_start: true,
	agent_end: true,
	turn_start: true,
	turn_end: true,
	message_start: true,
	message_update: true,
	message_end: true,
	tool_execution_start: true,
	tool_execution_update: true,
	tool_execution_end: true,
	notice: true,
	auto_compaction_start: true,
	auto_compaction_end: true,
	auto_retry_start: true,
	auto_retry_end: true,
	thinking_level_changed: true,
};

/** Frames after which new session entries may exist. */
const GATILHOS_ENTRADA: Record<string, true> = {
	message_end: true,
	turn_end: true,
	agent_end: true,
	auto_compaction_end: true,
	manual_compaction_end: true,
	model_changed: true,
	thinking_level_changed: true,
	prompt_result: true,
};

/** Frames after which the footer state may have changed. */
const GATILHOS_ESTADO: Record<string, true> = {
	agent_start: true,
	agent_end: true,
	turn_end: true,
	message_end: true,
	queue_update: true,
	model_changed: true,
	thinking_level_changed: true,
	auto_compaction_end: true,
	manual_compaction_end: true,
	prompt_result: true,
};

const ESPERA_ESTADO_MS = 150;
const ENTRADAS_POR_PEDACO = 200;

export class PonteChat {
	readonly #chat: ChatProcess;
	readonly #assinantes = new Set<EnviarFrame>();
	readonly #desligar: () => void;
	/** Every session entry in append order, mirrored from `get_entries`; null until loaded. */
	#entradas: SessionEntry[] | null = null;
	#fila: Promise<void> = Promise.resolve();
	#sincronizacaoPendente = false;
	#timerEstado: NodeJS.Timeout | undefined;

	constructor(chat: ChatProcess) {
		this.#chat = chat;
		this.#desligar = chat.ouvir(sinal => this.#aoSinal(sinal));
	}

	get vazia(): boolean {
		return this.#assinantes.size === 0;
	}

	/** Add a subscriber: starts the omp if needed, then sends it welcome + snapshot + pending asks. */
	async assinar(enviar: EnviarFrame): Promise<void> {
		this.#assinantes.add(enviar);
		try {
			await this.#chat.garantir();
		} catch (err) {
			enviar({ t: "error", message: err instanceof Error ? err.message : String(err) });
			return;
		}
		await this.#enfileirar(async () => {
			if (!this.#assinantes.has(enviar)) return;
			await this.#sincronizar();
			await this.#boasVindas([enviar]);
		});
	}

	desassinar(enviar: EnviarFrame): void {
		this.#assinantes.delete(enviar);
	}

	fechar(): void {
		this.#desligar();
		clearTimeout(this.#timerEstado);
		this.#assinantes.clear();
		this.#entradas = null;
	}

	#transmitir(frame: LabHostFrame): void {
		for (const enviar of this.#assinantes) enviar(frame);
	}

	#enfileirar(passo: () => Promise<void>): Promise<void> {
		const proximo = this.#fila.then(passo).catch(err => {
			logger.warn("lab: chat bridge step failed", { chat: this.#chat.id, error: String(err) });
		});
		this.#fila = proximo;
		return proximo;
	}

	#aoSinal(sinal: SinalChat): void {
		switch (sinal.tipo) {
			case "inicio":
				// A fresh omp (restart or resume): everyone gets a new snapshot.
				this.#entradas = null;
				void this.#enfileirar(async () => {
					if (this.vazia) return;
					await this.#sincronizar();
					await this.#boasVindas([...this.#assinantes]);
				});
				break;
			case "fim": {
				clearTimeout(this.#timerEstado);
				const estado = this.#chat.estadoSessao;
				const base = estado ? estadoWire(estado, this.#chat.time.pasta) : estadoVazio(this.#chat.time.pasta);
				this.#transmitir({ t: "state", state: { ...base, isStreaming: false } });
				break;
			}
			case "pergunta":
				this.#transmitir({ t: "ui-request", request: sinal.request });
				break;
			case "pergunta-fim":
				this.#transmitir({ t: "ui-request-end", reqId: sinal.reqId });
				break;
			case "rpc":
				this.#aoFrame(sinal.frame);
				break;
			case "resumo":
				break;
		}
	}

	#aoFrame(frame: FrameRpc): void {
		if (this.vazia) return;
		if (EVENTOS[frame.type]) this.#transmitir({ t: "event", event: eventoWire(frame) });
		else if (frame.type === "extension_ui_request" && frame.method === "notify") {
			const nivel = frame.notifyType === "warning" || frame.notifyType === "error" ? frame.notifyType : "info";
			this.#transmitir({ t: "event", event: { type: "notice", level: nivel, message: String(frame.message) } });
		}
		if (GATILHOS_ENTRADA[frame.type]) this.#pedirSincronizacao();
		if (GATILHOS_ESTADO[frame.type]) this.#agendarEstado();
	}

	/** Coalesce entry pulls: at most one queued behind the running one. */
	#pedirSincronizacao(): void {
		if (this.#sincronizacaoPendente) return;
		this.#sincronizacaoPendente = true;
		void this.#enfileirar(async () => {
			this.#sincronizacaoPendente = false;
			if (!this.vazia) await this.#sincronizar();
		});
	}

	#agendarEstado(): void {
		if (this.#timerEstado) return;
		this.#timerEstado = setTimeout(() => {
			this.#timerEstado = undefined;
			if (this.vazia || !this.#chat.vivo) return;
			void this.#chat
				.pedir<RpcSessionState>({ type: "get_state" })
				.then(estado => this.#transmitir({ t: "state", state: estadoWire(estado, this.#chat.time.pasta) }))
				.catch(() => {});
		}, ESPERA_ESTADO_MS);
	}

	/** Pull entries appended since the last pull (all of them the first time) and broadcast the new ones. */
	async #sincronizar(): Promise<void> {
		if (!this.#chat.vivo) return;
		const atuais = this.#entradas;
		const desde = atuais?.at(-1)?.id;
		if (atuais === null || desde === undefined) {
			const entries = (await this.#chat.pedir<{ entries: SessionEntry[] }>({ type: "get_entries" })).entries.map(
				entradaParaTela,
			);
			if (atuais !== null) for (const entry of entries) this.#transmitir({ t: "entry", entry });
			this.#entradas = entries;
			return;
		}
		let novas: SessionEntry[];
		try {
			({ entries: novas } = await this.#chat.pedir<{ entries: SessionEntry[] }>({
				type: "get_entries",
				since: desde,
			}));
		} catch (err) {
			// The cursor vanished (session rewritten): reload and resend the whole snapshot.
			logger.debug("lab: entries cursor lost, resyncing", { chat: this.#chat.id, error: String(err) });
			this.#entradas = null;
			await this.#sincronizar();
			await this.#boasVindas([...this.#assinantes]);
			return;
		}
		for (const entry of novas.map(entradaParaTela)) {
			atuais.push(entry);
			this.#transmitir({ t: "entry", entry });
		}
	}

	async #boasVindas(destinos: EnviarFrame[]): Promise<void> {
		if (destinos.length === 0 || !this.#chat.vivo) return;
		const estado = await this.#chat.pedir<RpcSessionState>({ type: "get_state" });
		const entradas = this.#entradas ?? [];
		const pasta = this.#chat.time.pasta;
		const primeira = entradas[0];
		const welcome: LabHostFrame = {
			t: "welcome",
			proto: COLLAB_PROTO,
			header: {
				type: "session",
				id: estado.sessionId,
				...(estado.sessionName ? { title: estado.sessionName } : {}),
				timestamp: primeira?.timestamp ?? new Date().toISOString(),
				cwd: pasta,
			},
			state: estadoWire(estado, pasta),
			agents: [],
			entryCount: entradas.length,
		};
		const perguntas = this.#chat.perguntas;
		for (const enviar of destinos) {
			if (!this.#assinantes.has(enviar)) continue;
			enviar(welcome);
			if (entradas.length > 0) {
				for (let inicio = 0; inicio < entradas.length; inicio += ENTRADAS_POR_PEDACO) {
					const fim = inicio + ENTRADAS_POR_PEDACO;
					enviar({ t: "snapshot-chunk", entries: entradas.slice(inicio, fim), final: fim >= entradas.length });
				}
			}
			for (const request of perguntas) enviar({ t: "ui-request", request });
		}
	}
}

/** RPC session event → wire event, dropping the payload the guest never reads. */
function eventoWire(frame: FrameRpc): AgentEvent {
	switch (frame.type) {
		case "agent_end":
		case "turn_end":
			return { type: frame.type };
		case "message_start":
		case "message_update":
		case "message_end":
			return { type: frame.type, message: frame.message } as AgentEvent;
		default:
			return frame as unknown as AgentEvent;
	}
}

function estadoWire(estado: RpcSessionState, cwd: string): SessionState {
	const model = estado.model;
	return {
		isStreaming: estado.isStreaming,
		queuedMessageCount: estado.queuedMessageCount,
		...(estado.sessionName ? { sessionName: estado.sessionName } : {}),
		cwd,
		...(model
			? {
					model: {
						id: model.id,
						name: model.name,
						provider: model.provider,
						contextWindow: model.contextWindow ?? null,
					},
				}
			: {}),
		...(estado.thinkingLevel ? { thinkingLevel: estado.thinkingLevel } : {}),
		...(estado.contextUsage ? { contextUsage: estado.contextUsage } : {}),
		participants: [],
	};
}

function estadoVazio(cwd: string): SessionState {
	return { isStreaming: false, queuedMessageCount: 0, cwd, participants: [] };
}

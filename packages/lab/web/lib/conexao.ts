// The page's line to its lab: `/ws` (or `/l/<id>/ws` through the entry lab) with reconnection
// (backoff 0.5 s → 10 s). Keeps the last Estado while offline (and since when), one ReplicaChat per
// subscribed chat, the voice frames and the entry lab's list of laboratórios.
import type {
	Estado,
	LivePhase,
	LiveTranscricao,
	MensagemCliente,
	MensagemServidor,
	ResumoLaboratorio,
} from "../tipos";
import { guardarEstado, guardarLaboratorios, laboratoriosGuardados, noLab } from "./laboratorio";
import { ReplicaChat } from "./replica";

export interface FotoConexao {
	estado: Estado | null;
	online: boolean;
	/** Epoch ms of the drop, while offline after having been online. */
	offlineDesde: number | null;
	/** The entry lab's laboratórios (the last ones seen in this browser until the first frame). */
	laboratorios: ResumoLaboratorio[] | null;
}

export interface QuadroVoz {
	chatId: string;
	fase?: LivePhase;
	transcricao?: LiveTranscricao;
	fim?: { erro: string | null };
}

const ESPERA_MIN_MS = 500;
const ESPERA_MAX_MS = 10_000;
/** The estado kept for when this lab is down is written at most this often. */
const GUARDAR_MS = 2_000;

export class Conexao {
	readonly #ouvintes = new Set<() => void>();
	readonly #ouvintesVoz = new Set<(quadro: QuadroVoz) => void>();
	readonly #ouvintesMemoria = new Set<(timeId: string) => void>();
	readonly #replicas = new Map<string, ReplicaChat>();
	/** Subscribed chats and how many views hold each. */
	readonly #assinados = new Map<string, number>();
	#ws: WebSocket | null = null;
	#espera = ESPERA_MIN_MS;
	#timer: Timer | null = null;
	#foto: FotoConexao = { estado: null, online: false, offlineDesde: null, laboratorios: laboratoriosGuardados() };
	#guardar: Timer | null = null;
	#fechada = false;

	constructor() {
		this.#abrir();
		addEventListener("online", this.#agora);
	}

	subscribe = (ouvinte: () => void): (() => void) => {
		this.#ouvintes.add(ouvinte);
		return () => this.#ouvintes.delete(ouvinte);
	};

	getSnapshot = (): FotoConexao => this.#foto;

	ouvirVoz(ouvinte: (quadro: QuadroVoz) => void): () => void {
		this.#ouvintesVoz.add(ouvinte);
		return () => this.#ouvintesVoz.delete(ouvinte);
	}

	/** An Egregore team's memory changed (`{t:"memoria"}`). */
	ouvirMemoria(ouvinte: (timeId: string) => void): () => void {
		this.#ouvintesMemoria.add(ouvinte);
		return () => this.#ouvintesMemoria.delete(ouvinte);
	}

	/** The chat's replica (created on first use; it fills once the chat is subscribed). */
	replica(chatId: string): ReplicaChat {
		let replica = this.#replicas.get(chatId);
		if (!replica) {
			replica = new ReplicaChat(chatId);
			this.#replicas.set(chatId, replica);
		}
		return replica;
	}

	/** Holds the chat's subscription (the server then sends welcome + snapshot); returns its release. */
	assinar(chatId: string): () => void {
		const antes = this.#assinados.get(chatId) ?? 0;
		this.#assinados.set(chatId, antes + 1);
		if (antes === 0) this.#enviar({ t: "assinar", chatId });
		let solto = false;
		return () => {
			if (solto) return;
			solto = true;
			const restam = (this.#assinados.get(chatId) ?? 1) - 1;
			if (restam > 0) {
				this.#assinados.set(chatId, restam);
				return;
			}
			this.#assinados.delete(chatId);
			this.#enviar({ t: "desassinar", chatId });
			this.#replicas.get(chatId)?.reiniciar();
		};
	}

	fechar(): void {
		this.#fechada = true;
		removeEventListener("online", this.#agora);
		clearTimeout(this.#timer ?? undefined);
		this.#ws?.close();
	}

	#agora = (): void => {
		if (this.#ws || this.#fechada) return;
		clearTimeout(this.#timer ?? undefined);
		this.#espera = ESPERA_MIN_MS;
		this.#abrir();
	};

	#abrir(): void {
		this.#timer = null;
		const url = new URL(noLab("/ws"), location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(url);
		this.#ws = ws;
		ws.onopen = () => {
			this.#espera = ESPERA_MIN_MS;
			for (const chatId of this.#assinados.keys()) {
				this.#replicas.get(chatId)?.reiniciar();
				ws.send(JSON.stringify({ t: "assinar", chatId } satisfies MensagemCliente));
			}
			this.#mudar({ online: true, offlineDesde: null });
		};
		ws.onmessage = evento => {
			if (typeof evento.data !== "string") return;
			let mensagem: MensagemServidor;
			try {
				mensagem = JSON.parse(evento.data);
			} catch {
				return;
			}
			this.#receber(mensagem);
		};
		ws.onclose = () => {
			if (this.#ws !== ws) return;
			this.#ws = null;
			if (this.#foto.online || this.#foto.offlineDesde === null) {
				this.#mudar({ online: false, offlineDesde: this.#foto.offlineDesde ?? Date.now() });
			}
			if (this.#fechada) return;
			this.#timer = setTimeout(() => this.#abrir(), this.#espera);
			this.#espera = Math.min(this.#espera * 2, ESPERA_MAX_MS);
		};
	}

	#receber(mensagem: MensagemServidor): void {
		switch (mensagem.t) {
			case "estado":
				this.#mudar({ estado: mensagem.estado });
				if (this.#guardar === null) {
					this.#guardar = setTimeout(() => {
						this.#guardar = null;
						if (this.#foto.estado) guardarEstado(this.#foto.estado);
					}, GUARDAR_MS);
				}
				break;
			case "laboratorios":
				this.#mudar({ laboratorios: mensagem.laboratorios });
				guardarLaboratorios(mensagem.laboratorios);
				break;
			case "chat":
				this.#replicas.get(mensagem.chatId)?.aplicar(mensagem.frame);
				break;
			case "voz":
				for (const ouvinte of this.#ouvintesVoz) ouvinte(mensagem);
				break;
			case "memoria":
				for (const ouvinte of this.#ouvintesMemoria) ouvinte(mensagem.timeId);
				break;
		}
	}

	#enviar(mensagem: MensagemCliente): void {
		if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(mensagem));
	}

	#mudar(parte: Partial<FotoConexao>): void {
		this.#foto = { ...this.#foto, ...parte };
		for (const ouvinte of this.#ouvintes) ouvinte();
	}
}

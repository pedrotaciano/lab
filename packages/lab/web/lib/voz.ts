// A voice call to a chat's agent: the browser holds the WebRTC peer (the mic track sendrecv and
// the "oai-events" data channel); the lab server relays the SDP to the chat's omp (`live_connect`),
// and its `{t:"voz"}` frames bring the phases and the captions. The audio itself goes straight
// between the browser and the realtime service.
import { api, caminhoDoChat, ErroApi } from "./api";
import type { LivePhase } from "../tipos";
import type { Conexao, QuadroVoz } from "./conexao";

export type FaseVoz = "conectando" | "ouvindo" | "trabalhando" | "falando" | "mudo" | "caiu" | "erro";

export interface Legenda {
	quem: "voce" | "agente";
	texto: string;
}

export interface FotoVoz {
	fase: FaseVoz;
	erro: string | null;
	/** Mic level, 0–1. */
	nivel: number;
	legenda: Legenda | null;
	mudo: boolean;
}

const ICE_MS = 2000;
const FASE_DO_SERVIDOR: Record<LivePhase, FaseVoz> = {
	connecting: "conectando",
	listening: "ouvindo",
	working: "trabalhando",
	speaking: "falando",
	muted: "mudo",
	error: "caiu",
};
/** Remote level over which the agent counts as speaking (live_connect never sends `speaking`). */
const FALA_LIMIAR = 0.04;

/** RMS of an analyser's current window, 0–1. */
function nivelDe(analisador: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
	analisador.getFloatTimeDomainData(buffer);
	let soma = 0;
	for (const amostra of buffer) soma += amostra * amostra;
	return Math.min(1, Math.sqrt(soma / buffer.length) * 3);
}

export class Chamada {
	readonly #ouvintes = new Set<() => void>();
	#foto: FotoVoz = { fase: "conectando", erro: null, nivel: 0, legenda: null, mudo: false };
	#pc: RTCPeerConnection | null = null;
	#mic: MediaStream | null = null;
	#audio: HTMLAudioElement | null = null;
	#ctx: AudioContext | null = null;
	#analisadorMic: AnalyserNode | null = null;
	#analisadorAgente: AnalyserNode | null = null;
	#quadro: number | null = null;
	#faseServidor: FaseVoz = "conectando";
	#ativa = false;
	#pararDeOuvir: (() => void) | null = null;

	constructor(
		readonly chatId: string,
		readonly conexao: Conexao,
	) {}

	subscribe = (ouvinte: () => void): (() => void) => {
		this.#ouvintes.add(ouvinte);
		return () => this.#ouvintes.delete(ouvinte);
	};

	getSnapshot = (): FotoVoz => this.#foto;

	async iniciar(): Promise<void> {
		this.#limpar();
		this.#mudar({ fase: "conectando", erro: null, nivel: 0, legenda: null, mudo: false });
		this.#faseServidor = "conectando";
		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			this.#mudar({ fase: "erro", erro: "A voz precisa de HTTPS (ou localhost)" });
			return;
		}
		try {
			this.#mic = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			});
		} catch (err) {
			const nome = err instanceof DOMException ? err.name : "";
			const erro =
				nome === "NotAllowedError" || nome === "SecurityError"
					? "Microfone bloqueado no navegador"
					: nome === "NotFoundError"
						? "Nenhum microfone encontrado"
						: "Não deu para abrir o microfone";
			this.#mudar({ fase: "erro", erro });
			return;
		}
		const track = this.#mic.getAudioTracks()[0];
		if (!track) {
			this.#mudar({ fase: "erro", erro: "Nenhum microfone encontrado" });
			return;
		}
		this.#ativa = true;
		this.#pararDeOuvir = this.conexao.ouvirVoz(this.#aoQuadro);
		addEventListener("pagehide", this.#aoSair);

		this.#ctx = new AudioContext();
		this.#analisadorMic = this.#ctx.createAnalyser();
		this.#analisadorMic.fftSize = 512;
		this.#ctx.createMediaStreamSource(this.#mic).connect(this.#analisadorMic);
		this.#medir();

		const pc = new RTCPeerConnection();
		this.#pc = pc;
		pc.addTransceiver(track, { direction: "sendrecv", streams: [this.#mic] });
		pc.createDataChannel("oai-events");
		pc.ontrack = evento => {
			const fluxo = evento.streams[0] ?? new MediaStream([evento.track]);
			const audio = new Audio();
			audio.autoplay = true;
			audio.srcObject = fluxo;
			void audio.play().catch(() => undefined);
			this.#audio = audio;
			if (this.#ctx) {
				this.#analisadorAgente = this.#ctx.createAnalyser();
				this.#analisadorAgente.fftSize = 512;
				this.#ctx.createMediaStreamSource(fluxo).connect(this.#analisadorAgente);
			}
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === "failed" && this.#ativa) this.#cair("A chamada caiu");
		};

		try {
			await pc.setLocalDescription(await pc.createOffer());
			await this.#esperarIce(pc);
			const sdp = pc.localDescription?.sdp;
			if (!sdp) throw new Error("sem SDP");
			const resposta = await api<{ sdp: string }>("POST", caminhoDoChat(this.chatId, "/voz"), { sdp });
			if (!this.#ativa) return;
			await pc.setRemoteDescription({ type: "answer", sdp: resposta.sdp });
		} catch (err) {
			if (!this.#ativa) return;
			const erro = err instanceof ErroApi ? err.message : "Não deu para ligar";
			void api("DELETE", caminhoDoChat(this.chatId, "/voz")).catch(() => undefined);
			this.#ativa = false;
			this.#limpar();
			this.#mudar({ fase: "erro", erro });
		}
	}

	alternarMudo(): void {
		if (!this.#ativa) return;
		const mudo = !this.#foto.mudo;
		for (const track of this.#mic?.getAudioTracks() ?? []) track.enabled = !mudo;
		this.#mudar({ mudo, fase: mudo ? "mudo" : this.#faseServidor === "mudo" ? "ouvindo" : this.#faseServidor });
		void api("POST", caminhoDoChat(this.chatId, "/voz/mudo"), { mudo }).catch(() => undefined);
	}

	encerrar(): void {
		if (this.#ativa) void api("DELETE", caminhoDoChat(this.chatId, "/voz")).catch(() => undefined);
		this.#ativa = false;
		this.#limpar();
	}

	#aoQuadro = (quadro: QuadroVoz): void => {
		if (quadro.chatId !== this.chatId || !this.#ativa) return;
		if (quadro.fase) {
			const fase = FASE_DO_SERVIDOR[quadro.fase];
			if (fase === "caiu") {
				this.#cair("A chamada caiu");
				return;
			}
			this.#faseServidor = fase;
			if (!this.#foto.mudo) this.#mudar({ fase });
		}
		if (quadro.transcricao) {
			this.#mudar({
				legenda: { quem: quadro.transcricao.role === "user" ? "voce" : "agente", texto: quadro.transcricao.text },
			});
		}
		if (quadro.fim) this.#cair(quadro.fim.erro ?? "A chamada caiu");
	};

	#aoSair = (): void => {
		if (!this.#ativa) return;
		void fetch(caminhoDoChat(this.chatId, "/voz"), { method: "DELETE", keepalive: true }).catch(() => undefined);
		this.#ativa = false;
		this.#limpar();
	};

	#cair(erro: string): void {
		if (this.#ativa) void api("DELETE", caminhoDoChat(this.chatId, "/voz")).catch(() => undefined);
		this.#ativa = false;
		this.#limpar();
		this.#mudar({ fase: "caiu", erro, nivel: 0 });
	}

	async #esperarIce(pc: RTCPeerConnection): Promise<void> {
		if (pc.iceGatheringState === "complete") return;
		const { promise, resolve } = Promise.withResolvers<void>();
		const pronto = (): void => {
			if (pc.iceGatheringState === "complete") resolve();
		};
		pc.addEventListener("icegatheringstatechange", pronto);
		const timer = setTimeout(resolve, ICE_MS);
		await promise;
		clearTimeout(timer);
		pc.removeEventListener("icegatheringstatechange", pronto);
	}

	#medir(): void {
		const buffer = new Float32Array(512);
		const passo = (): void => {
			this.#quadro = requestAnimationFrame(passo);
			const nivel = this.#analisadorMic && !this.#foto.mudo ? nivelDe(this.#analisadorMic, buffer) : 0;
			const falando = this.#analisadorAgente ? nivelDe(this.#analisadorAgente, buffer) > FALA_LIMIAR : false;
			const base = this.#faseServidor;
			const fase: FaseVoz = this.#foto.mudo
				? "mudo"
				: base === "ouvindo" && falando
					? "falando"
					: base === "falando" && !falando
						? "ouvindo"
						: base;
			if (Math.abs(nivel - this.#foto.nivel) > 0.02 || fase !== this.#foto.fase) this.#mudar({ nivel, fase });
		};
		passo();
	}

	#limpar(): void {
		if (this.#quadro !== null) cancelAnimationFrame(this.#quadro);
		this.#quadro = null;
		this.#pararDeOuvir?.();
		this.#pararDeOuvir = null;
		removeEventListener("pagehide", this.#aoSair);
		this.#pc?.close();
		this.#pc = null;
		for (const track of this.#mic?.getTracks() ?? []) track.stop();
		this.#mic = null;
		if (this.#audio) this.#audio.srcObject = null;
		this.#audio = null;
		void this.#ctx?.close().catch(() => undefined);
		this.#ctx = null;
		this.#analisadorMic = null;
		this.#analisadorAgente = null;
	}

	#mudar(parte: Partial<FotoVoz>): void {
		this.#foto = { ...this.#foto, ...parte };
		for (const ouvinte of this.#ouvintes) ouvinte();
	}
}

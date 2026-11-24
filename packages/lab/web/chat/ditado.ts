// The microphone beside Enviar (the POC's web/sala/chat.js montarAudio): records in the browser
// (MediaRecorder: webm/opus on Chrome and Android, mp4 on Safari and iPhone) and hands the audio
// over when it stops; the lab transcribes it on its own machine (src/transcricao.ts). Cancelled,
// or shorter than half a second, nothing comes.

export type FaseDitado = "ocioso" | "pedindo" | "gravando";

/** Five minutes at most: then it stops by itself. */
export const MAX_S = 5 * 60;
const CURTO_MS = 500;

interface Ouvido {
	ctx: AudioContext;
	analisador: AnalyserNode;
	dados: Uint8Array<ArrayBuffer>;
}

export function podeGravar(): boolean {
	return typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder === "function";
}

export class Gravador {
	fase: FaseDitado = "ocioso";
	/** performance.now() when recording began. */
	inicio = 0;
	#gravador: MediaRecorder | null = null;
	#fluxo: MediaStream | null = null;
	#ouvido: Ouvido | null = null;
	#pedacos: Blob[] = [];
	#cancelado = false;
	/** Stopped while the permission was still being asked. */
	#pararLogo = false;

	constructor(
		readonly aoMudar: () => void,
		readonly aoTerminar: (audio: Blob) => void,
		readonly aoErro: (mensagem: string) => void,
	) {}

	async comecar(): Promise<void> {
		if (this.fase !== "ocioso") return;
		this.#mudar("pedindo");
		this.#cancelado = false;
		this.#pararLogo = false;
		let fluxo: MediaStream;
		try {
			fluxo = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
			});
		} catch (err) {
			this.#mudar("ocioso");
			const nome = err instanceof Error ? err.name : "";
			this.aoErro(nome === "NotAllowedError" ? "O navegador não deixou usar o microfone." : "Sem microfone.");
			return;
		}
		this.#fluxo = fluxo;
		if (this.#cancelado || this.#pararLogo) {
			this.#largar();
			this.#mudar("ocioso");
			return;
		}
		const tipo = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t =>
			MediaRecorder.isTypeSupported(t),
		);
		const gravador = new MediaRecorder(fluxo, tipo ? { mimeType: tipo } : undefined);
		this.#gravador = gravador;
		this.#pedacos = [];
		gravador.addEventListener("dataavailable", event => {
			if (event.data.size) this.#pedacos.push(event.data);
		});
		gravador.addEventListener("stop", () => this.#terminou(gravador));
		gravador.start(250);
		try {
			const ctx = new AudioContext();
			const analisador = ctx.createAnalyser();
			analisador.fftSize = 512;
			ctx.createMediaStreamSource(fluxo).connect(analisador);
			this.#ouvido = { ctx, analisador, dados: new Uint8Array(analisador.fftSize) };
		} catch {
			// no meter, still recording
		}
		this.inicio = performance.now();
		this.#mudar("gravando");
	}

	/** Stop: the audio goes to `aoTerminar`. */
	parar(): void {
		if (this.fase === "pedindo") this.#pararLogo = true;
		else if (this.#gravador?.state === "recording") this.#gravador.stop();
	}

	/** Drop it: nothing comes. */
	cancelar(): void {
		this.#cancelado = true;
		this.parar();
	}

	/** The voice's loudness now, 0 to 1. */
	nivel(): number {
		const ouvido = this.#ouvido;
		if (!ouvido) return 0;
		ouvido.analisador.getByteTimeDomainData(ouvido.dados);
		let soma = 0;
		for (const v of ouvido.dados) soma += ((v - 128) / 128) ** 2;
		return Math.min(1, Math.sqrt(soma / ouvido.dados.length) * 5);
	}

	#mudar(fase: FaseDitado): void {
		this.fase = fase;
		this.aoMudar();
	}

	#largar(): void {
		for (const trilha of this.#fluxo?.getTracks() ?? []) trilha.stop();
		void this.#ouvido?.ctx.close().catch(() => {});
		this.#fluxo = null;
		this.#ouvido = null;
	}

	#terminou(gravador: MediaRecorder): void {
		const curto = performance.now() - this.inicio < CURTO_MS;
		this.#largar();
		this.#gravador = null;
		this.#mudar("ocioso");
		if (this.#cancelado || curto || this.#pedacos.length === 0) return;
		this.aoTerminar(new Blob(this.#pedacos, { type: gravador.mimeType || "audio/webm" }));
	}
}

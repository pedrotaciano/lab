// One chat's prompt box outside React: the draft, the files picked (each uploads as soon as it is
// picked, POST /api/chats/:id/anexos, and goes with the next message by id), the audios still
// transcribing (their words land at the end of the draft) and the sent texts for ↑. It outlives
// the box itself: switching chats or an ask card in its place keeps all of it.
import { api, caminhoDoChat } from "../lib/api";
import type { AnexoEnviado, EstadoTranscricao } from "../tipos";
import { tamanhoLegivel } from "./modelos";

/** The server's limit (src/anexos.ts). */
const MAX_ANEXO = 25 * 1024 * 1024;
const MAX_POR_MENSAGEM = 10;
const MAX_HISTORICO = 50;

export interface ItemAnexo {
	chave: number;
	arquivo: File;
	/** Object URL of an image, for its thumbnail. */
	local: string | null;
	estado: "enviando" | "pronto" | "erro";
	anexo: AnexoEnviado | null;
	erro: string | null;
	promessa: Promise<void>;
}

export interface AudioTranscrevendo {
	chave: number;
	descartado: boolean;
}

export function base64(blob: Blob): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const leitor = new FileReader();
	leitor.onload = () => resolve(String(leitor.result).split(",")[1] ?? "");
	leitor.onerror = () => reject(leitor.error ?? new Error("Não consegui ler o arquivo."));
	leitor.readAsDataURL(blob);
	return promise;
}

let transcricao: Promise<EstadoTranscricao> | null = null;

/** Whether this lab can transcribe the microphone (asked once per page). */
export function estadoTranscricao(): Promise<EstadoTranscricao> {
	transcricao ??= api<EstadoTranscricao>("GET", "/api/transcricao").catch((): EstadoTranscricao => ({
		disponivel: false,
		motivo: "Transcrição indisponível.",
	}));
	return transcricao;
}

let seq = 0;

export class CaixaChat {
	readonly #ouvintes = new Set<() => void>();
	#versao = 0;
	texto = "";
	anexos: ItemAnexo[] = [];
	audios: AudioTranscrevendo[] = [];
	/** Sent texts, newest last; `navegando` the one ↑ brought back (an index), or null. */
	historico: string[] = [];
	navegando: number | null = null;

	constructor(readonly chatId: string) {}

	subscribe = (ouvinte: () => void): (() => void) => {
		this.#ouvintes.add(ouvinte);
		return () => this.#ouvintes.delete(ouvinte);
	};

	getSnapshot = (): number => this.#versao;

	#mudou(): void {
		this.#versao++;
		for (const ouvinte of this.#ouvintes) ouvinte();
	}

	escrever(texto: string): void {
		this.texto = texto;
		if (this.navegando !== null && this.historico[this.navegando] !== texto) this.navegando = null;
		this.#mudou();
	}

	/** ↑ (`passo` -1) and ↓ (+1) through the sent texts; false when there is nowhere to go. */
	andarNoHistorico(passo: -1 | 1): boolean {
		if (this.historico.length === 0) return false;
		const atual = this.navegando ?? this.historico.length;
		const proximo = atual + passo;
		if (proximo < 0 || proximo > this.historico.length) return false;
		this.navegando = proximo === this.historico.length ? null : proximo;
		this.texto = this.navegando === null ? "" : this.historico[this.navegando]!;
		this.#mudou();
		return true;
	}

	/** Pick files for the next message; an error message for what could not come, or null. */
	adicionar(arquivos: readonly File[]): string | null {
		let erro: string | null = null;
		for (let arquivo of arquivos) {
			if (this.anexos.length >= MAX_POR_MENSAGEM) {
				erro = `Até ${MAX_POR_MENSAGEM} arquivos por mensagem.`;
				break;
			}
			if (arquivo.size > MAX_ANEXO) {
				erro = `${arquivo.name}: ${tamanhoLegivel(arquivo.size)}; o limite é ${tamanhoLegivel(MAX_ANEXO)}.`;
				continue;
			}
			if (arquivo.size === 0) {
				erro = `${arquivo.name} está vazio.`;
				continue;
			}
			// A pasted image comes as "image.png": name it for the history.
			if (/^image\.\w+$/.test(arquivo.name)) {
				const hora = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
				arquivo = new File([arquivo], `colada-${hora}.${arquivo.name.split(".").pop()}`, { type: arquivo.type });
			}
			const item: ItemAnexo = {
				chave: ++seq,
				arquivo,
				local:
					arquivo.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(arquivo.name)
						? URL.createObjectURL(arquivo)
						: null,
				estado: "enviando",
				anexo: null,
				erro: null,
				promessa: Promise.resolve(),
			};
			const enviado = arquivo;
			item.promessa = base64(enviado)
				.then(dados =>
					api<AnexoEnviado>("POST", caminhoDoChat(this.chatId, "/anexos"), { nome: enviado.name, dados }),
				)
				.then(
					anexo => {
						item.anexo = anexo;
						item.estado = "pronto";
					},
					(err: unknown) => {
						item.estado = "erro";
						item.erro = err instanceof Error ? err.message : "Não consegui enviar.";
					},
				)
				.then(() => this.#mudou());
			this.anexos = [...this.anexos, item];
		}
		this.#mudou();
		return erro;
	}

	tirar(item: ItemAnexo): void {
		if (item.local) URL.revokeObjectURL(item.local);
		this.anexos = this.anexos.filter(outro => outro !== item);
		this.#mudou();
	}

	/** Waits for the uploads; the files, or an error naming the one that failed. */
	async prontos(): Promise<AnexoEnviado[]> {
		const itens = this.anexos;
		await Promise.all(itens.map(item => item.promessa));
		const falhou = itens.find(item => item.estado === "erro");
		if (falhou) throw new Error(`${falhou.arquivo.name} não foi: ${falhou.erro}`);
		return itens.flatMap(item => (item.anexo ? [item.anexo] : []));
	}

	/** The message went: the draft and its files leave, the text joins the history. */
	enviada(texto: string, itens: readonly ItemAnexo[]): void {
		if (texto && this.historico.at(-1) !== texto) {
			this.historico = [...this.historico, texto].slice(-MAX_HISTORICO);
		}
		this.navegando = null;
		this.texto = "";
		this.anexos = this.anexos.filter(item => !itens.includes(item));
		this.#mudou();
	}

	/** It did not go: what was sent comes back, unless something new was written meanwhile. */
	devolver(texto: string, itens: readonly ItemAnexo[]): void {
		if (!this.texto.trim()) this.texto = texto;
		this.anexos = [...itens.filter(item => !this.anexos.includes(item)), ...this.anexos];
		this.#mudou();
	}

	/**
	 * A recording, transcribed on the lab's machine (POST /api/transcrever): a chip "transcrevendo…"
	 * meanwhile (the field stays free), then the words land after what is in the draft. Resolves
	 * with an error message, or null.
	 */
	async transcrever(audio: Blob): Promise<string | null> {
		const chip: AudioTranscrevendo = { chave: ++seq, descartado: false };
		this.audios = [...this.audios, chip];
		this.#mudou();
		try {
			const corpo = { dados: await base64(audio), tipo: audio.type || "audio/webm" };
			let resposta: { texto: string };
			try {
				resposta = await api<{ texto: string }>("POST", "/api/transcrever", corpo);
			} catch (err) {
				// The worker went away under the request (idle timer, restart): the next one takes the same audio.
				if (!(err instanceof Error && "status" in err && err.status === 503 && /parou/.test(err.message)))
					throw err;
				resposta = await api<{ texto: string }>("POST", "/api/transcrever", corpo);
			}
			if (chip.descartado) return null;
			const dito = resposta.texto.trim();
			if (!dito) return "Não entendi nada no áudio.";
			const antes = this.texto.replace(/\s+$/, "");
			this.texto = antes ? `${antes} ${dito}` : dito;
			return null;
		} catch (err) {
			return chip.descartado ? null : err instanceof Error ? err.message : String(err);
		} finally {
			this.audios = this.audios.filter(outro => outro !== chip);
			this.#mudou();
		}
	}

	descartarAudio(chip: AudioTranscrevendo): void {
		chip.descartado = true;
		this.audios = this.audios.filter(outro => outro !== chip);
		this.#mudou();
	}
}

const caixas = new Map<string, CaixaChat>();

export function caixaDoChat(chatId: string): CaixaChat {
	let caixa = caixas.get(chatId);
	if (!caixa) {
		caixa = new CaixaChat(chatId);
		caixas.set(chatId, caixa);
	}
	return caixa;
}

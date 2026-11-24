/**
 * Speech to text for the chat's microphone (`POST /api/transcrever`), on this machine only, run by
 * uv from its own cache (`uvx --offline`) with the model read from the Hugging Face cache and the
 * hub offline. Two engines, picked by the machine: mlx-whisper on Apple silicon (large-v3-turbo on
 * the GPU), faster-whisper on CPU everywhere else, with a smaller model. Nothing is downloaded and
 * the audio never leaves the machine; without the package or a model in the cache it says so, and
 * the page keeps the microphone off. Ported from the POC's `src/transcricao.mjs`.
 *
 * One Python worker, started on demand (the page warms it up when you start recording), keeps the
 * model loaded and takes one file per line on stdin; it goes away after {@link OCIOSO_MS} idle.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $which, type ChildProcess, logger, ptree, readLines } from "@oh-my-pi/pi-utils";
import { ErroLab } from "./chat";
import type { EstadoTranscricao } from "./tipos";

/** ~1.6 GB (mlx) or ~0.5 GB (faster-whisper small) in memory: let it go when unused. */
const OCIOSO_MS = 10 * 60 * 1000;
/** One transcription, at most. */
const PRAZO_MS = 3 * 60 * 1000;
const MARCA = "@@lab ";
const EXTENSAO: Record<string, string> = {
	"audio/webm": ".webm",
	"audio/ogg": ".ogg",
	"audio/mp4": ".m4a",
	"audio/mpeg": ".mp3",
	"audio/wav": ".wav",
	"audio/x-wav": ".wav",
	"audio/aiff": ".aiff",
	"audio/x-aiff": ".aiff",
};

// The worker's protocol, shared by both engines: it loads `modelo` (argv[1]); each request turns
// pedido["arquivo"] into `texto`, keeping only the segments `vale` passes. One decode at
// temperature 0, no fallback (Whisper's retries at higher temperatures take minutes on silence);
// a degenerate loop (compression ratio over 2.4) or most likely no speech is dropped.
const VALE = `
def vale(compression_ratio, no_speech_prob, avg_logprob):
    return compression_ratio <= 2.4 and not (no_speech_prob > 0.5 and avg_logprob < -0.8)
`;
const TRANSCREVER_MLX = `        r = transcribe(pedido["arquivo"], path_or_hf_repo=modelo, language="pt", verbose=None, condition_on_previous_text=False, temperature=0.0)
        texto = "".join(s["text"] for s in r["segments"] if vale(s.get("compression_ratio", 0), s.get("no_speech_prob", 0), s.get("avg_logprob", 0)))`;
const TRANSCREVER_FASTER = `        partes, _ = m.transcribe(pedido["arquivo"], language="pt", beam_size=1, vad_filter=True, condition_on_previous_text=False, temperature=0.0)
        texto = "".join(p.text for p in partes if vale(p.compression_ratio, p.no_speech_prob, p.avg_logprob))`;

function programaPython(carregar: string, transcrever: string): string {
	return `
import json, sys
modelo = sys.argv[1]
def dizer(o):
    sys.stdout.write(${JSON.stringify(MARCA)} + json.dumps(o, ensure_ascii=False) + "\\n")
    sys.stdout.flush()
${VALE}
${carregar}
dizer({"pronto": True})
for linha in sys.stdin:
    pedido = json.loads(linha)
    try:
${transcrever}
        dizer({"id": pedido["id"], "texto": texto.strip()})
    except Exception as e:
        dizer({"id": pedido["id"], "erro": str(e)})
`;
}

interface Motor {
	pacote: string;
	/** Hugging Face repos tried in order (`LAB_WHISPER` goes first). */
	modelos: string[];
	pesos: RegExp;
	/** mlx-whisper decodes the audio with the ffmpeg command. */
	ffmpeg: boolean;
	/** The Python with wheels for the engine, when uv's default won't do. */
	versao?: string;
	python: string;
}

const MLX: Motor = {
	pacote: "mlx-whisper",
	modelos: ["mlx-community/whisper-large-v3-turbo", "mlx-community/whisper-large-v3-mlx"],
	pesos: /^weights\.(safetensors|npz)$/,
	ffmpeg: true,
	python: programaPython(
		"import mlx.core as mx\nfrom mlx_whisper.transcribe import ModelHolder, transcribe\nModelHolder.get_model(modelo, mx.float16)",
		TRANSCREVER_MLX,
	),
};

/** CTranslate2 on CPU with int8 weights; PyAV (bundled) decodes the audio, no ffmpeg needed. */
const FASTER: Motor = {
	pacote: "faster-whisper",
	modelos: ["Systran/faster-whisper-small", "Systran/faster-whisper-base"],
	pesos: /^model\.bin$/,
	ffmpeg: false,
	versao: "3.12",
	python: programaPython(
		'from faster_whisper import WhisperModel\nm = WhisperModel(modelo, device="cpu", compute_type="int8")',
		TRANSCREVER_FASTER,
	),
};

const MAC = process.platform === "darwin";
/** The engine this machine runs: mlx-whisper on Apple silicon, faster-whisper elsewhere. */
const MOTOR: Motor = MAC && process.arch === "arm64" ? MLX : FASTER;

async function emCache(repo: string, pesos: RegExp): Promise<boolean> {
	const hub =
		Bun.env.HF_HUB_CACHE || path.join(Bun.env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface"), "hub");
	const pasta = path.join(hub, `models--${repo.replace("/", "--")}`, "snapshots");
	try {
		for (const snapshot of await fs.readdir(pasta)) {
			if ((await fs.readdir(path.join(pasta, snapshot))).some(arquivo => pesos.test(arquivo))) return true;
		}
	} catch {
		// not downloaded
	}
	return false;
}

interface Pedido {
	resolve(texto: string): void;
	reject(erro: Error): void;
	prazo: NodeJS.Timeout;
}

interface Worker {
	processo: ChildProcess<"pipe">;
	pronto: Promise<void>;
	pedidos: Map<number, Pedido>;
}

export class Transcricao {
	#worker: Worker | null = null;
	#ocioso: NodeJS.Timeout | undefined;
	#seq = 0;

	/** Whether it can run here, and if not, why (the page shows the reason on the microphone). */
	async estado(): Promise<EstadoTranscricao> {
		const mt = MOTOR;
		if (!$which("uvx")) {
			return { disponivel: false, motivo: MAC ? "Falta o uv (brew install uv)." : "Falta o uv." };
		}
		if (mt.ffmpeg && !$which("ffmpeg")) return { disponivel: false, motivo: "Falta o ffmpeg (brew install ffmpeg)." };
		for (const repo of [Bun.env.LAB_WHISPER, ...mt.modelos]) {
			if (repo && (await emCache(repo, mt.pesos))) return { disponivel: true, modelo: repo };
		}
		return { disponivel: false, motivo: "Nenhum modelo Whisper baixado." };
	}

	/** Start the worker ahead of the audio, so the model is loaded by the time it arrives. */
	async aquecer(): Promise<EstadoTranscricao> {
		const estado = await this.estado();
		if (estado.disponivel) this.#iniciar(estado.modelo);
		return estado;
	}

	async transcrever(audio: Uint8Array, tipo: string): Promise<string> {
		const estado = await this.estado();
		if (!estado.disponivel) throw new ErroLab(503, estado.motivo);
		const worker = this.#iniciar(estado.modelo);
		const ext = EXTENSAO[tipo.split(";")[0]!.trim().toLowerCase()] ?? ".webm";
		const id = ++this.#seq;
		const arquivo = path.join(os.tmpdir(), `lab-audio-${process.pid}-${id}${ext}`);
		await Bun.write(arquivo, audio);
		await fs.chmod(arquivo, 0o600);
		try {
			await worker.pronto;
			const { promise, resolve, reject } = Promise.withResolvers<string>();
			const prazo = setTimeout(() => {
				worker.pedidos.delete(id);
				reject(new ErroLab(504, "A transcrição demorou demais."));
			}, PRAZO_MS);
			worker.pedidos.set(id, { resolve, reject, prazo });
			worker.processo.stdin.write(`${JSON.stringify({ id, arquivo })}\n`);
			worker.processo.stdin.flush();
			return limparTranscricao(await promise);
		} finally {
			await fs.rm(arquivo, { force: true });
			this.#adiar();
		}
	}

	parar(): void {
		clearTimeout(this.#ocioso);
		this.#worker?.processo.kill();
		this.#worker = null;
	}

	#adiar(): void {
		clearTimeout(this.#ocioso);
		this.#ocioso = setTimeout(() => this.parar(), OCIOSO_MS);
		this.#ocioso.unref();
	}

	#iniciar(modelo: string): Worker {
		this.#adiar();
		if (this.#worker) return this.#worker;
		const mt = MOTOR;
		const versao = mt.versao ? ["--python", mt.versao] : [];
		const processo = ptree.spawn(
			["uvx", "--offline", "--quiet", ...versao, "--from", mt.pacote, "python", "-c", mt.python, modelo],
			{
				env: {
					...Bun.env,
					HF_HUB_OFFLINE: "1",
					TRANSFORMERS_OFFLINE: "1",
					HF_HUB_DISABLE_TELEMETRY: "1",
					PYTHONUNBUFFERED: "1",
				},
				stdin: "pipe",
			},
		);
		const pronto = Promise.withResolvers<void>();
		pronto.promise.catch(() => {});
		const worker: Worker = { processo, pronto: pronto.promise, pedidos: new Map() };
		const fim = (erro: Error): void => {
			if (this.#worker === worker) this.#worker = null;
			pronto.reject(erro);
			for (const pedido of worker.pedidos.values()) {
				clearTimeout(pedido.prazo);
				pedido.reject(erro);
			}
			worker.pedidos.clear();
		};
		void (async () => {
			const decoder = new TextDecoder();
			for await (const bruta of readLines(processo.stdout)) {
				const linha = decoder.decode(bruta);
				if (!linha.startsWith(MARCA)) continue;
				const msg = JSON.parse(linha.slice(MARCA.length)) as {
					pronto?: boolean;
					id?: number;
					texto?: string;
					erro?: string;
				};
				if (msg.pronto) pronto.resolve();
				const pedido = msg.id === undefined ? undefined : worker.pedidos.get(msg.id);
				if (!pedido || msg.id === undefined) continue;
				worker.pedidos.delete(msg.id);
				clearTimeout(pedido.prazo);
				if (msg.erro) pedido.reject(new ErroLab(502, `A transcrição falhou: ${msg.erro}`));
				else pedido.resolve(msg.texto ?? "");
			}
		})().catch((err: unknown) => logger.warn("lab: whisper output unreadable", { error: String(err) }));
		void processo.exited.then(
			codigo => {
				const erro = processo.peekStderr();
				if (codigo) {
					logger.warn("lab: whisper exited", {
						code: codigo,
						stderr: erro.trim().split("\n").slice(-3).join(" | "),
					});
				}
				if (/No solution found|offline|not found in the cache/i.test(erro)) {
					fim(new ErroLab(503, `O ${mt.pacote} não está no cache do uv.`));
				} else {
					// The worker went away under a request (the idle timer, a crash): the same audio works on the next one.
					fim(new ErroLab(503, "O Whisper parou. Tente de novo."));
				}
			},
			(err: unknown) => fim(new ErroLab(503, `Não consegui rodar o uvx: ${String(err)}`)),
		);
		this.#worker = worker;
		return worker;
	}
}

// Whisper's own lines for silence and noise (the YouTube captions it learned from): never someone
// in the room, cut wherever they show up.
const SEMPRE = [
	/se inscreva no canal[^.!?]*[.!?]?/giu,
	/ative o sininho[^.!?]*[.!?]?/giu,
	/legendas? (?:pela comunidade )?amara\.org[.!?]?/giu,
	/obrigad[oa] por assistir[.!?]?/giu,
];
/** One word 4 times in a row: "Obrigado Obrigado Obrigado Obrigado". */
const REPETE_PALAVRA = 4;
/** A phrase of 2 to {@link MAX_FRASE} words 3 times in a row. */
const REPETE_FRASE = 3;
const MAX_FRASE = 8;

/**
 * The text of one transcription without what Whisper makes up from silence: its caption lines, the
 * dots it writes for nothing (". . . ." and "... ... ..."), and a degenerate loop (a word 4 times
 * or a phrase 3 times in a row, the whole run, unless said with commas: "Não, não, não, não." is
 * someone). Empty when nothing real is left.
 */
export function limparTranscricao(texto: string): string {
	let t = texto;
	for (const r of SEMPRE) t = t.replace(r, " ");
	t = t.replace(/\.(?:\s+\.)+/g, " ").replace(/(?:\.{2,}\s*){2,}/g, " ");
	const palavras = t.split(/\s+/).filter(Boolean);
	const chaves = palavras.map(palavra => palavra.toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, ""));
	const iguais = (a: number, b: number, n: number): boolean => {
		for (let j = 0; j < n; j++) if (!chaves[a + j] || chaves[a + j] !== chaves[b + j]) return false;
		return !palavras[b - 1]!.endsWith(","); // a list said with commas is speech
	};
	for (let i = 0; i < palavras.length;) {
		let cortou = false;
		for (let n = 1; n <= MAX_FRASE && !cortou; n++) {
			let k = 1;
			while (i + (k + 1) * n <= palavras.length && iguais(i, i + k * n, n)) k++;
			if (k >= (n === 1 ? REPETE_PALAVRA : REPETE_FRASE)) {
				palavras.splice(i, k * n);
				chaves.splice(i, k * n);
				cortou = true;
			}
		}
		if (!cortou) i++;
	}
	return palavras
		.join(" ")
		.split(/(?<=[.!?…])\s+(?=[\p{Lu}¿¡"“(])/u)
		.filter(frase => /[\p{L}\p{N}]/u.test(frase.replace(/[.!?…]/g, "")))
		.map(frase => frase.trim())
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Files sent from the page's prompt box (the POC's `src/anexos.mjs`): each one is saved under
 * `$LAB_CASA/anexos/<chat>/` as soon as it is picked (`POST /api/chats/:id/anexos`) and goes with
 * the next message by id. The model gets a line per file with its path, and the images it can see
 * as RPC `images`. Ids live in memory: after a restart the page sends the file again.
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { prompt } from "@oh-my-pi/pi-utils";
import type { ImageContent, SessionEntry, TextContent } from "@oh-my-pi/pi-wire";
import { ErroLab, type Imagem } from "./chat";
import modeloAnexos from "./prompts/anexos.md" with { type: "text" };
import type { AnexoEnviado } from "./tipos";

export const MAX_ANEXO = 25 * 1024 * 1024;
/** Images the model receives as images; bigger ones or other formats go as a path only. */
const IMAGEM_MODELO: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};
const MAX_IMAGEM_MODELO = 5 * 1024 * 1024;
/** Base64 as a browser's FileReader writes it (or base64url), whitespace allowed. */
const BASE64 = /^[A-Za-z0-9+/_\-\s]*={0,2}\s*$/;
const TIPOS: Array<[RegExp, string]> = [
	[/\.(png|jpe?g|gif|webp|heic|avif|bmp|svg)$/i, "imagem"],
	[/\.(mp4|mov|webm|mkv|m4v)$/i, "vídeo"],
	[/\.(mp3|m4a|wav|aiff?|ogg|flac)$/i, "áudio"],
	[/\.pdf$/i, "pdf"],
	[/\.html?$/i, "html"],
	[/\.(md|markdown)$/i, "markdown"],
	[/\.(txt|csv|json|ya?ml|log)$/i, "texto"],
];

export const legivel = (n: number): string =>
	n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1).replace(/\.0$/, "")} MB`;

// What `prompts/anexos.md` renders, read back for the page (test/anexos.test.ts renders the template
// and checks it reads back): the words, a blank line, `[Anexos de <quem>]`, then one line per file,
// `- <caminho> (<tipo>, <tamanho>)` or `…; vai junto como imagem)`. Without words, they are
// `(<quem> mandou só os anexos.)`.
const CABECALHO = "\n\n[Anexos de ";
const ESCAPAR = /[.*+?^${}()|[\]\\]/g;
const LINHA_ANEXO = new RegExp(
	`^- (/.+) \\((${[...TIPOS.map(([, tipo]) => tipo), "arquivo"].map(t => t.replace(ESCAPAR, "\\$&")).join("|")}), (\\d+ B|\\d+ KB|\\d+(?:\\.\\d)? MB)(; vai junto como imagem)?\\)$`,
);
/** `receber` names the file `<base36 time>-<6 hex>-<name>`. */
const PREFIXO_SALVO = /^[0-9a-z]+-[0-9a-f]{6}-/;

/**
 * The page's view of a text `Anexos.mensagem` built: the user's words without the attachment block
 * (the model keeps it), each file that did not go as an image by its name (`inline code`, a line).
 * Null when `texto` is not such a message.
 */
export function textoParaTela(texto: string): string | null {
	const inicio = texto.lastIndexOf(CABECALHO);
	if (inicio < 0) return null;
	const [cabecalho, ...linhas] = texto.slice(inicio + CABECALHO.length).split("\n");
	if (!cabecalho?.endsWith("]") || linhas.length === 0) return null;
	const quem = cabecalho.slice(0, -1);
	const nomes: string[] = [];
	for (const linha of linhas) {
		const achado = LINHA_ANEXO.exec(linha);
		if (!achado) return null;
		if (!achado[4]) nomes.push(path.basename(achado[1]!).replace(PREFIXO_SALVO, ""));
	}
	const antes = texto.slice(0, inicio);
	const palavras = antes === `(${quem} mandou só os anexos.)` ? "" : antes;
	return [palavras, nomes.map(nome => `\`${nome.replaceAll("`", "'")}\``).join("\n")].filter(Boolean).join("\n\n");
}

/** A session entry as the page shows it: a user message (or a participant's) without its attachment block. */
export function entradaParaTela(entry: SessionEntry): SessionEntry {
	if (entry.type === "message" && entry.message.role === "user") {
		const conteudo = conteudoParaTela(entry.message.content);
		return conteudo === entry.message.content ? entry : { ...entry, message: { ...entry.message, content: conteudo } };
	}
	if (entry.type === "custom_message") {
		const conteudo = conteudoParaTela(entry.content);
		return conteudo === entry.content ? entry : { ...entry, content: conteudo };
	}
	return entry;
}

type Conteudo = string | (TextContent | ImageContent)[];

function conteudoParaTela(conteudo: Conteudo): Conteudo {
	if (typeof conteudo === "string") return textoParaTela(conteudo) ?? conteudo;
	let mudou = false;
	const blocos = conteudo.map(bloco => {
		if (bloco.type !== "text") return bloco;
		const tela = textoParaTela(bloco.text);
		if (tela === null) return bloco;
		mudou = true;
		return { ...bloco, text: tela };
	});
	return mudou ? blocos : conteudo;
}

interface Registro extends AnexoEnviado {
	chatId: string;
	caminho: string;
}

export class Anexos {
	readonly #pasta: string;
	readonly #porId = new Map<string, Registro>();

	constructor(casa: string) {
		this.#pasta = path.join(casa, "anexos");
	}

	/** A file as the page sends it (`{nome, dados}` in base64), written for the chat's next message. */
	async receber(chatId: string, corpo: Record<string, unknown>): Promise<AnexoEnviado> {
		const bruto = typeof corpo.nome === "string" ? corpo.nome : "";
		const nome =
			path
				.basename(bruto)
				.replace(/[\0/\\:]/g, "")
				.replace(/^\.+/, "")
				.trim()
				.slice(0, 120) || "arquivo";
		if (typeof corpo.dados !== "string" || !corpo.dados) throw new ErroLab(400, "mande o arquivo em `dados` (base64)");
		if (!BASE64.test(corpo.dados)) throw new ErroLab(400, "o arquivo em `dados` não é base64");
		const dados = Buffer.from(corpo.dados, "base64");
		if (dados.length === 0) throw new ErroLab(400, "O arquivo está vazio.");
		if (dados.length > MAX_ANEXO) throw new ErroLab(413, `O arquivo passa de ${legivel(MAX_ANEXO)}.`);
		const pasta = path.join(this.#pasta, chatId);
		await fs.mkdir(pasta, { recursive: true });
		const id = randomBytes(9).toString("hex");
		const caminho = path.join(pasta, `${Date.now().toString(36)}-${id.slice(0, 6)}-${nome}`);
		await Bun.write(caminho, dados);
		const mime = IMAGEM_MODELO[path.extname(nome).toLowerCase()];
		const registro: Registro = {
			id,
			nome,
			tamanho: dados.length,
			imagem: mime !== undefined && dados.length <= MAX_IMAGEM_MODELO,
			chatId,
			caminho,
		};
		this.#porId.set(id, registro);
		return { id, nome, tamanho: registro.tamanho, imagem: registro.imagem };
	}

	/**
	 * The message omp receives for `texto` with the attachments `ids`: the text, then a line per
	 * file with its path (the template `prompts/anexos.md`), and the images it can see.
	 */
	async mensagem(
		chatId: string,
		texto: string,
		ids: readonly string[],
		quem: string,
	): Promise<{ texto: string; imagens: Imagem[] }> {
		if (ids.length === 0) return { texto, imagens: [] };
		const imagens: Imagem[] = [];
		const anexos: Array<{ caminho: string; tipo: string; tamanho: string; imagem: boolean }> = [];
		for (const id of ids) {
			const registro = this.#porId.get(id);
			if (!registro || registro.chatId !== chatId) {
				throw new ErroLab(400, "Anexo não encontrado; mande o arquivo de novo.");
			}
			let imagem = false;
			if (registro.imagem) {
				const mimeType = IMAGEM_MODELO[path.extname(registro.nome).toLowerCase()]!;
				const dados = await Bun.file(registro.caminho)
					.bytes()
					.catch(() => null);
				if (dados) {
					imagens.push({ type: "image", data: Buffer.from(dados).toString("base64"), mimeType });
					imagem = true;
				}
			}
			anexos.push({
				caminho: registro.caminho,
				tipo: TIPOS.find(([padrao]) => padrao.test(registro.nome))?.[1] ?? "arquivo",
				tamanho: legivel(registro.tamanho),
				imagem,
			});
		}
		return { texto: prompt.render(modeloAnexos, { texto: texto.trim(), quem, anexos }), imagens };
	}
}

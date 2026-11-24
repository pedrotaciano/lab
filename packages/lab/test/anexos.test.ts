import { describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Anexos, entradaParaTela, textoParaTela } from "../src/anexos";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
	"base64",
).toString("base64");

async function anexos(): Promise<Anexos> {
	return new Anexos(await fs.mkdtemp(path.join(os.tmpdir(), "lab-anexos-")));
}

describe("the attachment block, read back for the page", () => {
	test("the words stay, images leave (their thumbnail shows), other files by name", async () => {
		const a = await anexos();
		const imagem = await a.receber("c1", { nome: "tela.png", dados: PNG });
		const pdf = await a.receber("c1", {
			nome: "relatório (final).pdf",
			dados: Buffer.from("%PDF").toString("base64"),
		});
		const { texto, imagens } = await a.mensagem("c1", "Olha isso", [imagem.id, pdf.id], "Pedro Taciano");
		expect(texto).toContain("[Anexos de Pedro Taciano]");
		expect(imagens).toHaveLength(1);
		expect(textoParaTela(texto)).toBe("Olha isso\n\n`relatório (final).pdf`");
	});

	test("only files: no words, no placeholder", async () => {
		const a = await anexos();
		const imagem = await a.receber("c1", { nome: "image.png", dados: PNG });
		const { texto } = await a.mensagem("c1", "", [imagem.id], "Carly");
		expect(texto.startsWith("(Carly mandou só os anexos.)")).toBe(true);
		expect(textoParaTela(texto)).toBe("");
	});

	test("a text that only looks like it is left alone", () => {
		expect(textoParaTela("oi\n\n[Anexos de Ana]\n- não é um caminho")).toBeNull();
		expect(textoParaTela("oi")).toBeNull();
	});

	test("entries: the user's text block changes, the image block stays", async () => {
		const a = await anexos();
		const imagem = await a.receber("c1", { nome: "x.png", dados: PNG });
		const { texto, imagens } = await a.mensagem("c1", "veja", [imagem.id], "Pedro");
		const entry = {
			type: "message" as const,
			id: "e1",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: {
				role: "user" as const,
				content: [{ type: "text" as const, text: texto }, ...imagens],
				timestamp: 0,
			},
		};
		const tela = entradaParaTela(entry);
		expect(tela.type === "message" && tela.message.content).toEqual([{ type: "text", text: "veja" }, ...imagens]);
	});
});

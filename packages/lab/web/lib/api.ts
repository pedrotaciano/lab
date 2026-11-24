// The lab server's REST API (src/server.ts): JSON in, JSON out; errors come as `{erro}`.

export class ErroApi extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ErroApi";
	}
}

type Metodo = "GET" | "POST" | "DELETE";

export async function api<T>(metodo: Metodo, caminho: string, corpo?: unknown): Promise<T> {
	let resposta: Response;
	// The server takes writes only as JSON (a CORS preflight for cross-site pages): `{}` when empty.
	const enviar = corpo ?? (metodo === "POST" ? {} : undefined);
	try {
		resposta = await fetch(caminho, {
			method: metodo,
			headers: enviar === undefined ? undefined : { "content-type": "application/json" },
			body: enviar === undefined ? undefined : JSON.stringify(enviar),
		});
	} catch {
		throw new ErroApi("Sem conexão", 0);
	}
	const texto = await resposta.text();
	let dados: unknown = null;
	if (texto) {
		try {
			dados = JSON.parse(texto);
		} catch {
			dados = null;
		}
	}
	if (!resposta.ok) {
		const erro =
			dados !== null && typeof dados === "object" && "erro" in dados && typeof dados.erro === "string"
				? dados.erro
				: `Erro ${resposta.status}`;
		throw new ErroApi(erro, resposta.status);
	}
	return dados as T;
}

export const caminhoDoChat = (chatId: string, resto = ""): string => `/api/chats/${encodeURIComponent(chatId)}${resto}`;

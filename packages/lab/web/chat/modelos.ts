// The poço line's words (the POC's web/sala/modelo.js and contexto.js): friendly model names,
// the effort cycle and its names, token and dollar amounts.

/** omp thinking selectors by their name here. */
export const NIVEIS: Record<string, string> = {
	auto: "padrão",
	minimal: "mínimo",
	low: "baixo",
	medium: "médio",
	high: "alto",
	xhigh: "muito alto",
	max: "máximo",
	off: "sem pensar",
};

/** The effort button's cycle, one level per click; `auto` leaves the effort to omp. */
const CICLO = ["auto", "low", "medium", "high", "max"] as const;

/** How many of the four pixels each selector lights. */
export const ACESAS: Record<string, number> = {
	auto: 0,
	off: 0,
	minimal: 1,
	low: 1,
	medium: 2,
	high: 3,
	xhigh: 3,
	max: 4,
};
/** Selectors from least to most effort, to find the next one up. */
const ORDEM = ["auto", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The next effort after `atual` among the selectors the model accepts (`aceitos`): padrão → baixo
 * → médio → alto → máximo → padrão. A model without máximo tops at its highest (`xhigh`).
 */
export function proximoEsforco(atual: string | null, aceitos: readonly string[]): string | null {
	const ciclo: string[] = CICLO.filter(nivel => aceitos.includes(nivel));
	if (!aceitos.includes("max") && aceitos.includes("xhigh")) ciclo.push("xhigh");
	if (ciclo.length < 2) return null;
	const posicao = ORDEM.indexOf(atual ?? "auto");
	return ciclo.find(nivel => ORDEM.indexOf(nivel) > posicao) ?? ciclo[0]!;
}

/**
 * A readable name from a model id, for one omp doesn't name: "anthropic/claude-opus-5-5" →
 * "Opus 5.5", "gpt-5-mini" → "GPT 5 Mini". Never the raw id.
 */
function nomeDoId(id: string): string {
	const base = (id.split("/").pop() ?? id).replace(/^claude-/i, "").replace(/-\d{8}$/, "");
	const saida: string[] = [];
	for (const parte of base.split(/[-_\s]+/).filter(Boolean)) {
		const anterior = saida.at(-1);
		if (/^\d+$/.test(parte) && anterior && /^\d+(\.\d+)*$/.test(anterior))
			saida[saida.length - 1] = `${anterior}.${parte}`;
		else if (/^(gpt|glm|o\d)$/i.test(parte)) saida.push(parte.toUpperCase());
		else saida.push(/^\d/.test(parte) ? parte : parte.charAt(0).toUpperCase() + parte.slice(1));
	}
	return saida.join(" ") || id;
}

/** "Claude Opus 5.5" → "Opus 5.5"; without a name, one made from the id. */
export function nomeAmigavel(nome: string | null | undefined, id: string): string {
	return (nome ?? "").replace(/^Claude\s+/i, "").trim() || nomeDoId(id);
}

/** 1 234 → "1K", 1 500 000 → "1,5M". */
export function mil(n: number): string {
	if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "").replace(".", ",")}M`;
	return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

export function dolares(n: number): string {
	return n
		.toLocaleString("pt-BR", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		})
		.replace(/\s/g, " ");
}

/** "agora", "há 3 min", "há 2 h", "há 4 dias". */
export function haQuanto(quando: number, agora = Date.now()): string {
	const s = Math.max(0, Math.round((agora - quando) / 1000));
	if (s < 60) return "agora";
	if (s < 3600) return `há ${Math.floor(s / 60)} min`;
	if (s < 86_400) return `há ${Math.floor(s / 3600)} h`;
	const dias = Math.floor(s / 86_400);
	return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export function tamanhoLegivel(n: number): string {
	if (n < 1024) return `${n} B`;
	return n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 ** 2).toFixed(1).replace(/\.0$/, "")} MB`;
}

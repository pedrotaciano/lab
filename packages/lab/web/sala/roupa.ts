// The clothes of a role (ported from the POC, laboratorio/web/sala/roupa.js). A figure is two
// parts: the person (body, skin, hair and beard: from the chat's id, arte.ts sortear) and the
// role (hat, glasses, top, jacket, trousers and shoes: from this table). The colours are the
// house's, as tints (arte.ts colourOf reads them by name): never orange (what waits for you).

export interface Tom {
	h: number;
	s: number;
	b: number;
	c?: number;
	colorize?: boolean;
	palette?: string;
}

/** The house's colours as tints: colorize to the token's hue and saturation, `b` taking the mid grey to the token's light. */
export const CASA: Record<string, Tom> = {
	noite: { h: 38, s: 15, b: -62, colorize: true }, // #29251e
	papel: { h: 75, s: 10, b: 78, colorize: true }, // #f1f2ee
	azul: { h: 223, s: 52, b: -6, colorize: true }, // #4e70c6
	verde: { h: 149, s: 85, b: -18, colorize: true }, // #027539
	cinza: { h: 162, s: 6, b: 6, colorize: true }, // #7a8481
};

/** A figure's pieces and colours (wardrobe.json ids and palette labels). */
export interface Look {
	corpo?: string;
	pele?: string;
	cabelo?: string;
	corCabelo?: string;
	barba?: string | null;
	corBarba?: string | null;
	chapeu?: string | null;
	corChapeu?: string | null;
	oculos?: string | null;
	corOculos?: string | null;
	cima?: string | null;
	corCima?: string | null;
	jaqueta?: string | null;
	corJaqueta?: string | null;
	calca?: string | null;
	corCalca?: string | null;
	sapato?: string | null;
	corSapato?: string | null;
}

/** What a look takes from the person, never from the role. */
const PESSOA = ["corpo", "pele", "cabelo", "corCabelo", "barba", "corBarba"] as const;

/** The ten: agente (no role) and the nine roles. */
export const PAPEIS: Record<string, Look> = {
	agente: {
		cima: "tshirt",
		corCima: "papel",
		calca: "jeans",
		corCalca: "azul",
		sapato: "sneakers",
		corSapato: "noite",
	},
	hacker: {
		chapeu: "capuz",
		corChapeu: "noite",
		cima: "moletom",
		corCima: "noite",
		calca: "jeans",
		corCalca: "noite",
		sapato: "sneakers",
		corSapato: "noite",
	},
	programador: {
		oculos: "glasses",
		corOculos: "Black",
		cima: "xadrez",
		corCima: "azul",
		calca: "jeans",
		corCalca: "noite",
		sapato: "sneakers",
		corSapato: "papel",
	},
	testador: {
		chapeu: "plain_cap",
		corChapeu: "verde",
		cima: "tshirt",
		corCima: "papel",
		jaqueta: "vest",
		corJaqueta: "verde",
		calca: "jeans",
		corCalca: "azul",
		sapato: "boots",
		corSapato: "noite",
	},
	revisora: {
		cima: "turtleneck",
		corCima: "papel",
		jaqueta: "long_coat",
		corJaqueta: "noite",
		calca: "jeans",
		corCalca: "noite",
		sapato: "boots",
		corSapato: "noite",
	},
	artista: {
		chapeu: "gorro_mole",
		corChapeu: "noite",
		cima: "listrada",
		corCima: "azul",
		calca: "jeans",
		corCalca: "noite",
		sapato: "sneakers",
		corSapato: "papel",
	},
	cartografo: {
		chapeu: "palha",
		corChapeu: "papel",
		cima: "long_sleeved_shirt",
		corCima: "papel",
		jaqueta: "vest",
		corJaqueta: "cinza",
		calca: "jeans",
		corCalca: "azul",
		sapato: "boots",
		corSapato: "noite",
	},
	alquimista: {
		oculos: "protecao",
		corOculos: "cinza",
		cima: "turtleneck",
		corCima: "verde",
		jaqueta: "jaleco",
		corJaqueta: "papel",
		calca: "jeans",
		corCalca: "noite",
		sapato: "sneakers",
		corSapato: "papel",
	},
	estrategista: {
		oculos: "shades",
		corOculos: "Black",
		cima: "turtleneck",
		corCima: "papel",
		jaqueta: "blazer",
		corJaqueta: "azul",
		calca: "jeans",
		corCalca: "noite",
		sapato: "boots",
		corSapato: "noite",
	},
	professor: {
		chapeu: "cachecol",
		corChapeu: "verde",
		cima: "long_sleeved_shirt",
		corCima: "papel",
		jaqueta: "vest",
		corJaqueta: "azul",
		calca: "jeans",
		corCalca: "cinza",
		sapato: "boots",
		corSapato: "noite",
	},
};

/** A role's word to its table key: "Revisora" → "revisora", "cartógrafo" → "cartografo". */
const chave = (papel: string): string =>
	papel
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim();

/** The clothes for `papel`: a role not in the table wears agente's. */
export const roupaDe = (papel: string | null): Look => (papel && PAPEIS[chave(papel)]) || PAPEIS.agente;

/** The person of `look` in the clothes of `papel`: every piece of the role, nothing the person wore before. */
export function vestir(look: Look, papel: string | null): Look {
	const pessoa: Look = {};
	for (const k of PESSOA) if (look[k] != null) pessoa[k] = look[k];
	return { ...pessoa, ...roupaDe(papel) };
}

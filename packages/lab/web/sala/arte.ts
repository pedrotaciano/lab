// The characters: Pixel Agents' (github.com/pixel-agents-hq/pixel-agents, MIT,
// arte/pixel-agents/LICENSE; based on JIK-A-4's MetroCity pack) and the Orbi outfits drawn on
// them (arte/orbi-trajes/, CREDITOS.md). Layered 128 × 96 sheets (3 directions × 8 frames of
// 16 × 32: walk 1–3, type 1–2, read 1–2, seated), each piece recoloured by its wardrobe palette
// (tint) and stacked. Ported from the POC (laboratorio/web/sala/arte.js), furniture and
// aquarium left out.
import { CASA, type Look, type Tom } from "./roupa";
import { hash } from "./tela";

interface Peca {
	id: string;
	label?: string;
	src?: string;
	tema?: boolean;
	ocultaAcima?: number[];
	swaps?: Record<string, Record<string, string>>;
}
interface Paleta {
	squares: { label: string; hex?: string; tema?: boolean }[];
	values: Record<string, Tom[]>;
}
interface Guarda {
	parts: Record<string, Peca[]>;
	palettes: Record<string, Paleta>;
}
interface Trajes {
	pecas: {
		cat: string;
		id: string;
		nome: string;
		src: string;
		tema?: boolean;
		ocultaAcima?: number[];
		cores?: string;
	}[];
	peles?: { label: string; hex: string; valor: Tom }[];
	conjuntos: { id: string; nome: string; look: Look }[];
}

/** A sheet with the colours a raised hand would be drawn in. */
export type Folha = HTMLCanvasElement & { cores?: { manga: string; pele: string } };

export const A = {
	wardrobe: null as Guarda | null,
	trajes: [] as Trajes["conjuntos"],
	pieces: new Map<string, ImageData>(),
	ready: false,
};

// An image, tried up to three times (a busy connection drops a few of the ~100 requests).
function load(src: string, tries = 3): Promise<HTMLImageElement> {
	const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
	const img = new Image();
	img.onload = () => resolve(img);
	img.onerror = () => {
		if (tries > 1) setTimeout(() => load(src, tries - 1).then(resolve, reject), 300);
		else reject(new Error(src));
	};
	img.src = src;
	return promise;
}
function pixelsOf(img: HTMLImageElement): ImageData {
	const c = document.createElement("canvas");
	c.width = img.width;
	c.height = img.height;
	const g = c.getContext("2d", { willReadFrequently: true })!;
	g.drawImage(img, 0, 0);
	return g.getImageData(0, 0, img.width, img.height);
}

// Colour, as Pixel Agents does it (characters/color.ts, office/colorize.ts).
const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	const rf = r / 255;
	const gf = g / 255;
	const bf = b / 255;
	const max = Math.max(rf, gf, bf);
	const min = Math.min(rf, gf, bf);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h =
		max === rf
			? ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60
			: max === gf
				? ((bf - rf) / d + 2) * 60
				: ((rf - gf) / d + 4) * 60;
	return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const f = (t: number) => {
		t = (t + 1) % 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
const rgbOf = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** Recolour an RGBA buffer: the named exact swap first, then the HSL shifts (or colorize). */
function tint(src: Uint8ClampedArray, cv: Tom, swaps?: Peca["swaps"]): Uint8ClampedArray<ArrayBuffer> {
	const swap = cv.palette ? swaps?.[cv.palette] : undefined;
	const shifts = cv.colorize || cv.h || cv.s || cv.b || cv.c;
	const out = new Uint8ClampedArray(src.length);
	const factor = (100 + (cv.c || 0)) / 100;
	for (let i = 0; i < src.length; i += 4) {
		if (src[i + 3] < 2) continue;
		let rgb: [number, number, number] = [src[i], src[i + 1], src[i + 2]];
		const to = swap?.[hex(...rgb)];
		if (to) rgb = rgbOf(to);
		if (shifts) {
			let h: number;
			let s: number;
			let l: number;
			if (cv.colorize) {
				h = cv.h / 360;
				s = cv.s / 100;
				l = lum(...rgb);
			} else {
				const [oh, os, ol] = rgbToHsl(...rgb);
				h = ((((oh + (cv.h || 0)) % 360) + 360) % 360) / 360;
				s = Math.max(0, Math.min(1, os + (cv.s || 0) / 100));
				l = ol;
			}
			if (cv.c) l = 0.5 + (l - 0.5) * factor;
			l = Math.max(0, Math.min(1, l + (cv.b || 0) / 200));
			rgb = hslToRgb(h, s, l);
		}
		out[i] = rgb[0];
		out[i + 1] = rgb[1];
		out[i + 2] = rgb[2];
		out[i + 3] = src[i + 3];
	}
	return out;
}

const CATS = ["body", "hair", "beard", "top", "jacket", "pants", "shoes", "shades", "hat"];
// Stacking order (Pixel Agents' LAYERS), with the look's fields.
const LAYERS: [string, keyof Look | null, keyof Look | null][] = [
	["body", "corpo", "pele"],
	["eyes", null, null],
	["pants", "calca", "corCalca"],
	["top", "cima", "corCima"],
	["jacket", "jaqueta", "corJaqueta"],
	["shoes", "sapato", "corSapato"],
	["hair", "cabelo", "corCabelo"],
	["beard", "barba", "corBarba"],
	["shades", "oculos", "corOculos"],
	["hat", "chapeu", "corChapeu"],
];
const DEFAULT_COLOUR: Record<string, string> = {
	body: "Light",
	hair: "Side-swept",
	beard: "Side-swept",
	shades: "Black",
};
const NEUTRO: Tom = { h: 0, s: 0, b: 0, c: 0 };

function colourOf(w: Guarda, cat: string, id: string, label: string | null | undefined): Tom {
	if (label && CASA[label]) return CASA[label];
	const pal = w.palettes[cat];
	const values = pal?.values?.[id];
	if (!values) return NEUTRO;
	let k = pal.squares.findIndex(s => s.label === label);
	if (k < 0) k = pal.squares.findIndex(s => s.label === (DEFAULT_COLOUR[cat] || "White"));
	return values[Math.max(0, k)] || NEUTRO;
}

// The Orbi wardrobe joined to Pixel Agents': its pieces in their categories, from their own src;
// the ones in the wardrobe's greys take the colours of the piece named in `cores`; its skins as
// more squares of the body's palette, themed; the outfits go to A.trajes.
function juntar(wardrobe: Guarda, extra: Trajes, base: string): void {
	for (const p of extra.pecas) {
		wardrobe.parts[p.cat].push({
			id: p.id,
			label: p.nome,
			src: base + p.src.replace(/^arte\//, ""),
			ocultaAcima: p.ocultaAcima,
			...(p.tema ? { tema: true } : {}),
		});
		const values = wardrobe.palettes[p.cat]?.values;
		if (p.cores && values?.[p.cores]) values[p.id] = values[p.cores];
	}
	const corpo = wardrobe.palettes.body;
	for (const pele of extra.peles ?? []) {
		corpo.squares.push({ label: pele.label, hex: pele.hex, tema: true });
		for (const valores of Object.values(corpo.values)) valores.push(pele.valor);
	}
	A.wardrobe = wardrobe;
	A.trajes = extra.conjuntos;
}

let carregando: Promise<void> | null = null;
/**
 * Every piece, from `base` (the page's /arte/). Once per page, whatever rooms ask. A piece that
 * won't load (after its retries) leaves only itself out; without the wardrobe it fails, and the
 * next call tries again.
 */
export function loadArt(base: string): Promise<void> {
	carregando ??= (async () => {
		const pa = `${base}pixel-agents/personagens/`;
		const [wardrobe, extra] = await Promise.all([
			fetch(`${pa}wardrobe.json`).then(r => r.json() as Promise<Guarda>),
			fetch(`${base}orbi-trajes/trajes.json`)
				.then(r => r.json() as Promise<Trajes>)
				.catch((): Trajes => ({ pecas: [], conjuntos: [] })),
		]);
		juntar(wardrobe, extra, base);
		const lista: [string, string][] = [];
		for (const cat of CATS)
			for (const part of wardrobe.parts[cat])
				lista.push([`${cat}/${part.id}`, part.src || `${pa}${cat}/${part.id}.png`]);
		for (const piece of ["whites", "iris.bottom"]) lista.push([`eyes/${piece}`, `${pa}eyes/${piece}.png`]);
		await Promise.allSettled(
			lista.map(([chave, arquivo]) => load(arquivo).then(img => A.pieces.set(chave, pixelsOf(img)))),
		);
		A.ready = true;
	})().catch((e: unknown) => {
		carregando = null;
		throw e;
	});
	return carregando;
}

function pixel(data: { data: Uint8ClampedArray; width: number }, x: number, y: number): string | null {
	const i = (y * data.width + x) * 4;
	return data.data[i + 3] > 128 ? hex(data.data[i], data.data[i + 1], data.data[i + 2]) : null;
}

// A look's sheet: 128 × 96, the pieces tinted and stacked. Cached only once the art is in.
const sheets = new Map<string, Folha>();
export function sheetOf(look: Look): Folha {
	const key = JSON.stringify(look);
	const pronta = sheets.get(key);
	if (pronta) return pronta;
	const out = new ImageData(128, 96);
	const over = (data: Uint8ClampedArray) => {
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] < 2) continue;
			out.data[i] = data[i];
			out.data[i + 1] = data[i + 1];
			out.data[i + 2] = data[i + 2];
			out.data[i + 3] = data[i + 3];
		}
	};
	let pele: string | null = null;
	const w = A.wardrobe;
	if (w) {
		for (const [cat, field, colourField] of LAYERS) {
			if (cat === "eyes") {
				const whites = A.pieces.get("eyes/whites");
				const irisArt = A.pieces.get("eyes/iris.bottom");
				if (whites) over(whites.data);
				if (!irisArt) continue;
				const iris = irisArt.data.slice();
				const [r, g, b] = rgbOf("#3b2a20");
				for (let i = 0; i < iris.length; i += 4) {
					if (iris[i + 3] < 2) continue;
					iris[i] = r;
					iris[i + 1] = g;
					iris[i + 2] = b;
				}
				over(iris);
				continue;
			}
			const id = field ? look[field] : null;
			const art = id ? A.pieces.get(`${cat}/${id}`) : undefined;
			if (!id || !art) continue;
			const part = w.parts[cat].find(p => p.id === id);
			// A fitted hat hides the layers above its brim, frame by frame.
			if (part?.ocultaAcima) {
				for (let q = 0; q < 24; q++) {
					for (let y = 0; y < part.ocultaAcima[q]; y++) {
						const i = ((Math.floor(q / 8) * 32 + y) * 128 + (q % 8) * 16) * 4;
						out.data.fill(0, i, i + 16 * 4);
					}
				}
			}
			over(tint(art.data, colourOf(w, cat, id, colourField ? look[colourField] : null), part?.swaps));
			if (cat === "body") pele = pixel(out, 16 + 8, 15);
		}
	}
	const sheet: Folha = document.createElement("canvas");
	sheet.width = 128;
	sheet.height = 96;
	sheet.getContext("2d")!.putImageData(out, 0, 0);
	sheet.cores = { manga: pixel(out, 16 + 8, 21) || "#33322f", pele: pele || "#e0a77e" };
	if (A.ready) sheets.set(key, sheet);
	return sheet;
}

/** Before the art: the site's figure. */
const VOCE: Look = {
	corpo: "flat",
	pele: "Light",
	cabelo: "short",
	corCabelo: "Side-swept",
	cima: "tshirt",
	corCima: "Orange",
	calca: "jeans",
	corCalca: "Navy",
	sapato: "sneakers",
	corSapato: "White",
};

/**
 * The draw of `id`: each piece and colour from the id's hash, among what the wardrobe has. Hair in
 * the natural colours mostly; a beard, glasses, a jacket or a cap now and then; one in ten in a
 * whole themed outfit.
 */
export function sortear(id: string): Look {
	const w = A.wardrobe;
	if (!w) return { ...VOCE };
	let h = hash(id);
	// The next pseudo-random number in 0..n-1, from the hash (xorshift).
	const next = (n: number) => {
		h ^= h << 13;
		h ^= h >>> 17;
		h ^= h << 5;
		h >>>= 0;
		return h % n;
	};
	const one = <V>(list: V[]): V => list[next(list.length)];
	const ids = (cat: string) => w.parts[cat].filter(p => !p.tema).map(p => p.id);
	const cores = (cat: string) => w.palettes[cat].squares.filter(s => !s.tema).map(s => s.label);
	const cabelos = cores("hair");
	const NATURAIS = [
		"Long waves",
		"Shoulder-length",
		"Side-swept",
		"Long",
		"Spiky",
		"Short",
		"Mop",
		"Bowl cut",
		"Black",
		"White",
	].filter(c => cabelos.includes(c));
	const look: Look = {
		corpo: one(ids("body")),
		pele: one(cores("body")),
		cabelo: one(ids("hair")),
		corCabelo: next(5) ? one(NATURAIS) : one(cabelos),
		cima: one(ids("top")),
		corCima: one(cores("top")),
		calca: one(ids("pants")),
		corCalca: one(cores("pants")),
		sapato: one(ids("shoes")),
		corSapato: one(cores("shoes")),
	};
	if (next(10) < 3) {
		look.barba = one(ids("beard"));
		look.corBarba = look.corCabelo;
	}
	if (next(10) < 3) {
		look.oculos = one(ids("shades"));
		look.corOculos = one(cores("shades"));
	}
	if (next(10) < 3) {
		look.jaqueta = one(ids("jacket"));
		look.corJaqueta = one(cores("jacket"));
	}
	if (next(10) < 1) {
		look.chapeu = one(ids("hat"));
		look.corChapeu = one(cores("hat"));
	}
	if (A.trajes.length && next(10) < 1) return { ...look, ...one(A.trajes).look };
	return look;
}

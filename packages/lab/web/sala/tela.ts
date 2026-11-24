// The screen every drawing module paints on: the canvas's context, where the room's origin is on
// it (org, CSS px), the pitch P (CSS px per art pixel), the clock (tick), and dot(), one art pixel.
// The scene (cena.ts) sets these before each frame; the other modules only read them.
// Ported from the POC (laboratorio/web/sala/tela.js).

export interface Tela {
	ctx: CanvasRenderingContext2D;
	org: [number, number];
	P: number;
	tick: number;
	/** The clock a table's things run on: the tick at a working table, frozen (0) at an idle one. */
	tk: number;
}

export const T: Tela = {
	ctx: null as unknown as CanvasRenderingContext2D,
	org: [0, 0],
	P: 3,
	tick: 0,
	tk: 0,
};

const reducedQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
export const reduced = (): boolean => reducedQuery?.matches ?? false;
export const aoMudarMovimento = (fn: () => void): (() => void) => {
	reducedQuery?.addEventListener("change", fn);
	return () => reducedQuery?.removeEventListener("change", fn);
};

export function dot(c: number, r: number, colour: string): void {
	T.ctx.fillStyle = colour;
	T.ctx.fillRect(T.org[0] + c * T.P, T.org[1] + r * T.P, T.P, T.P);
}

/** A stable 32-bit hash of a string (FNV-1a), for everything deterministic per chat. */
export function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * The house's colours (fractal.tokens.css / sala.css): one orange with its darker edge and its
 * light; the room's whites and greys; graphite for ink.
 */
export const C = {
	W: "#fdfdfc",
	w: "#f1f0ee",
	g: "#e3e1dd",
	G: "#c5c3bf",
	k: "#33322f",
	O: "#ff5100",
	o: "#c23d00",
	L: "#ff9d6b",
} as const;
export const NOITE = "#29251e";
/** The labels' status dots, on their dark plate (sala.css --status-* at night). */
export const PONTO = {
	parado: "#a1a09b", // --status-feito, dark plate
	livre: "#85ba9c", // --status-entregue, dark plate
	trabalhando: "#10c4e4",
	esperando: C.O,
	erro: "#f1f2ee",
} as const;
export const MONO = `"Geist Mono", ui-monospace, monospace`;

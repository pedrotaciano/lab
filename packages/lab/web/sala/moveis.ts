// What stands on the floor: the figures, the round table and its stool, and the pixel bubbles.
// All drawn on T (tela.ts). Ported from the POC (laboratorio/web/sala/moveis.js).
import { sheetOf } from "./arte";
import type { Look } from "./roupa";
import { C, dot, reduced, T } from "./tela";

/** A seated figure sits this much lower (Pixel Agents' CHARACTER_SITTING_OFFSET_PX). */
export const SIT = 6;
/** The figures at the round tables are drawn at this part of their size, on the same feet. */
export const MINI = 0.625;

export type Vista = "down" | "up" | "left" | "right";
export type Pose = "type" | "read" | "seated" | "stand";

export interface Boneco {
	x: number;
	y: number;
	view: Vista;
	pose: Pose;
	frame: number;
	/** Drawn faded (a chat with no process). */
	apagado?: boolean;
}

const ROW: Record<Vista, number> = { down: 0, up: 1, right: 2, left: 2 };
const FRAME: Record<Pose, (f: number) => number> = {
	type: (f) => 3 + (f % 2),
	read: (f) => 5 + (f % 2),
	seated: () => 7,
	stand: () => 1,
};

/** A mini figure seated with its feet at (x, y) of the room. */
export function figure(who: Boneco, look: Look): void {
	const sheet = sheetOf(look);
	const f = FRAME[who.pose](who.frame);
	const { ctx, org, P, dpr } = T;
	// In device pixels, whole: the sprite's size and its feet's place (any pitch).
	const w = Math.round(16 * P * MINI * dpr) / dpr;
	const h = Math.round(32 * P * MINI * dpr) / dpr;
	const x = Math.round((org[0] + Math.round(who.x) * P) * dpr - (w * dpr) / 2) / dpr;
	const y = Math.round((org[1] + (Math.round(who.y) + SIT) * P) * dpr) / dpr - h;
	ctx.save();
	if (who.apagado) ctx.globalAlpha = 0.55;
	if (who.view === "left") {
		ctx.translate(x + w, y);
		ctx.scale(-1, 1);
		ctx.drawImage(sheet, f * 16, ROW.left * 32, 16, 32, 0, 0, w, h);
	} else ctx.drawImage(sheet, f * 16, ROW[who.view] * 32, 16, 32, x, y, w, h);
	ctx.restore();
}
/** How tall a mini figure stands, in art px. */
export const ALTO = 32 * MINI;

// A round table (planta.ts lugaresDaOrbi) at (s.x, s.y): a white top seen from above with its
// grey edge under it, one post, a round foot. Taken: a little laptop in the middle, its light
// blinking while someone at it works. Empty: an orange stool behind it (banquinho).
export const MESA_REDONDA = { rx: 12, ry: 4, dy: 4 };
function elipse(cx: number, cy: number, rx: number, ry: number, cor: string, bordaDe: (c: number, r: number) => string): void {
	const dentro = (c: number, r: number) => (c / (rx + 0.5)) ** 2 + (r / (ry + 0.5)) ** 2 <= 1;
	for (let r = -ry; r <= ry; r++) {
		for (let c = -rx; c <= rx; c++) {
			if (!dentro(c, r)) continue;
			const beira = !dentro(c - 1, r) || !dentro(c + 1, r) || !dentro(c, r - 1) || !dentro(c, r + 1);
			dot(cx + c, cy + r, beira ? bordaDe(c, r) : cor);
		}
	}
}
export function mesaRedonda(s: { x: number; y: number }, ocupada: boolean, trabalhando: boolean): void {
	const { rx, ry, dy } = MESA_REDONDA;
	const cy = s.y + dy;
	for (let r = cy + 4; r <= cy + 9; r++) {
		dot(s.x - 1, r, C.G);
		dot(s.x, r, "#8b8984");
	}
	elipse(s.x, cy + 10, 5, 1, C.G, () => C.k);
	elipse(s.x, cy + 2, rx, ry, C.g, () => C.k);
	// The top's rim: dark against the floor, a soft grey where the edge shows under it.
	elipse(s.x, cy, rx, ry, C.W, (c, r) => (r > 0 && (c / (rx + 0.5)) ** 2 + ((r - 1) / (ry + 0.5)) ** 2 <= 1 ? C.G : C.k));
	if (!ocupada) return;
	const lx = s.x - 3;
	const ly = cy - 3;
	for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) dot(lx + c, ly + r, r === 3 ? "#1d1c1a" : "#4a4946");
	if (trabalhando) dot(lx + 3, ly + 1, (T.tk >> 3) % 2 || reduced() ? C.O : C.L);
}
/** The stool at an empty round table: an orange seat on a short post. */
export function banquinho(x: number, y: number): void {
	dot(x, y - 1, C.G);
	dot(x, y, C.G);
	elipse(x, y - 3, 4, 1, C.O, () => C.o);
}

// A 9 × 7 pixel bubble with an icon: what someone is doing, at a glance, at any pitch.
const ICONS = {
	dots: [[2, 3], [4, 3], [6, 3]],
	x: [[2, 1], [6, 1], [3, 2], [5, 2], [4, 3], [3, 4], [5, 4], [2, 5], [6, 5]],
	edit: [[6, 1], [7, 2], [5, 2], [6, 3], [4, 3], [5, 4], [3, 4], [2, 5]],
	run: [[2, 1], [3, 2], [4, 3], [3, 4], [2, 5], [5, 5], [6, 5], [7, 5]],
	read: [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [2, 5], [3, 5], [4, 5]],
	search: [[3, 1], [4, 1], [2, 2], [5, 2], [2, 3], [5, 3], [3, 4], [4, 4], [5, 4], [6, 5]],
} satisfies Record<string, [number, number][]>;
export type Icone = keyof typeof ICONS;
export const LARGURA_BALAO = 9;
export const ALTURA_BALAO = 9;
export function bubble(kind: Icone, x: number, y: number, edge: string = C.G, tinta: string = C.k): void {
	for (let r = 0; r < 7; r++) {
		for (let c = 0; c < 9; c++) {
			if ((r === 0 || r === 6) && (c === 0 || c === 8)) continue;
			dot(x + c, y + r, r === 0 || r === 6 || c === 0 || c === 8 ? edge : C.W);
		}
	}
	dot(x + 3, y + 7, edge);
	dot(x + 4, y + 7, C.W);
	dot(x + 5, y + 7, edge);
	dot(x + 4, y + 8, edge);
	for (const [c, r] of ICONS[kind]) dot(x + c, y + r, tinta);
}

/** Over one who waits for you: an orange sign, a white "!" in it, bobbing; 5 × 9, its foot at (x, y). */
export function marca(x: number, y: number): void {
	const bob = reduced() ? 0 : (T.tick >> 3) % 2;
	const top = y - 9 - bob;
	for (let r = 0; r < 9; r++) {
		for (let c = 0; c < 5; c++) if (!((r === 0 || r === 8) && (c === 0 || c === 4))) dot(x - 2 + c, top + r, r === 8 ? C.o : C.O);
	}
	for (const r of [1, 2, 3, 4, 6]) dot(x, top + r, C.W);
}

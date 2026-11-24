// The room: a round white office seen from above (the POC's, laboratorio/web/sala/planta.js),
// 380 × 276 art px. A glass floor, the back wall a cylinder with an orange line and books either
// side, the door at the bottom, an orange rug in the middle with the symbol's six dots. Each team
// at a small round table: three round the rug up to POUCOS_TIMES, sixteen on two rings up to
// MESAS_REDONDAS, then a grid of tables over the floor.
import { C } from "./tela";

const S = 1.34; // the POC's room scale (its site's room had 6 desks; this one, 12)
export const FLOOR = { cx: 190, cy: 154, rx: 182, ry: 110 };
export const RW = 380;
export const RH = 276;
const WALL = 34; // the back wall's face, above the floor's edge
const DOOR = [FLOOR.cx - 16, FLOOR.cx + 16];
export const CENTER = [FLOOR.cx, FLOOR.cy + 6];
const GLASS = "#dcebee";
const PAREDE = "#f7f6f3";
const ESTANTES: [number, number][] = [
	[FLOOR.cx - Math.round(130 * S), FLOOR.cx - Math.round(48 * S)],
	[FLOOR.cx + Math.round(48 * S), FLOOR.cx + Math.round(130 * S)],
];
const LOMBADAS = [C.O, "#4e70c6", "#2fa596", C.k, "#fdd900", C.o, "#8fe0d4", "#3e9a5f", "#9db5ea"];

export interface Lugar {
	x: number;
	y: number;
}

export const MESAS_REDONDAS = 16;
export const POUCOS_TIMES = 3;
const DENTRO = { rx: 110, ry: 38, vao: 30 }; // vao: degrees from the top and the bottom kept clear
const FORA = { rx: 151, ry: 78, vao: 18 };
const NA_RODA_DE_DENTRO = 6;
function mesaEm(graus: number, { rx, ry }: { rx: number; ry: number }): Lugar {
	const a = (graus * Math.PI) / 180;
	return { x: Math.round(FLOOR.cx + rx * Math.cos(a)), y: Math.round(FLOOR.cy + ry * Math.sin(a)) };
}
// `n` tables on a ring's two sides (the extra one on the right), from its top left clockwise.
function anelDeMesas(n: number, anel: typeof DENTRO): Lugar[] {
	const lado = (m: number, de: number) =>
		Array.from({ length: m }, (_, j) => de + anel.vao + (m === 1 ? 90 - anel.vao : ((180 - 2 * anel.vao) * j) / (m - 1)));
	const graus = [...lado(Math.ceil(n / 2), 270), ...lado(Math.floor(n / 2), 90)].map((g) => (g <= 180 ? g + 360 : g)).sort((a, b) => a - b);
	return graus.map((g) => mesaEm(g, anel));
}
/**
 * Over MESAS_REDONDAS, a grid on the floor: rows of tables inside it, each row centred, as wide
 * apart as `n` allow (a table's ring, its name under it and the next row's heads between rows).
 */
function grade(n: number): Lugar[] {
	for (let k = 0; ; k++) {
		const dx = Math.max(20, 64 - 4 * k);
		const dy = Math.max(30, 50 - k);
		const lugares: Lugar[] = [];
		for (let y = 66; y <= FLOOR.cy + FLOOR.ry - 40; y += dy) {
			const meia = FLOOR.rx * Math.sqrt(Math.max(0, 1 - ((y - FLOOR.cy) / FLOOR.ry) ** 2)) - 28;
			const m = Math.floor((2 * meia) / dx) + 1;
			for (let j = 0; j < m; j++) lugares.push({ x: Math.round(FLOOR.cx + (j - (m - 1) / 2) * dx), y });
		}
		if (lugares.length >= n || (dx === 20 && dy === 30)) return lugares;
	}
}
/** The tables for `times` teams: the three-table ring up to POUCOS_TIMES, the sixteen on two rings up to MESAS_REDONDAS, else a grid. */
export function lugaresDaOrbi(times: number): Lugar[] {
	if (times <= POUCOS_TIMES) return [270, 390, 510].map((g) => mesaEm(g, { rx: 90, ry: 44 })).concat(anelDeMesas(10, FORA));
	if (times > MESAS_REDONDAS) return grade(times);
	return [...anelDeMesas(NA_RODA_DE_DENTRO, DENTRO), ...anelDeMesas(MESAS_REDONDAS - NA_RODA_DE_DENTRO, FORA)];
}
/**
 * Team `i` of `n`'s table: up to POUCOS_TIMES the three round the rug (one team at the top, two at
 * the lower pair); up to MESAS_REDONDAS the inner ring first, spread, then the outer one, spread;
 * over it, one table each, in order.
 */
export function mesaDe(i: number, n: number): number {
	if (n <= POUCOS_TIMES) return n === 2 ? i + 1 : i;
	if (n > MESAS_REDONDAS) return i;
	const espalhar = (j: number, m: number, de: number) => Math.round((j * de) / m) % de;
	if (i < NA_RODA_DE_DENTRO) return espalhar(i, Math.min(n, NA_RODA_DE_DENTRO), NA_RODA_DE_DENTRO);
	return NA_RODA_DE_DENTRO + espalhar(i - NA_RODA_DE_DENTRO, n - NA_RODA_DE_DENTRO, MESAS_REDONDAS - NA_RODA_DE_DENTRO);
}

// A colour moved by a fixed step per channel: the floor's seams and light, the wall's shades.
function tom(hex: string, dr: number, dg: number, db: number): string {
	const n = parseInt(hex.slice(1), 16);
	const c = (v: number, d: number) =>
		Math.max(0, Math.min(255, v + d))
			.toString(16)
			.padStart(2, "0");
	return `#${c(n >> 16, dr)}${c((n >> 8) & 255, dg)}${c(n & 255, db)}`;
}
const meiaAltura = (x: number) => FLOOR.ry * Math.sqrt(Math.max(0, 1 - ((x - FLOOR.cx) / FLOOR.rx) ** 2));
const inFloor = (x: number, y: number, shrink = 0) =>
	((x - FLOOR.cx) / (FLOOR.rx - shrink)) ** 2 + ((y - FLOOR.cy) / (FLOOR.ry - shrink * 0.6)) ** 2 <= 1;

// ── The static room, painted once per pitch ───────────────────────────────────────────────
function paintGrid(target: HTMLCanvasElement, grid: string[], s: number): void {
	const g = target.getContext("2d")!;
	g.clearRect(0, 0, target.width, target.height);
	for (let r = 0; r < RH; r++) {
		let start = 0;
		for (let c = 1; c <= RW; c++) {
			if (c < RW && grid[r * RW + c] === grid[r * RW + start]) continue;
			const colour = grid[r * RW + start];
			if (colour) {
				g.fillStyle = colour;
				g.fillRect(start * s, r * s, (c - start) * s, s);
			}
			start = c;
		}
	}
}

/** The glass floor: rings and spokes of seams, light dancing on it (the same every time). */
export function drawFloor(target: HTMLCanvasElement, s: number): void {
	const seam = tom(GLASS, -13, -9, -8);
	const caustic = tom(GLASS, 18, 12, 10);
	const grid: string[] = Array.from({ length: RW * RH }, () => "");
	for (let r = 0; r < RH; r++) {
		for (let c = 0; c < RW; c++) {
			if (!inFloor(c + 0.5, r + 0.5)) continue;
			const dx = (c - FLOOR.cx) / FLOOR.rx;
			const dy = (r - FLOOR.cy) / FLOOR.ry;
			const d = Math.hypot(dx, dy);
			const angle = Math.atan2(dy, dx) / (Math.PI / 6);
			const ring = [0.36, 0.7].some((k) => Math.abs(d - k) < 0.008);
			const spoke = d > 0.36 && Math.abs(angle - Math.round(angle)) * d * 40 < 0.5;
			grid[r * RW + c] = ring || spoke ? seam : GLASS;
		}
	}
	let seed = 11;
	const rand = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	for (let n = 0; n < Math.round(420 * S * S); n++) {
		const c = Math.floor(rand() * RW);
		const r = Math.floor(rand() * RH);
		const len = 2 + Math.floor(rand() * 4);
		for (let k = 0; k < len; k++) {
			const x = c + k;
			const y = r + (k === len - 1 ? 1 : 0);
			if (x < RW && y < RH && grid[y * RW + x]) grid[y * RW + x] = caustic;
		}
	}
	paintGrid(target, grid, s);
}

// The book wall: a plank every 8 rows, a post every 20 columns, books on the planks.
interface Livro {
	h: number;
	colour: string;
	cap: boolean;
}
const prateleiras = new Map<string, (Livro | null)[]>();
function booksOf(a: number, b: number, shelf: number): (Livro | null)[] {
	const key = `${a}:${b}:${shelf}`;
	const pronta = prateleiras.get(key);
	if (pronta) return pronta;
	const row: (Livro | null)[] = Array.from({ length: b - a }, () => null);
	let n = a * 3 + shelf * 7;
	for (let i = 1; i < b - a; ) {
		n = (n * 37 + 11) % 101;
		if (n % 9 === 0) {
			i += 2; // a gap
			continue;
		}
		const w = 1 + (n % 2) + (n % 5 === 0 ? 1 : 0);
		const book = { h: 4 + (n % 3), colour: LOMBADAS[n % LOMBADAS.length], cap: w > 1 };
		for (let k = 0; k < w && i + k < row.length; k++) row[i + k] = book;
		i += w;
	}
	prateleiras.set(key, row);
	return row;
}
function bookWall(c: number, fromBase: number, [a, b]: [number, number]): string {
	const i = c - a;
	if (i % 20 === 0 || c === b - 1 || fromBase >= WALL - 1) return C.G;
	const up = fromBase - 3;
	const on = up % 8;
	if (on === 0) return C.G;
	const book = booksOf(a, b, Math.floor(up / 8))[i];
	if (!book || on > book.h) return "#ece6dc";
	return on === book.h && book.cap ? C.W : book.colour;
}

/** The wall round the floor, the door, and the rug in the middle. */
export function drawRoom(target: HTMLCanvasElement, s: number): void {
	const faces = [PAREDE, tom(PAREDE, -6, -7, -8), tom(PAREDE, -15, -16, -18)];
	const grid: string[] = Array.from({ length: RW * RH }, () => "");
	const put = (c: number, r: number, colour: string) => {
		if (c >= 0 && c < RW && r >= 0 && r < RH && colour) grid[r * RW + c] = colour;
	};
	for (let c = FLOOR.cx - FLOOR.rx - 4; c <= FLOOR.cx + FLOOR.rx + 4; c++) {
		const t = Math.min(1, Math.abs(c - FLOOR.cx) / (FLOOR.rx + 4));
		const m = meiaAltura(Math.max(FLOOR.cx - FLOOR.rx, Math.min(FLOOR.cx + FLOOR.rx, c)));
		const top = Math.round(FLOOR.cy - m);
		const bottom = Math.round(FLOOR.cy + m);
		const face = faces[t < 0.55 ? 0 : t < 0.8 ? 1 : 2];
		const books = ESTANTES.find(([a, b]) => c >= a && c < b);
		for (let r = top - WALL; r < top; r++) {
			const fromBase = top - r;
			if (books && fromBase > 2) put(c, r, bookWall(c, fromBase, books));
			else
				put(
					c,
					r,
					fromBase === 1 ? C.G : fromBase === 2 ? C.g : fromBase === 7 || fromBase === 8 ? C.O : (c - FLOOR.cx) % 24 === 0 ? C.g : face,
				);
		}
		for (let r = top - WALL - 4; r < top - WALL; r++) put(c, r, r === top - WALL - 4 ? C.G : C.W);
		if (c >= DOOR[0] && c < DOOR[1]) {
			put(c, bottom + 1, C.O);
			continue;
		}
		for (let r = bottom + 1; r <= bottom + 5; r++) put(c, r, r === bottom + 5 ? C.G : r === bottom + 1 ? C.g : C.W);
	}
	// The sides, where the cylinder turns: fill the face down to the rim.
	for (let r = Math.round(FLOOR.cy - 10); r <= FLOOR.cy + 10; r++) {
		for (let c = 0; c < RW; c++) {
			if (grid[r * RW + c]) continue;
			if (!inFloor(c + 0.5, r + 0.5) && inFloor(c + 0.5, r + 0.5, -5)) put(c, r, C.W);
		}
	}
	// The rug: white, an orange ring, a dotted light one, the symbol's six dots on it.
	const rug = [Math.round(40 * S), Math.round(24 * S)];
	for (let r = -rug[1] - 2; r <= rug[1] + 2; r++) {
		for (let c = -rug[0]; c <= rug[0]; c++) {
			const d = Math.hypot(c / rug[0], r / rug[1]);
			if (d > 1) continue;
			put(
				CENTER[0] + c,
				CENTER[1] - 6 + r,
				d > 0.92 ? C.O : d > 0.87 ? C.W : d > 0.7 && d < 0.73 && (c + r) % 3 === 0 ? C.L : "#fbf4ee",
			);
		}
	}
	const bolinha = [[-1, -2], [0, -2], [1, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1]];
	for (let k = 0; k < 6; k++) {
		const a = ((-90 + 60 * k) * Math.PI) / 180;
		const x = Math.round(CENTER[0] + 28 * S * Math.cos(a));
		const y = Math.round(CENTER[1] - 6 + 17 * S * Math.sin(a));
		for (const [dc, dr] of bolinha) put(x + dc, y + dr, dc === -1 && dr === -1 ? C.L : C.O);
	}
	paintGrid(target, grid, s);
}

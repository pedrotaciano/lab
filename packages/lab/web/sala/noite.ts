// The room's light follows the clock (the POC's laboratorio/web/sala/noite.js): dawn (5–7h) pink
// and orange, the day as drawn, dusk (17–19h) golden, the night (19–5h) dark blue with pools of
// light round the working tables. Drawn over the room only, under the labels.
import { FLOOR, RH, RW } from "./planta";
import { C, T } from "./tela";

// [hour, colour over the room, how much of it, the lights (0–1)], eased in between.
const CEU: [number, [number, number, number], number, number][] = [
	[0, [12, 16, 48], 0.76, 1],
	[4.5, [12, 16, 48], 0.76, 1],
	[5.5, [96, 56, 110], 0.42, 0.7],
	[6.25, [236, 128, 104], 0.26, 0.25],
	[7, [255, 200, 150], 0, 0],
	[17, [255, 190, 90], 0, 0],
	[18, [232, 150, 40], 0.3, 0.3],
	[19, [90, 52, 104], 0.48, 0.75],
	[20, [12, 16, 48], 0.76, 1],
	[24, [12, 16, 48], 0.76, 1],
];

export interface Ceu {
	cor: number[];
	escuro: number;
	luzes: number;
}
/** The sky at an hour (14.5 = 14:30). */
export function ceu(h: number): Ceu {
	let k = 0;
	while (CEU[k + 1][0] <= h && k < CEU.length - 2) k++;
	const [h0, c0, a0, l0] = CEU[k];
	const [h1, c1, a1, l1] = CEU[k + 1];
	const t = (h - h0) / (h1 - h0);
	const mix = (a: number, b: number) => a + (b - a) * t;
	return { cor: c0.map((v, i) => Math.round(mix(v, c1[i]))), escuro: mix(a0, a1), luzes: mix(l0, l1) };
}
export function horaReal(): number {
	const now = new Date();
	return now.getHours() + now.getMinutes() / 60;
}

/** A light: [x, y, radius] in room px. */
export type Luz = [number, number, number];
const TELA = [120, 175, 255];

// The light map at the room's own size, drawn up blocky like the rest of the art: the sky's colour
// over everything, holes cut where the lights are with their colour in them, its alpha in bands.
let mapa: HTMLCanvasElement | null = null;
let mapaChave = "";
function mapaPara(c: Ceu, luzes: Luz[]): HTMLCanvasElement {
	const key = `${c.cor}|${c.escuro.toFixed(3)}|${c.luzes.toFixed(3)}|${luzes.map(l => l.join(",")).join(";")}`;
	if (mapa && key === mapaChave) return mapa;
	mapaChave = key;
	const cv = mapa ?? document.createElement("canvas");
	mapa = cv;
	cv.width = RW;
	cv.height = RH;
	const g = cv.getContext("2d", { willReadFrequently: true })!;
	const rgba = (rgb: number[], a: number) => `rgba(${rgb.join(",")},${a})`;
	g.clearRect(0, 0, RW, RH);
	g.fillStyle = rgba(c.cor, c.escuro);
	g.fillRect(0, 0, RW, RH);
	g.globalCompositeOperation = "source-atop";
	g.fillStyle = rgba([30, 130, 150], 0.18 * c.luzes);
	g.beginPath();
	g.ellipse(FLOOR.cx, FLOOR.cy, FLOOR.rx, FLOOR.ry, 0, 0, Math.PI * 2);
	g.fill();
	const pool = (x: number, y: number, r: number, rgb: number[], a: number) => {
		const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
		for (const [at, k] of [
			[0, 1],
			[0.35, 0.7],
			[0.65, 0.3],
			[1, 0],
		])
			grad.addColorStop(at, rgba(rgb, a * k));
		g.setTransform(1, 0, 0, 0.75, x, y);
		g.fillStyle = grad;
		g.fillRect(-r, -r, r * 2, r * 2);
		g.setTransform(1, 0, 0, 1, 0, 0);
	};
	g.globalCompositeOperation = "destination-out";
	for (const [x, y, r] of luzes) pool(x, y, r, [0, 0, 0], 0.8 * c.luzes);
	g.globalCompositeOperation = "source-over";
	for (const [x, y, r] of luzes) pool(x, y, r, TELA, 0.45 * c.luzes);
	const img = g.getImageData(0, 0, RW, RH);
	const d = img.data;
	for (let i = 3; i < d.length; i += 4) d[i] = Math.round((d[i] / 255) * 16) * (255 / 16);
	g.putImageData(img, 0, 0);
	return cv;
}

/** The light over the room at hour `h`, only over what's drawn (not the page round it). */
export function luz(h: number, luzes: Luz[]): void {
	const c = ceu(h);
	if (c.escuro <= 0) return;
	const { ctx, org, P } = T;
	ctx.save();
	// Between the glass and the rim a few pixels are left clear: fill them behind what's drawn.
	ctx.globalCompositeOperation = "destination-over";
	ctx.fillStyle = C.W;
	ctx.beginPath();
	ctx.ellipse(org[0] + FLOOR.cx * P, org[1] + FLOOR.cy * P, (FLOOR.rx + 2) * P, (FLOOR.ry + 2) * P, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalCompositeOperation = "source-atop";
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(mapaPara(c, luzes), org[0], org[1], RW * P, RH * P);
	ctx.restore();
}

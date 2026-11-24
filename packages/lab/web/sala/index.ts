// The pixel room, the lab's public face of it: `criarSala` draws the teams and their chats on a
// canvas; `desenharRosto` draws one chat's (or one person's) face, the same figure as in the room.
import type { Estado } from "../tipos";
import { loadArt, sheetOf, sortear } from "./arte";
import { type OpcoesSala, Sala } from "./cena";
import { vestir } from "./roupa";

export type { OpcoesSala } from "./cena";
export { iconeDe, NA_MESA } from "./cena";

export interface SalaNaTela {
	/** Draw this state (call on every `estado` frame). */
	mostrar(estado: Estado): void;
	/** Stop drawing and listening; the canvas stays as it was. */
	destruir(): void;
}

/**
 * The room on `canvas`, which keeps the size its CSS gives it (the room fits and centres in it, in
 * whole pixels). A click on a figure calls `aoClicar(chatId)`; on a table, `aoClicarMesa(timeId)`;
 * on the empty room's table, `aoAdicionarTime()`.
 */
export function criarSala(canvas: HTMLCanvasElement, opts: OpcoesSala): SalaNaTela {
	const sala = new Sala(canvas, opts);
	return { mostrar: (estado) => sala.mostrar(estado), destruir: () => sala.destruir() };
}

/**
 * The face of `semente` (a chat's id, or a person's login) dressed for `papel`: 16 × 20 art px on
 * `canvas` (its width and height are set to that; scale it with CSS, `image-rendering: pixelated`).
 */
export async function desenharRosto(canvas: HTMLCanvasElement, semente: string, papel: string | null = null, arte = "/arte/"): Promise<void> {
	await loadArt(arte);
	canvas.width = 16;
	canvas.height = 20;
	const g = canvas.getContext("2d")!;
	g.imageSmoothingEnabled = false;
	g.clearRect(0, 0, 16, 20);
	g.drawImage(sheetOf(vestir(sortear(semente), papel)), 16, 2, 16, 20, 0, 0, 16, 20);
}

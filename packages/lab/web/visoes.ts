// The views of the Sala tab: each draws the same Estado on a canvas (the pixel room today; a city
// with a building per team, a terminal, a video-game menu later). A new view is one more file
// and one more entry here.
import { criarSala, type OpcoesSala } from "./sala";
import type { Estado } from "./tipos";

export interface VisaoNaTela {
	/** Draw this state (called on every `estado` frame). */
	mostrar(estado: Estado): void;
	/** Stop drawing and listening. */
	destruir(): void;
}

export interface Visao {
	id: string;
	nome: string;
	criar(canvas: HTMLCanvasElement, opts: OpcoesSala): VisaoNaTela;
}

const SALA: Visao = { id: "sala", nome: "Sala", criar: criarSala };

export const VISOES: Visao[] = [SALA];

const CHAVE = "lab.visao";

/** The view kept in this browser (`localStorage` `lab.visao`), else the first. */
export function visaoGuardada(): Visao {
	let id: string | null = null;
	try {
		id = localStorage.getItem(CHAVE);
	} catch {
		id = null;
	}
	return VISOES.find(visao => visao.id === id) ?? VISOES[0] ?? SALA;
}

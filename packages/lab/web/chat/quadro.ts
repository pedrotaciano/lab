// The prompt box's whiteboard (the POC's web/sala/quadro.js, "Quadro", the button next to the
// clip): a big <dialog> with a canvas to sketch on, Excalidraw-style. Tools: select and move, pen,
// rectangle, ellipse, arrow, line, text, eraser (their letters or 1–8); five colours of the
// palette, three widths; ⌘Z / ⇧⌘Z, Delete for the selected one. Strokes come out a little
// hand-drawn (each shape twice, slightly off, from its own seed, so a redraw doesn't wobble).
// "Adicionar ao prompt" exports what was drawn, cropped with a margin, as a PNG on white, and hands
// it to the box as a file: it goes with the next message like a pasted image. Closing (✕, Esc)
// keeps the drawing for the next time; only adding or Limpar ends it.

const CORES: ReadonlyArray<readonly [string, string]> = [
	["Noite", "#29251e"],
	["Laranja", "#ff5100"],
	["Azul", "#4e70c6"],
	["Verde", "#027539"],
	["Cinza", "#7a8481"],
];
/** [name, line width, text size] */
const LARGURAS: ReadonlyArray<readonly [string, number, number]> = [
	["Fino", 2, 16],
	["Médio", 4, 24],
	["Grosso", 8, 36],
];
type Ferramenta = "mover" | "caneta" | "retangulo" | "elipse" | "seta" | "linha" | "texto" | "borracha";
const FERRAMENTAS: ReadonlyArray<readonly [Ferramenta, string, string, string]> = [
	[
		"mover",
		"Selecionar e mover",
		"v",
		"M1 0h1v8h-1zM2 1h1v6h-1zM3 2h1v4h-1zM4 3h1v3h-1zM5 4h1v1h-1zM4 6h1v2h-1zM5 7h1v2h-1z",
	],
	["caneta", "Caneta", "p", "M7 0h2v2h-2zM5 2h2v2h-2zM3 4h2v2h-2zM1 6h2v2h-2zM0 8h1v1h-1z"],
	["retangulo", "Retângulo", "r", "M0 1h9v1h-9zM0 7h9v1h-9zM0 2h1v5h-1zM8 2h1v5h-1z"],
	[
		"elipse",
		"Elipse",
		"o",
		"M3 0h3v1h-3zM1 1h2v1h-2zM6 1h2v1h-2zM0 2h1v5h-1zM8 2h1v5h-1zM1 7h2v1h-2zM6 7h2v1h-2zM3 8h3v1h-3z",
	],
	[
		"seta",
		"Seta",
		"a",
		"M0 8h1v1h-1zM1 7h1v1h-1zM2 6h1v1h-1zM3 5h1v1h-1zM4 4h1v1h-1zM5 3h1v1h-1zM6 2h1v1h-1zM4 0h5v1h-5zM8 1h1v4h-1zM7 1h1v1h-1z",
	],
	[
		"linha",
		"Linha",
		"l",
		"M0 8h1v1h-1zM1 7h1v1h-1zM2 6h1v1h-1zM3 5h1v1h-1zM4 4h1v1h-1zM5 3h1v1h-1zM6 2h1v1h-1zM7 1h1v1h-1zM8 0h1v1h-1z",
	],
	["texto", "Texto", "t", "M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM4 1h1v7h-1zM3 8h3v1h-3z"],
	["borracha", "Borracha", "e", "M4 0h5v4h-1v1h-1v1h-1v1h-1v1h-1v1h-4v-4h1v-1h1v-1h1v-1h1z"],
];
/** --chapa: the board and the exported PNG. */
const FUNDO = "#fdfdfc";
/** Around the drawing, in the PNG. */
const MARGEM = 32;
/** The PNG's longest side, in pixels. */
const MAX_LADO = 4096;
const FONTE = (tamanho: number): string => `500 ${tamanho}px "Orbi Sans", system-ui, sans-serif`;
const ALTURA_LINHA = 1.25;

type Ponto = [number, number];
interface Base {
	cor: string;
	largura: number;
	semente: number;
}
type Elemento =
	| (Base & { tipo: "caneta"; pontos: Ponto[] })
	| (Base & { tipo: "retangulo" | "elipse" | "seta" | "linha"; x1: number; y1: number; x2: number; y2: number })
	| (Base & { tipo: "texto"; x: number; y: number; w: number; h: number; texto: string; tamanho: number });
interface Caixa {
	x: number;
	y: number;
	w: number;
	h: number;
}

// ── Geometry and drawing (pure: no DOM besides the context they get) ───────────────────────

/** mulberry32: the same seed, the same wobble. */
function aleatorio(semente: number): () => number {
	let a = semente >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A straight stroke as a hand would make it: twice, each a curve bent a little off the line. */
function traco(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, rnd: () => number): void {
	const comp = Math.hypot(x2 - x1, y2 - y1);
	const desvio = Math.min(2.4, 0.4 + comp * 0.012);
	const j = (): number => (rnd() - 0.5) * 2 * desvio;
	for (let vez = 0; vez < 2; vez++) {
		const mx = x1 + (x2 - x1) * (0.4 + rnd() * 0.2);
		const my = y1 + (y2 - y1) * (0.4 + rnd() * 0.2);
		ctx.beginPath();
		ctx.moveTo(x1 + j() * 0.5, y1 + j() * 0.5);
		ctx.quadraticCurveTo(mx + j(), my + j(), x2 + j() * 0.5, y2 + j() * 0.5);
		ctx.stroke();
	}
}

function caminhoLivre(ctx: CanvasRenderingContext2D, pontos: readonly Ponto[]): void {
	ctx.beginPath();
	ctx.moveTo(pontos[0]![0], pontos[0]![1]);
	if (pontos.length < 3) {
		for (const [x, y] of pontos.slice(1)) ctx.lineTo(x, y);
	} else {
		for (let i = 1; i < pontos.length - 1; i++) {
			const [x, y] = pontos[i]!;
			const [nx, ny] = pontos[i + 1]!;
			ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
		}
		const [lx, ly] = pontos[pontos.length - 1]!;
		ctx.lineTo(lx, ly);
	}
	ctx.stroke();
}

function desenharElemento(ctx: CanvasRenderingContext2D, el: Elemento): void {
	ctx.save();
	ctx.strokeStyle = el.cor;
	ctx.fillStyle = el.cor;
	ctx.lineWidth = el.largura;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const rnd = aleatorio(el.semente);
	if (el.tipo === "caneta") {
		if (el.pontos.length === 1) {
			ctx.beginPath();
			ctx.arc(el.pontos[0]![0], el.pontos[0]![1], ctx.lineWidth / 2, 0, Math.PI * 2);
			ctx.fill();
		} else caminhoLivre(ctx, el.pontos);
	} else if (el.tipo === "texto") {
		ctx.font = FONTE(el.tamanho);
		ctx.textBaseline = "top";
		el.texto.split("\n").forEach((linha, i) => {
			ctx.fillText(linha, el.x, el.y + i * el.tamanho * ALTURA_LINHA);
		});
	} else {
		const { x1, y1, x2, y2 } = el;
		if (el.tipo === "retangulo") {
			traco(ctx, x1, y1, x2, y1, rnd);
			traco(ctx, x2, y1, x2, y2, rnd);
			traco(ctx, x2, y2, x1, y2, rnd);
			traco(ctx, x1, y2, x1, y1, rnd);
		} else if (el.tipo === "elipse") {
			const cx = (x1 + x2) / 2;
			const cy = (y1 + y2) / 2;
			const rx = Math.abs(x2 - x1) / 2;
			const ry = Math.abs(y2 - y1) / 2;
			for (let vez = 0; vez < 2; vez++) {
				const d = Math.min(2, 0.3 + Math.min(rx, ry) * 0.02);
				const inicio = rnd() * Math.PI * 2;
				ctx.beginPath();
				ctx.ellipse(
					cx + (rnd() - 0.5) * d,
					cy + (rnd() - 0.5) * d,
					Math.max(0.5, rx + (rnd() - 0.5) * d * 2),
					Math.max(0.5, ry + (rnd() - 0.5) * d * 2),
					(rnd() - 0.5) * 0.04,
					inicio,
					inicio + Math.PI * 2 + 0.15,
				);
				ctx.stroke();
			}
		} else {
			traco(ctx, x1, y1, x2, y2, rnd);
			if (el.tipo === "seta") {
				const comp = Math.hypot(x2 - x1, y2 - y1);
				const ponta = Math.min(comp * 0.35, 14 + ctx.lineWidth * 2);
				const angulo = Math.atan2(y2 - y1, x2 - x1);
				for (const lado of [-1, 1]) {
					const a = angulo + Math.PI - lado * 0.45;
					traco(ctx, x2, y2, x2 + Math.cos(a) * ponta, y2 + Math.sin(a) * ponta, rnd);
				}
			}
		}
	}
	ctx.restore();
}

/** The element's box, its stroke included. */
function caixaDe(el: Elemento): Caixa {
	if (el.tipo === "texto") return { x: el.x, y: el.y, w: el.w, h: el.h };
	const xs = el.tipo === "caneta" ? el.pontos.map(p => p[0]) : [el.x1, el.x2];
	const ys = el.tipo === "caneta" ? el.pontos.map(p => p[1]) : [el.y1, el.y2];
	const meia = el.largura / 2 + (el.tipo === "seta" ? 14 + el.largura * 2 : 2);
	const x = Math.min(...xs) - meia;
	const y = Math.min(...ys) - meia;
	return { x, y, w: Math.max(...xs) + meia - x, h: Math.max(...ys) + meia - y };
}

function distSegmento(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const l2 = dx * dx + dy * dy;
	const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
	return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Whether (x, y) touches the element: its stroke (shapes are hollow) or a text's box. */
function toca(el: Elemento, x: number, y: number): boolean {
	const tol = Math.max(6, el.largura / 2 + 4);
	if (el.tipo === "texto") return x >= el.x - 4 && x <= el.x + el.w + 4 && y >= el.y - 4 && y <= el.y + el.h + 4;
	if (el.tipo === "caneta") {
		if (el.pontos.length === 1) return Math.hypot(x - el.pontos[0]![0], y - el.pontos[0]![1]) <= tol;
		for (let i = 1; i < el.pontos.length; i++) {
			const [ax, ay] = el.pontos[i - 1]!;
			const [bx, by] = el.pontos[i]!;
			if (distSegmento(x, y, ax, ay, bx, by) <= tol) return true;
		}
		return false;
	}
	const { x1, y1, x2, y2 } = el;
	if (el.tipo === "linha" || el.tipo === "seta") return distSegmento(x, y, x1, y1, x2, y2) <= tol;
	if (el.tipo === "retangulo") {
		return [
			[x1, y1, x2, y1],
			[x2, y1, x2, y2],
			[x2, y2, x1, y2],
			[x1, y2, x1, y1],
		].some(([a, b, c, d]) => distSegmento(x, y, a!, b!, c!, d!) <= tol);
	}
	const rx = Math.abs(x2 - x1) / 2;
	const ry = Math.abs(y2 - y1) / 2;
	if (rx < 1 || ry < 1) return distSegmento(x, y, x1, y1, x2, y2) <= tol;
	const nx = (x - (x1 + x2) / 2) / rx;
	const ny = (y - (y1 + y2) / 2) / ry;
	return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= tol;
}

function mover(el: Elemento, dx: number, dy: number): void {
	if (el.tipo === "caneta") el.pontos = el.pontos.map(([x, y]): Ponto => [x + dx, y + dy]);
	else if (el.tipo === "texto") Object.assign(el, { x: el.x + dx, y: el.y + dy });
	else Object.assign(el, { x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy });
}

/** The scene as a PNG File, cropped around the drawing with MARGEM on white, at 2× (less if huge). */
function exportar(elementos: readonly Elemento[], nome: string): Promise<File | null> {
	if (elementos.length === 0) return Promise.resolve(null);
	const caixas = elementos.map(caixaDe);
	const cx = Math.min(...caixas.map(c => c.x));
	const cy = Math.min(...caixas.map(c => c.y));
	const w = Math.max(...caixas.map(c => c.x + c.w)) - cx + MARGEM * 2;
	const h = Math.max(...caixas.map(c => c.y + c.h)) - cy + MARGEM * 2;
	const escala = Math.min(2, MAX_LADO / Math.max(w, h));
	const tela = document.createElement("canvas");
	tela.width = Math.ceil(w * escala);
	tela.height = Math.ceil(h * escala);
	const ctx = tela.getContext("2d")!;
	ctx.fillStyle = FUNDO;
	ctx.fillRect(0, 0, tela.width, tela.height);
	ctx.setTransform(escala, 0, 0, escala, (MARGEM - cx) * escala, (MARGEM - cy) * escala);
	for (const el of elementos) desenharElemento(ctx, el);
	const { promise, resolve } = Promise.withResolvers<File | null>();
	tela.toBlob(blob => resolve(blob && new File([blob], nome, { type: "image/png" })), "image/png");
	return promise;
}

// ── The dialog ──────────────────────────────────────────────────────────────────────────────

interface Gesto {
	tipo: "mover" | "borracha" | "desenho";
	el?: Elemento;
	x?: number;
	y?: number;
	mudou?: boolean;
}

class Quadro {
	readonly dialog: HTMLDialogElement;
	readonly #area: HTMLElement;
	readonly #tela: HTMLCanvasElement;
	readonly #ctx: CanvasRenderingContext2D;
	readonly #escrita: HTMLTextAreaElement;
	readonly #erro: HTMLElement;
	readonly #desfazer: HTMLButtonElement;
	readonly #refazer: HTMLButtonElement;
	readonly #limpar: HTMLButtonElement;
	readonly #adicionar: HTMLButtonElement;
	#elementos: Elemento[] = [];
	#historico: Elemento[][] = [[]];
	#posicao = 0;
	#ferramenta: Ferramenta = "caneta";
	#cor = CORES[0]![1];
	#largura = 0;
	#selecionado: Elemento | null = null;
	#gesto: Gesto | null = null;
	#editando: {
		original: Extract<Elemento, { tipo: "texto" }> | null;
		el: Extract<Elemento, { tipo: "texto" }>;
	} | null = null;
	#quadroPedido = 0;
	aoAdicionar: ((arquivo: File) => boolean) | null = null;
	foco: Element | null = null;

	constructor() {
		const dialog = document.createElement("dialog");
		dialog.className = "quadro";
		dialog.setAttribute("aria-label", "Quadro de desenho");
		const pixel = (d: string): string =>
			`<svg viewBox="0 0 9 9" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
		const ferramentas = FERRAMENTAS.map(
			([id, nome, tecla, d], i) =>
				`<button type="button" class="quadro__ferramenta" data-ferramenta="${id}" aria-pressed="false" aria-label="${nome}" title="${nome} (${tecla.toUpperCase()} ou ${i + 1})" aria-keyshortcuts="${tecla.toUpperCase()} ${i + 1}">${pixel(d)}</button>`,
		).join("");
		const cores = CORES.map(
			([nome, cor]) =>
				`<button type="button" class="quadro__cor" data-cor="${cor}" aria-pressed="false" aria-label="${nome}" title="${nome}" style="--cor:${cor}"></button>`,
		).join("");
		const larguras = LARGURAS.map(
			([nome, l], i) =>
				`<button type="button" class="quadro__largura" data-largura="${i}" aria-pressed="false" aria-label="${nome}" title="${nome}"><span style="height:${l}px"></span></button>`,
		).join("");
		// Fixed markup: no data from outside goes in.
		dialog.innerHTML = `<div class="quadro__topo">
      <p class="rotulo quadro__titulo">Quadro</p>
      <button type="button" class="icone icone--quieto quadro__fechar" data-fechar aria-label="Fechar" title="Fechar (o desenho fica guardado)"><span aria-hidden="true">✕</span></button>
    </div>
    <div class="quadro__barra">
      <div class="quadro__grupo" role="group" aria-label="Ferramenta">${ferramentas}</div>
      <div class="quadro__grupo" role="group" aria-label="Cor">${cores}</div>
      <div class="quadro__grupo" role="group" aria-label="Espessura">${larguras}</div>
      <div class="quadro__acoes">
        <button type="button" class="botao botao--claro botao--p" data-desfazer aria-keyshortcuts="Meta+Z Control+Z">Desfazer</button>
        <button type="button" class="botao botao--claro botao--p" data-refazer aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y">Refazer</button>
        <button type="button" class="botao botao--claro botao--p" data-limpar>Limpar</button>
        <button type="button" class="botao botao--p" data-adicionar>Adicionar ao prompt</button>
      </div>
    </div>
    <div class="quadro__area">
      <canvas class="quadro__tela"></canvas>
      <textarea class="quadro__escrita" rows="1" aria-label="Texto no quadro" hidden></textarea>
    </div>
    <p class="quadro__erro" aria-live="polite"></p>`;
		document.body.append(dialog);
		const $ = <T extends Element>(seletor: string): T => dialog.querySelector<T>(seletor)!;
		this.dialog = dialog;
		this.#area = $(".quadro__area");
		this.#tela = $(".quadro__tela");
		this.#escrita = $(".quadro__escrita");
		this.#erro = $(".quadro__erro");
		this.#desfazer = $("[data-desfazer]");
		this.#refazer = $("[data-refazer]");
		this.#limpar = $("[data-limpar]");
		this.#adicionar = $("[data-adicionar]");
		// Focusable, so the shortcuts reach the dialog after drawing or writing.
		this.#tela.tabIndex = -1;
		this.#ctx = this.#tela.getContext("2d")!;

		new ResizeObserver(() => this.redimensionar()).observe(this.#area);
		dialog.addEventListener("click", event => this.#clique(event));
		dialog.addEventListener("cancel", event => {
			if (this.#editando) {
				event.preventDefault();
				this.#terminarTexto();
			}
		});
		dialog.addEventListener("close", () => {
			this.#terminarTexto();
			this.#selecionado = null;
			this.#gesto = null;
			this.#erro.textContent = "";
			if (this.foco instanceof HTMLElement && this.foco.isConnected) this.foco.focus();
		});
		dialog.addEventListener("keydown", event => this.#tecla(event));
		this.#tela.addEventListener("pointerdown", event => this.#apertar(event));
		this.#tela.addEventListener("pointermove", event => this.#arrastar(event));
		this.#tela.addEventListener("pointerup", () => this.#soltar());
		this.#tela.addEventListener("pointercancel", () => this.#soltar());
		this.#escrita.addEventListener("input", () => this.#ajustarEscrita());
		this.#escrita.addEventListener("keydown", event => {
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				this.#terminarTexto();
			}
		});
		this.#escrita.addEventListener("blur", () => this.#terminarTexto());
		this.#marcar();
	}

	abrir(): void {
		this.#erro.textContent = "";
		this.dialog.showModal();
		this.#tela.focus({ preventScroll: true });
		this.redimensionar();
	}

	redimensionar(): void {
		const { width, height } = this.#area.getBoundingClientRect();
		if (!width || !height) return;
		const dpr = window.devicePixelRatio || 1;
		this.#tela.width = Math.round(width * dpr);
		this.#tela.height = Math.round(height * dpr);
		this.#tela.style.width = `${width}px`;
		this.#tela.style.height = `${height}px`;
		this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.#render();
	}

	#clique(event: MouseEvent): void {
		const b = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
		if (!b) return;
		if (b.matches("[data-fechar]")) this.dialog.close();
		else if (b.dataset.ferramenta) this.#escolherFerramenta(b.dataset.ferramenta as Ferramenta);
		else if (b.dataset.cor) {
			this.#cor = b.dataset.cor;
			if (this.#selecionado) this.#alterarSelecionado({ cor: this.#cor });
			this.#marcar();
		} else if (b.dataset.largura) {
			this.#largura = Number(b.dataset.largura);
			if (this.#selecionado) {
				const [, largura, tamanho] = LARGURAS[this.#largura]!;
				this.#alterarSelecionado(this.#selecionado.tipo === "texto" ? { tamanho } : { largura });
			}
			this.#marcar();
		} else if (b === this.#desfazer) this.#andar(-1);
		else if (b === this.#refazer) this.#andar(1);
		else if (b === this.#limpar) {
			if (this.#elementos.length === 0) return;
			this.#elementos = [];
			this.#selecionado = null;
			this.#gravar();
		} else if (b === this.#adicionar) void this.#adicionarAoPrompt();
	}

	#tecla(event: KeyboardEvent): void {
		if (event.target === this.#escrita) return;
		const mod = event.metaKey || event.ctrlKey;
		const tecla = event.key.toLowerCase();
		if (mod && tecla === "z") {
			event.preventDefault();
			this.#andar(event.shiftKey ? 1 : -1);
		} else if (mod && tecla === "y") {
			event.preventDefault();
			this.#andar(1);
		} else if (!mod && !event.altKey && (event.key === "Delete" || event.key === "Backspace") && this.#selecionado) {
			event.preventDefault();
			const selecionado = this.#selecionado;
			this.#elementos = this.#elementos.filter(el => el !== selecionado);
			this.#selecionado = null;
			this.#gravar();
		} else if (!mod && !event.altKey) {
			const i = FERRAMENTAS.findIndex(([, , t], n) => t === tecla || String(n + 1) === event.key);
			if (i >= 0) {
				event.preventDefault();
				this.#escolherFerramenta(FERRAMENTAS[i]![0]);
			}
		}
	}

	/** While dragging, one redraw per frame however many pointer events come. */
	#pedirRender(): void {
		if (this.#quadroPedido) return;
		this.#quadroPedido = requestAnimationFrame(() => {
			this.#quadroPedido = 0;
			this.#render();
		});
	}

	#render(): void {
		const dpr = window.devicePixelRatio || 1;
		// Transparent: the paper and its dot grid are the area's CSS background.
		this.#ctx.clearRect(0, 0, this.#tela.width / dpr, this.#tela.height / dpr);
		for (const el of this.#elementos) if (el !== this.#editando?.original) desenharElemento(this.#ctx, el);
		const novo = this.#gesto?.el;
		if (novo && !this.#elementos.includes(novo)) desenharElemento(this.#ctx, novo);
		if (this.#selecionado) {
			const c = caixaDe(this.#selecionado);
			this.#ctx.save();
			this.#ctx.strokeStyle = "#ff5100";
			this.#ctx.lineWidth = 1.5;
			this.#ctx.setLineDash([5, 4]);
			this.#ctx.strokeRect(c.x - 4, c.y - 4, c.w + 8, c.h + 8);
			this.#ctx.restore();
		}
		this.#desfazer.disabled = this.#posicao === 0;
		this.#refazer.disabled = this.#posicao >= this.#historico.length - 1;
		this.#limpar.disabled = this.#elementos.length === 0;
		this.#adicionar.disabled = this.#elementos.length === 0;
	}

	#marcar(): void {
		for (const b of this.dialog.querySelectorAll<HTMLElement>("[data-ferramenta]")) {
			b.setAttribute("aria-pressed", String(b.dataset.ferramenta === this.#ferramenta));
		}
		for (const b of this.dialog.querySelectorAll<HTMLElement>("[data-cor]")) {
			b.setAttribute("aria-pressed", String(b.dataset.cor === this.#cor));
		}
		for (const b of this.dialog.querySelectorAll<HTMLElement>("[data-largura]")) {
			b.setAttribute("aria-pressed", String(Number(b.dataset.largura) === this.#largura));
		}
		this.#tela.dataset.ferramenta = this.#ferramenta;
	}

	#escolherFerramenta(ferramenta: Ferramenta): void {
		this.#terminarTexto();
		this.#ferramenta = ferramenta;
		if (ferramenta !== "mover") this.#selecionado = null;
		this.#marcar();
		this.#render();
	}

	/** Undo history: a snapshot of the scene after each change. */
	#gravar(): void {
		this.#historico = this.#historico.slice(0, this.#posicao + 1);
		this.#historico.push(structuredClone(this.#elementos));
		if (this.#historico.length > 200) this.#historico.shift();
		this.#posicao = this.#historico.length - 1;
		this.#render();
	}

	#andar(passo: number): void {
		this.#terminarTexto();
		const p = this.#posicao + passo;
		if (p < 0 || p >= this.#historico.length) return;
		this.#posicao = p;
		this.#elementos = structuredClone(this.#historico[p]!);
		this.#selecionado = null;
		this.#render();
	}

	#alterarSelecionado(mudanca: Partial<{ cor: string; largura: number; tamanho: number }>): void {
		const selecionado = this.#selecionado!;
		Object.assign(selecionado, mudanca);
		if (selecionado.tipo === "texto") this.#medirTexto(selecionado);
		this.#gravar();
	}

	#medirTexto(el: Extract<Elemento, { tipo: "texto" }>): void {
		this.#ctx.save();
		this.#ctx.font = FONTE(el.tamanho);
		const linhas = el.texto.split("\n");
		el.w = Math.max(...linhas.map(l => this.#ctx.measureText(l).width), 4);
		el.h = linhas.length * el.tamanho * ALTURA_LINHA;
		this.#ctx.restore();
	}

	#ponto(event: PointerEvent): Ponto {
		const r = this.#tela.getBoundingClientRect();
		return [event.clientX - r.left, event.clientY - r.top];
	}

	#noTopo(x: number, y: number): Elemento | null {
		return this.#elementos.findLast(el => toca(el, x, y)) ?? null;
	}

	#apertar(event: PointerEvent): void {
		if (event.button !== 0) return;
		const [x, y] = this.#ponto(event);
		const f = this.#ferramenta;
		if (f === "texto") {
			event.preventDefault(); // keeps the textarea's focus
			this.#terminarTexto();
			const el = this.#noTopo(x, y);
			this.#escrever(el?.tipo === "texto" ? el : null, x, y);
			return;
		}
		this.#terminarTexto();
		this.#tela.setPointerCapture(event.pointerId);
		const [, largura] = LARGURAS[this.#largura]!;
		const semente = Math.floor(Math.random() * 2 ** 31);
		if (f === "mover") {
			this.#selecionado = this.#noTopo(x, y);
			const s = this.#selecionado;
			if (s) {
				// The palette shows the selected one's colour and width; picking another changes it.
				const i = LARGURAS.findIndex(([, l, t]) => (s.tipo === "texto" ? t === s.tamanho : l === s.largura));
				if (i >= 0) this.#largura = i;
				this.#cor = s.cor;
				this.#marcar();
			}
			this.#gesto = s ? { tipo: "mover", x, y, mudou: false } : null;
		} else if (f === "borracha") {
			this.#gesto = { tipo: "borracha", mudou: false };
			this.#apagarEm(x, y);
		} else if (f === "caneta") {
			this.#gesto = { tipo: "desenho", el: { tipo: "caneta", pontos: [[x, y]], cor: this.#cor, largura, semente } };
		} else {
			this.#gesto = {
				tipo: "desenho",
				el: { tipo: f, x1: x, y1: y, x2: x, y2: y, cor: this.#cor, largura, semente },
			};
		}
		this.#render();
	}

	#arrastar(event: PointerEvent): void {
		const g = this.#gesto;
		if (!g) return;
		const eventos = event.getCoalescedEvents?.() ?? [event];
		const [x, y] = this.#ponto(eventos[eventos.length - 1] ?? event);
		if (g.tipo === "mover" && this.#selecionado) {
			mover(this.#selecionado, x - g.x!, y - g.y!);
			g.x = x;
			g.y = y;
			g.mudou = true;
		} else if (g.tipo === "borracha") {
			for (const e of eventos) this.#apagarEm(...this.#ponto(e));
		} else if (g.el?.tipo === "caneta") {
			for (const e of eventos) {
				const p = this.#ponto(e);
				const [ux, uy] = g.el.pontos[g.el.pontos.length - 1]!;
				if (Math.hypot(p[0] - ux, p[1] - uy) >= 1.5) g.el.pontos.push(p);
			}
		} else if (g.el && g.el.tipo !== "texto") {
			let nx = x;
			let ny = y;
			// Shift: a square, a circle, a line at multiples of 45°.
			if (event.shiftKey) {
				const dx = x - g.el.x1;
				const dy = y - g.el.y1;
				if (g.el.tipo === "retangulo" || g.el.tipo === "elipse") {
					const l = Math.max(Math.abs(dx), Math.abs(dy));
					nx = g.el.x1 + Math.sign(dx || 1) * l;
					ny = g.el.y1 + Math.sign(dy || 1) * l;
				} else {
					const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
					const l = Math.hypot(dx, dy);
					nx = g.el.x1 + Math.cos(a) * l;
					ny = g.el.y1 + Math.sin(a) * l;
				}
			}
			g.el.x2 = nx;
			g.el.y2 = ny;
		}
		this.#pedirRender();
	}

	#soltar(): void {
		const g = this.#gesto;
		if (!g) return;
		this.#gesto = null;
		if (g.tipo === "desenho" && g.el) {
			const el = g.el;
			const pequeno = el.tipo !== "caneta" && el.tipo !== "texto" && Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 3;
			if (!pequeno) {
				if (el.tipo === "retangulo" || el.tipo === "elipse") {
					Object.assign(el, {
						x1: Math.min(el.x1, el.x2),
						y1: Math.min(el.y1, el.y2),
						x2: Math.max(el.x1, el.x2),
						y2: Math.max(el.y1, el.y2),
					});
				}
				this.#elementos.push(el);
				this.#gravar();
				return;
			}
		} else if (g.mudou) {
			this.#gravar();
			return;
		}
		this.#render();
	}

	#apagarEm(x: number, y: number): void {
		const antes = this.#elementos.length;
		this.#elementos = this.#elementos.filter(el => !toca(el, x, y));
		if (this.#elementos.length !== antes && this.#gesto) {
			this.#gesto.mudou = true;
			this.#pedirRender();
		}
	}

	/** Text: a textarea over the board where you clicked (or over the text you clicked, to edit it). */
	#escrever(original: Extract<Elemento, { tipo: "texto" }> | null, x: number, y: number): void {
		const [, , tamanho] = LARGURAS[this.#largura]!;
		const el = original ?? {
			tipo: "texto" as const,
			x,
			y: y - tamanho * 0.6,
			w: 0,
			h: 0,
			texto: "",
			cor: this.#cor,
			largura: 2,
			semente: 1,
			tamanho,
		};
		this.#editando = { original, el };
		Object.assign(this.#escrita.style, {
			left: `${el.x}px`,
			top: `${el.y}px`,
			color: el.cor,
			font: FONTE(el.tamanho),
			lineHeight: `${el.tamanho * ALTURA_LINHA}px`,
		});
		this.#escrita.value = el.texto;
		this.#escrita.hidden = false;
		this.#ajustarEscrita();
		this.#render();
		this.#escrita.focus();
	}

	#ajustarEscrita(): void {
		const s = this.#escrita.style;
		s.height = "auto";
		s.width = "auto";
		s.width = `${Math.max(40, this.#escrita.scrollWidth + 8)}px`;
		s.height = `${this.#escrita.scrollHeight}px`;
	}

	#terminarTexto(): void {
		const editando = this.#editando;
		if (!editando) return;
		const { original, el } = editando;
		this.#editando = null;
		if (document.activeElement === this.#escrita && this.dialog.open) this.#tela.focus({ preventScroll: true });
		this.#escrita.hidden = true;
		const texto = this.#escrita.value.replace(/\s+$/, "");
		this.#escrita.value = "";
		if (original && !texto) this.#elementos = this.#elementos.filter(e => e !== original);
		else if (texto && texto !== el.texto) {
			el.texto = texto;
			this.#medirTexto(el);
			if (!original) this.#elementos.push(el);
		} else {
			this.#render();
			return;
		}
		this.#gravar();
	}

	async #adicionarAoPrompt(): Promise<void> {
		this.#terminarTexto();
		this.#selecionado = null;
		const hora = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
		this.#adicionar.disabled = true;
		try {
			const arquivo = await exportar(this.#elementos, `quadro-${hora}.png`);
			if (!arquivo) throw new Error("Não consegui gerar a imagem do quadro.");
			if (!this.aoAdicionar?.(arquivo)) throw new Error("A caixa não aceitou o desenho agora.");
			this.#elementos = [];
			this.#historico = [[]];
			this.#posicao = 0;
			this.dialog.close();
		} catch (err) {
			this.#erro.textContent = err instanceof Error ? err.message : String(err);
		} finally {
			this.#render();
		}
	}
}

let quadro: Quadro | null = null;

/**
 * Opens the whiteboard. `aoAdicionar(file)` gets the PNG and returns whether the box took it;
 * only then the board is emptied and closes.
 */
export function abrirQuadro(aoAdicionar: (arquivo: File) => boolean): void {
	quadro ??= new Quadro();
	quadro.aoAdicionar = aoAdicionar;
	quadro.foco = document.activeElement;
	quadro.abrir();
}

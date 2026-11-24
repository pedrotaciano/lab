// The pixel room: one canvas, each team at a round table (planta.ts), its chats round it in
// miniature (moveis.ts), a balloon over each one at work with what it does, an orange "!" over
// one waiting for you, a "✕" over one that failed. Click a figure to open its chat. Modelled on
// the POC's scene (laboratorio/web/sala/cena.js), cut to what the lab shows.
import type { Estado, ResumoChat, StatusChat, Time } from "../tipos";
import { A, loadArt, sortear } from "./arte";
import {
	ALTO,
	banquinho,
	bubble,
	figure,
	type Icone,
	MESA_REDONDA,
	marca,
	mesaRedonda,
	type Pose,
	SIT,
	type Vista,
} from "./moveis";
import { horaReal, type Luz, luz } from "./noite";
import { CENTER, drawFloor, drawRoom, lugaresDaOrbi, type Lugar, mesaDe, RH, RW } from "./planta";
import { type Look, vestir } from "./roupa";
import { C, MONO, NOITE, PONTO, reduced, aoMudarMovimento, T } from "./tela";

export interface OpcoesSala {
	aoClicar(chatId: string): void;
	aoClicarMesa?(timeId: string): void;
	aoAdicionarTime?(): void;
	/** Where the art is served (default "/arte/"). */
	arte?: string;
	/** The room's hour (14.5 = 14:30), for its light; default the real clock. */
	hora?: () => number;
}

/** At most this many chats sit at a table; the rest show as "+N". */
export const NA_MESA = 6;
const STEP_MS = 50;
// The ring round a table: its centre below the table's line, its radii; a figure's width kept
// between two neighbouring rings.
const RODA = { dy: 5, rx: 24, ry: 8 };
const VAO = 10;
const URGENCIA: Record<StatusChat, number> = { esperando: 4, erro: 3, trabalhando: 2, livre: 1, parado: 0 };

interface Caixa {
	l: number;
	t: number;
	r: number;
	b: number;
}
/** A label laid out (its box, canvas CSS px) and painted later. */
interface Rotulo {
	caixa: Caixa;
	pintar(): void;
}
interface Figura {
	chat: ResumoChat;
	look: Look;
	x: number;
	y: number;
	view: Vista;
	pose: Pose;
	icone: Icone | null;
}
interface Mesa {
	time: Time | null;
	lugar: Lugar;
	figuras: Figura[];
	mais: number;
	status: StatusChat | null;
}

const ICONE_DE: [RegExp, Icone][] = [
	[/^(lendo|lê|abrindo|vendo)/, "read"],
	[/^(buscando|procurando|pesquisando)/, "search"],
	[/^(editando|escrevendo|criando|apagando|corrigindo)/, "edit"],
	[/^(rodando|executando|testando|\$)/, "run"],
];
/** The balloon's icon for what a chat does now ("lendo src/app.ts" → read); "pensando" or anything else, dots. */
export function iconeDe(atividade: string | null): Icone {
	const t = (atividade ?? "").trim().toLowerCase();
	return ICONE_DE.find(([re]) => re.test(t))?.[1] ?? "dots";
}

/** Who sits at a table: all, up to NA_MESA; more, the ones at work first, still in their order. */
function quemSenta(chats: ResumoChat[]): ResumoChat[] {
	if (chats.length <= NA_MESA) return chats;
	const vez = [...chats].sort((a, b) => URGENCIA[b.status] - URGENCIA[a.status]).slice(0, NA_MESA);
	return chats.filter(c => vez.includes(c));
}

/**
 * The `n` places round a table: an even ring round its top, the first at its back (facing you)
 * when `n` is odd, else the first pair either side; each facing the table. A side with a
 * neighbouring table close by is narrowed so the two rings keep VAO between them.
 */
function rodaDe(s: Lugar, n: number, mesas: Lugar[]): [number, number, Vista][] {
	const raio = (lado: number) => {
		const vizinhas = mesas.filter(
			o => o !== s && Math.abs(o.y - s.y) < 2 * RODA.ry + 18 && Math.sign(o.x - s.x) === lado,
		);
		return Math.max(8, Math.min(RODA.rx, ...vizinhas.map(o => (Math.abs(o.x - s.x) - VAO) / 2)));
	};
	const rx = { [-1]: raio(-1), 1: raio(1) } as Record<number, number>;
	const de = n % 2 ? 0 : Math.PI / n;
	return Array.from({ length: n }, (_, j) => {
		const a = de + (j * 2 * Math.PI) / n;
		const lado = Math.sign(Math.round(Math.sin(a) * 1000));
		const x = s.x + (lado ? lado * rx[lado] * Math.abs(Math.sin(a)) : 0);
		const y = s.y + RODA.dy - RODA.ry * Math.cos(a);
		const graus = Math.round((a * 180) / Math.PI) % 360;
		const view: Vista =
			graus < 60 || graus > 300 ? "down" : graus > 120 && graus < 240 ? "up" : lado < 0 ? "right" : "left";
		return [Math.round(x), Math.round(y), view];
	});
}

const fonte = (px: number, peso = 500) => `${peso} ${px}px ${MONO}`;
const cruza = (a: Caixa, b: Caixa, m = 2) => a.l < b.r + m && b.l < a.r + m && a.t < b.b + m && b.t < a.b + m;
const dentro = (b: Caixa, x: number, y: number) => x >= b.l && x <= b.r && y >= b.t && y <= b.b;

export class Sala {
	#canvas: HTMLCanvasElement;
	#ctx: CanvasRenderingContext2D;
	#opts: OpcoesSala;
	#floor = document.createElement("canvas");
	#room = document.createElement("canvas");
	#feitoPara = 0; // the device pitch the static room was painted at
	#W = 0;
	#H = 0;
	#dpr = 1;
	#estado: Estado | null = null;
	#mesas: Mesa[] = [];
	#looks = new Map<string, Look>(); // `${chatId}:${papel}` → look, once the art is in
	#hover: Figura | null = null;
	#alvosFiguras: { fig: Figura; caixa: Caixa }[] = [];
	#alvosMesas: { mesa: Mesa; caixa: Caixa }[] = [];
	#topos = new Map<Figura, number>(); // where each one's balloon went (its top, art px), for the name over it
	#passo: number | null = null;
	#relogio: number | null = null;
	#observer: ResizeObserver;
	#desligar: (() => void)[] = [];
	#vivo = true;

	constructor(canvas: HTMLCanvasElement, opts: OpcoesSala) {
		this.#canvas = canvas;
		this.#ctx = canvas.getContext("2d")!;
		this.#opts = opts;
		if (!canvas.hasAttribute("aria-label")) canvas.setAttribute("aria-label", "Sala");
		this.#observer = new ResizeObserver(() => this.#layout());
		this.#observer.observe(canvas);
		const ouvir = <K extends keyof HTMLElementEventMap>(
			alvo: HTMLElement,
			tipo: K,
			fn: (e: HTMLElementEventMap[K]) => void,
		) => {
			alvo.addEventListener(tipo, fn);
			this.#desligar.push(() => alvo.removeEventListener(tipo, fn));
		};
		ouvir(canvas, "click", e => this.#clique(e.offsetX, e.offsetY));
		ouvir(canvas, "pointermove", e => this.#mover(e.offsetX, e.offsetY));
		ouvir(canvas, "pointerleave", () => this.#mover(-1, -1));
		const visivel = () => this.#animar();
		document.addEventListener("visibilitychange", visivel);
		this.#desligar.push(() => document.removeEventListener("visibilitychange", visivel));
		this.#desligar.push(aoMudarMovimento(() => this.#animar()));
		const fontes = () => this.#draw();
		document.fonts?.addEventListener("loadingdone", fontes);
		this.#desligar.push(() => document.fonts?.removeEventListener("loadingdone", fontes));
		loadArt(opts.arte ?? "/arte/").then(
			() => {
				if (!this.#vivo) return;
				this.#montar();
				this.#draw();
			},
			() => {
				// No wardrobe: the room stays as before the art, tables and names without figures.
			},
		);
		this.#layout();
	}

	mostrar(estado: Estado): void {
		this.#estado = estado;
		this.#montar();
		this.#draw();
		this.#animar();
	}

	destruir(): void {
		this.#vivo = false;
		this.#observer.disconnect();
		for (const fn of this.#desligar) fn();
		clearInterval(this.#passo ?? undefined);
		clearInterval(this.#relogio ?? undefined);
		this.#passo = this.#relogio = null;
	}

	// ── State → tables and figures ────────────────────────────────────────────────────────
	#lookDe(chat: ResumoChat): Look {
		const chave = `${chat.id}:${chat.papel ?? ""}`;
		const pronto = this.#looks.get(chave);
		if (pronto) return pronto;
		const look = vestir(sortear(chat.id), chat.papel);
		if (A.ready) this.#looks.set(chave, look);
		return look;
	}

	#montar(): void {
		const times = this.#estado?.times ?? [];
		const chats = this.#estado?.chats ?? [];
		const n = times.length;
		if (!n) {
			// No team yet: one table in the middle of the rug, and the way to add the first.
			this.#mesas = [{ time: null, lugar: { x: CENTER[0], y: CENTER[1] - 14 }, figuras: [], mais: 0, status: null }];
			return;
		}
		const lugares = lugaresDaOrbi(n);
		const ocupados = times.map((_, i) => lugares[mesaDe(i, n)]);
		const vistos = new Set<string>();
		this.#mesas = times.map((time, i) => {
			const lugar = ocupados[i];
			const doTime = chats.filter(c => c.timeId === time.id);
			const sentam = quemSenta(doTime);
			const roda = rodaDe(lugar, sentam.length, ocupados);
			const figuras = sentam.map((chat, j): Figura => {
				vistos.add(`${chat.id}:${chat.papel ?? ""}`);
				const [x, y, view] = roda[j];
				const trabalha = chat.status === "trabalhando";
				const icone = trabalha ? iconeDe(chat.atividade) : chat.status === "erro" ? "x" : null;
				const pose: Pose = !trabalha ? "seated" : icone === "read" || icone === "search" ? "read" : "type";
				return { chat, look: this.#lookDe(chat), x, y, view, pose, icone };
			});
			const status = doTime.reduce<StatusChat | null>(
				(m, c) => (m === null || URGENCIA[c.status] > URGENCIA[m] ? c.status : m),
				null,
			);
			return { time, lugar, figuras, mais: doTime.length - sentam.length, status };
		});
		for (const k of this.#looks.keys()) if (!vistos.has(k)) this.#looks.delete(k);
		if (this.#hover)
			this.#hover = this.#mesas.flatMap(m => m.figuras).find(f => f.chat.id === this.#hover?.chat.id) ?? null;
	}

	// ── Layout ────────────────────────────────────────────────────────────────────────────
	#layout(): void {
		const W = this.#canvas.clientWidth;
		const H = this.#canvas.clientHeight;
		if (!W || !H) return;
		this.#W = W;
		this.#H = H;
		this.#dpr = Math.min(2, devicePixelRatio || 1);
		const dpr = this.#dpr;
		T.dpr = dpr;
		// The pitch in device pixels: the most whole ones per art pixel that fit (up to 5 CSS px),
		// so every art pixel is the same square. Under 2 (a 1× screen with a narrow area) the
		// quarter step that fits, never under 1: the edges still land on device pixels (tela.ts dot).
		const cabe = Math.min((W * dpr) / RW, (H * dpr) / RH);
		let Pd = Math.min(Math.floor(5 * dpr), Math.floor(cabe));
		if (Pd < 2) Pd = Math.max(1, Math.floor(cabe * 4) / 4);
		T.P = Pd / dpr;
		T.org = [Math.round(((W - RW * T.P) / 2) * dpr) / dpr, Math.round(((H - RH * T.P) / 2) * dpr) / dpr];
		this.#canvas.width = Math.round(W * dpr);
		this.#canvas.height = Math.round(H * dpr);
		// The static room, painted at the whole pitch at or above it and drawn down to it unsmoothed.
		const pintado = Math.ceil(Pd);
		if (pintado !== this.#feitoPara) {
			this.#feitoPara = pintado;
			for (const cv of [this.#floor, this.#room]) {
				cv.width = RW * pintado;
				cv.height = RH * pintado;
			}
			drawFloor(this.#floor, pintado);
			drawRoom(this.#room, pintado);
		}
		this.#draw();
	}

	// ── Motion: only while someone works or waits, the tab shows, and motion is welcome ────
	#animar(): void {
		const mexe =
			this.#vivo &&
			!document.hidden &&
			!reduced() &&
			!!this.#estado?.chats.some(c => c.status === "trabalhando" || c.status === "esperando");
		if (mexe && !this.#passo) {
			this.#passo = window.setInterval(() => {
				T.tick++;
				this.#draw();
			}, STEP_MS);
		} else if (!mexe && this.#passo) {
			clearInterval(this.#passo);
			this.#passo = null;
		}
		// The light follows the clock: once a minute is enough.
		const relogio = this.#vivo && !document.hidden;
		if (relogio && !this.#relogio) this.#relogio = window.setInterval(() => this.#passo || this.#draw(), 60_000);
		else if (!relogio && this.#relogio) {
			clearInterval(this.#relogio);
			this.#relogio = null;
		}
		if (!document.hidden) this.#draw();
	}

	// ── Drawing ───────────────────────────────────────────────────────────────────────────
	#draw(): void {
		if (!this.#vivo || !this.#W || document.hidden) return;
		const ctx = this.#ctx;
		T.ctx = ctx;
		ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
		ctx.clearRect(0, 0, this.#W, this.#H);
		ctx.imageSmoothingEnabled = false;
		const { org, P } = T;
		ctx.drawImage(this.#floor, org[0], org[1], RW * P, RH * P);
		ctx.drawImage(this.#room, org[0], org[1], RW * P, RH * P);
		const parado = reduced();
		const frame = parado ? 0 : T.tick >> 2;

		// Tables and figures, back to front. Before the art, the tables alone: nothing moves when it comes.
		const items: { z: number; fn: () => void }[] = [];
		const luzes: Luz[] = [];
		for (const m of this.#mesas) {
			const s = m.lugar;
			const trabalhando = m.figuras.some(f => f.chat.status === "trabalhando");
			if (!m.time) items.push({ z: s.y - 0.5, fn: () => banquinho(s.x, s.y) });
			items.push({
				z: s.y + MESA_REDONDA.dy,
				fn: () => {
					T.tk = trabalhando && !parado ? T.tick : 0;
					mesaRedonda(s, m.figuras.length > 0, trabalhando);
				},
			});
			if (trabalhando) luzes.push([s.x, s.y + 1, 14]);
			if (!A.ready) continue;
			for (const f of m.figuras) {
				items.push({
					z: f.y,
					fn: () =>
						figure(
							{ x: f.x, y: f.y, view: f.view, pose: f.pose, frame, apagado: f.chat.status === "parado" },
							f.look,
						),
				});
			}
		}
		items.sort((a, b) => a.z - b.z);
		for (const it of items) it.fn();
		luz((this.#opts.hora ?? horaReal)(), luzes);

		// The labels: each table's team under it (the add button at an empty room's table), "+N".
		// Laid out now, so the balloons keep off them; painted over the balloons, below.
		const rotulos: Rotulo[] = [];
		this.#alvosMesas = [];
		for (const m of this.#mesas) {
			const s = m.lugar;
			const y = Math.round(org[1] + (s.y + RODA.dy + RODA.ry + SIT + 1) * P);
			const cx = Math.round(org[0] + s.x * P);
			const rotulo = m.time
				? this.#etiquetaSemCruzar(
						m.time.nome,
						cx,
						y,
						m.status ? PONTO[m.status] : PONTO.parado,
						rotulos.map(r => r.caixa),
					)
				: this.#botao("Adicionar time", cx, y);
			rotulos.push(rotulo);
			const mesa: Caixa = {
				l: org[0] + (s.x - 14) * P,
				t: org[1] + (s.y - 2) * P,
				r: org[0] + (s.x + 14) * P,
				b: org[1] + (s.y + 16) * P,
			};
			this.#alvosMesas.push({ mesa: m, caixa: rotulo.caixa }, { mesa: m, caixa: mesa });
			if (m.mais) {
				const fora = s.x < CENTER[0] ? -1 : 1;
				const cx = Math.round(org[0] + (s.x + fora * (RODA.rx + 10)) * P);
				const base = Math.round(org[1] + (s.y + 10) * P);
				const mais = `+${m.mais}`;
				rotulos.push({
					caixa: { l: cx - 12, t: base - 14, r: cx + 12, b: base - 1 },
					pintar: () => this.#pilula(mais, cx, base),
				});
			}
		}

		// Over the heads: the balloons, the "!" and the "✕" (art px). Each over its own head, a
		// little aside or higher, clear of the heads, the balloons already down and the labels; when
		// nowhere clears the labels too, over one rather than over someone else's balloon or face.
		const figurasNaTela: { fig: Figura; caixa: Caixa }[] = [];
		this.#topos.clear();
		if (A.ready) {
			const todas = this.#mesas.flatMap(m => m.figuras);
			const ocupado: Caixa[] = todas.map(f => {
				const cabeca = f.y + SIT - ALTO;
				return { l: f.x - 4, t: cabeca + 1, r: f.x + 4, b: cabeca + 10 };
			});
			const nomes = rotulos.map(({ caixa: b }) => ({
				l: (b.l - org[0]) / P,
				t: (b.t - org[1]) / P,
				r: (b.r - org[0]) / P,
				b: (b.b - org[1]) / P,
			}));
			const livre = (c: Caixa, de: Caixa[]) => !de.some(o => o.l < c.r && c.l < o.r && o.t < c.b && c.t < o.b);
			for (const f of [...todas].sort((a, b) => a.y - b.y)) {
				const cabeca = f.y + SIT - ALTO;
				figurasNaTela.push({
					fig: f,
					caixa: {
						l: org[0] + (f.x - 6) * P,
						t: org[1] + (cabeca - 1) * P,
						r: org[0] + (f.x + 6) * P,
						b: org[1] + (f.y + SIT + 1) * P,
					},
				});
				const espera = f.chat.status === "esperando";
				if (!espera && !f.icone) continue;
				const [w, h] = espera ? [5, 10] : [9, 9];
				const em = (dx: number, dy: number): Caixa => {
					const l = f.x - (w >> 1) + dx;
					return { l, t: cabeca - h + dy, r: l + w, b: cabeca + dy };
				};
				const tentativas: [number, number, Caixa[]][] = [];
				for (const dy of [0, -4])
					for (const dx of [0, -5, 5, -9, 9]) tentativas.push([dx, dy, [...ocupado, ...nomes]]);
				for (const dy of [0, -4]) for (const dx of [0, -5, 5]) tentativas.push([dx, dy, ocupado]);
				const [dx, dy] = tentativas.find(([x, y, de]) => livre(em(x, y), de)) ?? [0, 0];
				ocupado.push(em(dx, dy));
				this.#topos.set(f, cabeca - h + dy);
				if (espera) marca(f.x + dx, cabeca + dy);
				else if (f.icone === "x") bubble("x", f.x - 4 + dx, cabeca - 9 + dy, C.G, NOITE);
				else if (f.icone) bubble(f.icone, f.x - 4 + dx, cabeca - 9 + dy);
			}
		}
		this.#alvosFiguras = figurasNaTela.sort((a, b) => b.fig.y - a.fig.y);
		for (const r of rotulos) r.pintar();
		// The one under the mouse: its name over its head.
		const h = this.#hover;
		if (h && A.ready) {
			const cabeca = (this.#topos.get(h) ?? h.y + SIT - ALTO) - 1;
			const m = this.#medir(h.chat.nome, 180);
			const cx = Math.round(org[0] + h.x * P);
			const l = Math.round(Math.min(Math.max(2, cx - m.w / 2), this.#W - m.w - 2));
			const t = Math.max(2, Math.round(org[1] + cabeca * P) - 18);
			this.#pintar(m, l, t, PONTO[h.chat.status]);
		}
	}

	#medir(texto: string, max: number): { texto: string; w: number } {
		const ctx = this.#ctx;
		ctx.font = fonte(10);
		if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
		const cabe = caber(ctx, texto, max - 20);
		return { texto: cabe, w: Math.ceil(ctx.measureText(cabe).width) + 20 };
	}
	// A label, Gather style: a dark pill, a status dot, the text in mono.
	#pintar(m: { texto: string; w: number }, l: number, t: number, ponto: string): Caixa {
		const ctx = this.#ctx;
		ctx.fillStyle = "rgba(41, 37, 30, 0.86)";
		ctx.beginPath();
		ctx.roundRect(l, t, m.w, 16, 8);
		ctx.fill();
		ctx.fillStyle = ponto;
		ctx.beginPath();
		ctx.arc(l + 8, t + 8, 3, 0, Math.PI * 2);
		ctx.fill();
		ctx.font = fonte(10);
		ctx.fillStyle = C.W;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(m.texto, l + 14, t + 8.5);
		return { l, t, r: l + m.w, b: t + 16 };
	}
	// A team's label centred at cx, its top at y: cut shorter until it clears the ones already down.
	#etiquetaSemCruzar(texto: string, cx: number, y: number, ponto: string, ocupado: Caixa[]): Rotulo {
		let m = this.#medir(texto, 160);
		for (const max of [160, 120, 92, 70]) {
			m = this.#medir(texto, max);
			const l = Math.round(cx - m.w / 2);
			if (!ocupado.some(o => cruza(o, { l, t: y, r: l + m.w, b: y + 16 }))) break;
		}
		const l = Math.round(cx - m.w / 2);
		return { caixa: { l, t: y, r: l + m.w, b: y + 16 }, pintar: () => this.#pintar(m, l, y, ponto) };
	}
	// The empty room's one action: an orange pill.
	#botao(texto: string, cx: number, y: number): Rotulo {
		const ctx = this.#ctx;
		ctx.font = fonte(11, 600);
		const w = Math.ceil(ctx.measureText(texto).width) + 20;
		const l = Math.round(cx - w / 2);
		const pintar = () => {
			ctx.font = fonte(11, 600);
			ctx.fillStyle = C.O;
			ctx.beginPath();
			ctx.roundRect(l, y, w, 20, 10);
			ctx.fill();
			ctx.fillStyle = C.W;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(texto, cx, y + 10.5);
		};
		return { caixa: { l, t: y, r: l + w, b: y + 20 }, pintar };
	}
	// A small dark pill with light text, its bottom at y.
	#pilula(texto: string, cx: number, y: number): void {
		const ctx = this.#ctx;
		ctx.font = fonte(9, 600);
		const w = Math.ceil(ctx.measureText(texto).width) + 10;
		ctx.fillStyle = "rgba(41, 37, 30, 0.88)";
		ctx.beginPath();
		ctx.roundRect(cx - w / 2, y - 14, w, 13, 6);
		ctx.fill();
		ctx.fillStyle = C.L;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(texto, cx, y - 7);
	}

	// ── Input ─────────────────────────────────────────────────────────────────────────────
	#figuraEm(x: number, y: number): Figura | null {
		return this.#alvosFiguras.find(a => dentro(a.caixa, x, y))?.fig ?? null;
	}
	#clique(x: number, y: number): void {
		const f = this.#figuraEm(x, y);
		if (f) return this.#opts.aoClicar(f.chat.id);
		const m = this.#alvosMesas.find(a => dentro(a.caixa, x, y))?.mesa;
		if (!m) return;
		if (m.time) this.#opts.aoClicarMesa?.(m.time.id);
		else this.#opts.aoAdicionarTime?.();
	}
	#mover(x: number, y: number): void {
		const f = this.#figuraEm(x, y);
		const mesa = !f && this.#alvosMesas.find(a => dentro(a.caixa, x, y))?.mesa;
		const clicavel = f || (mesa && (mesa.time ? this.#opts.aoClicarMesa : this.#opts.aoAdicionarTime));
		this.#canvas.style.cursor = clicavel ? "pointer" : "";
		this.#canvas.title = f
			? f.chat.atividade
				? `${f.chat.nome} · ${f.chat.atividade}`
				: f.chat.nome
			: mesa && mesa.time
				? `${mesa.time.nome}\n${mesa.time.pasta}`
				: "";
		if (f === this.#hover) return;
		this.#hover = f;
		this.#draw();
	}
}

// The text, cut with an ellipsis to fit max px in the current font.
function caber(ctx: CanvasRenderingContext2D, text: string, max: number): string {
	if (ctx.measureText(text).width <= max) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
		else hi = mid - 1;
	}
	return `${text.slice(0, lo).trimEnd()}…`;
}

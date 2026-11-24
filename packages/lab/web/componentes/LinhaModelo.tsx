// The poço line at the foot of the prompt box (the POC's web/sala/modelo.js and contexto.js), as
// omp's status line: the effort (four pixels warming from grey to orange, a level per click or
// Ctrl+Shift+E; on máximo, on fire), the model's friendly name opening omp's picker (search,
// ↑/↓, Enter, ←/→ effort, Esc), the context the conversation takes (five pixels, orange with the
// percentage from 80%; a click opens tokens, cost, the last compaction and Compactar agora), and
// what the chat does now. All of it is the chat's omp session's: it keeps them on resume.
import type { SessionEntry } from "@oh-my-pi/pi-wire";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, caminhoDoChat } from "../lib/api";
import type { ControlesChat, ModeloOpcao, ResumoChat, UsoChat } from "../tipos";
import { ACESAS, dolares, haQuanto, mil, NIVEIS, nomeAmigavel, proximoEsforco } from "../chat/modelos";

/** From here the gauge warms and says its number: omp's own compaction comes near the limit. */
const AVISO = 0.8;
const PIXELS_CONTEXTO = 5;
const VALIDADE_LISTA_MS = 30_000;
const SEGMENTOS_ANDAMENTO = 5;

export interface Andamento {
	texto: string;
	todo: { feitas: number; total: number } | null;
}

const listas = new Map<string, { em: number; modelos: ModeloOpcao[] }>();

interface Props {
	chatId: string;
	controles: ControlesChat | null;
	/** The chat is idle: compacting now would interrupt nothing. */
	livre: boolean;
	/** The microphone hears you: nothing else starts. */
	travada: boolean;
	andamento: Andamento | null;
	entries: readonly SessionEntry[];
	aoErro(mensagem: string): void;
}

export function LinhaModelo({ chatId, controles, livre, travada, andamento, entries, aoErro }: Props): ReactNode {
	const [local, setLocal] = useState<ControlesChat | null>(null);
	const [painel, setPainel] = useState<"modelo" | "contexto" | null>(null);
	const linhaRef = useRef<HTMLDivElement | null>(null);
	const modeloRef = useRef<HTMLButtonElement | null>(null);
	const contextoRef = useRef<HTMLButtonElement | null>(null);

	// What the server answered is shown until the next state broadcast brings the same.
	useEffect(() => setLocal(null), [controles]);
	useEffect(() => setPainel(null), [chatId]);
	const c = local ?? controles;
	const nivel = c?.esforco ?? "auto";
	const maximo = nivel === "max";
	const proximo = c ? proximoEsforco(nivel, c.esforcos) : null;

	const mudar = useCallback(
		async (caminho: "/esforco" | "/modelo", corpo: Record<string, string>): Promise<void> => {
			try {
				const resumo = await api<ResumoChat>("POST", caminhoDoChat(chatId, caminho), corpo);
				setLocal(resumo.controles);
			} catch (err) {
				aoErro(err instanceof Error ? err.message : String(err));
			}
		},
		[chatId, aoErro],
	);
	const mudarEsforco = useCallback(
		(alvo: string | null) => {
			if (alvo) void mudar("/esforco", { nivel: alvo });
		},
		[mudar],
	);

	// Ctrl+Shift+E in the box: one level up (omp's Shift+Tab would take the keyboard out of the field).
	useEffect(() => {
		const form = linhaRef.current?.closest("form");
		if (!form) return;
		const tecla = (event: KeyboardEvent): void => {
			if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.code !== "KeyE") return;
			event.preventDefault();
			if (!travada) mudarEsforco(proximo);
		};
		form.addEventListener("keydown", tecla);
		return () => form.removeEventListener("keydown", tecla);
	}, [proximo, travada, mudarEsforco]);

	// One panel at a time; a press outside closes it.
	useEffect(() => {
		if (!painel) return;
		const fora = (event: PointerEvent): void => {
			const alvo = event.target as Node;
			const dono = painel === "modelo" ? modeloRef.current : contextoRef.current;
			const aberto = linhaRef.current?.parentElement?.querySelector(".seletor-modelo");
			if (aberto?.contains(alvo) || dono?.contains(alvo)) return;
			setPainel(null);
		};
		document.addEventListener("pointerdown", fora);
		return () => document.removeEventListener("pointerdown", fora);
	}, [painel]);

	if (!c) return null;

	const nomeNivel = NIVEIS[nivel] ?? nivel;
	const acesas = ACESAS[nivel] ?? 0;
	const modelo = c.modelo;
	const nomeModelo = modelo ? nomeAmigavel(modelo.nome, modelo.id) : "Modelo";
	const ctx = c.contexto;
	const fracao = ctx ? Math.min(1, ctx.tokens / ctx.janela) : null;
	const cheio = fracao !== null && fracao >= AVISO;
	const tituloContexto = c.compactando
		? "Compactando a conversa"
		: ctx
			? `Contexto: ${mil(ctx.tokens)} de ${mil(ctx.janela)} tokens (${ctx.pct}%)`
			: "Contexto";
	const fechar = (dono: HTMLButtonElement | null): void => {
		setPainel(null);
		dono?.focus();
	};

	return (
		<>
			{painel === "modelo" && (
				<SeletorModelo
					chatId={chatId}
					controles={c}
					aoEscolher={opcao => {
						fechar(modeloRef.current);
						void mudar("/modelo", { provider: opcao.provider, id: opcao.id });
					}}
					aoEsforco={passo => {
						const ordem = c.esforcos.filter(n => n !== "off");
						const i = ordem.indexOf(nivel);
						mudarEsforco(ordem[Math.min(ordem.length - 1, Math.max(0, (i < 0 ? 0 : i) + passo))] ?? null);
					}}
					aoFechar={() => fechar(modeloRef.current)}
					aoErro={aoErro}
				/>
			)}
			{painel === "contexto" && (
				<PainelContexto
					chatId={chatId}
					controles={c}
					livre={livre}
					entries={entries}
					aoFechar={() => fechar(contextoRef.current)}
					aoErro={aoErro}
				/>
			)}
			<div
				ref={linhaRef}
				className={`linha-modelo${maximo ? " is-maximo" : ""}`}
				data-esforco={nivel === "auto" ? "padrao" : nivel}
			>
				{maximo && <Fogo />}
				<button
					type="button"
					className="esforco__botao"
					aria-keyshortcuts="Control+Shift+E"
					aria-label={`Esforço ${nomeNivel}; subir um nível`}
					title={`Esforço: ${nomeNivel} (Ctrl+Shift+E)`}
					disabled={travada || proximo === null}
					onClick={() => mudarEsforco(proximo)}
				>
					<span className="esforco__pixels" aria-hidden="true">
						{[0, 1, 2, 3].map(k => (
							<i key={k} className={k < acesas ? "is-acesa" : undefined} />
						))}
					</span>
					<span className="esforco__nome">{maximo ? "MÁXIMO" : nomeNivel}</span>
				</button>
				<span className="linha-modelo__sep" aria-hidden="true">
					›
				</span>
				<button
					ref={modeloRef}
					type="button"
					className="modelo__botao"
					aria-haspopup="listbox"
					aria-expanded={painel === "modelo"}
					title={modelo ? `${nomeModelo} (${modelo.provider}/${modelo.id})` : undefined}
					disabled={travada}
					onClick={() => setPainel(painel === "modelo" ? null : "modelo")}
				>
					<span className="modelo__nome">{nomeModelo}</span>
					<span className="modelo__seta" aria-hidden="true">
						▾
					</span>
				</button>
				{(ctx || c.compactando) && (
					<button
						ref={contextoRef}
						type="button"
						className={`contexto__botao${cheio ? " is-cheio" : ""}${c.compactando ? " is-compactando" : ""}`}
						aria-haspopup="dialog"
						aria-expanded={painel === "contexto"}
						aria-label={tituloContexto}
						title={tituloContexto}
						disabled={travada}
						onClick={() => setPainel(painel === "contexto" ? null : "contexto")}
					>
						<span className="contexto__pixels" aria-hidden="true">
							{Array.from({ length: PIXELS_CONTEXTO }, (_, k) => (
								<i
									key={k}
									className={
										fracao !== null && k < Math.ceil(fracao * PIXELS_CONTEXTO) ? "is-acesa" : undefined
									}
								/>
							))}
						</span>
						{(c.compactando || cheio) && (
							<span className="contexto__pct">{c.compactando ? "compactando…" : `${ctx?.pct ?? 0}%`}</span>
						)}
					</button>
				)}
				{andamento && (
					<span className="linha-modelo__andamento" role="status" title={andamento.texto}>
						<span className="linha-modelo__barra" aria-hidden="true">
							{andamento.todo
								? Array.from({ length: andamento.todo.total }, (_, k) => (
										<i key={k} className={k < (andamento.todo?.feitas ?? 0) ? "is-acesa" : undefined} />
									))
								: Array.from({ length: SEGMENTOS_ANDAMENTO }, (_, k) => <i key={k} className="is-correndo" />)}
						</span>
						<span className="linha-modelo__uso">
							{andamento.texto}
							{andamento.todo && ` · ${andamento.todo.feitas} de ${andamento.todo.total}`}
						</span>
					</span>
				)}
			</div>
		</>
	);
}

// ── The picker: omp's Alt+P list ────────────────────────────────────────────────────────────

interface PropsSeletor {
	chatId: string;
	controles: ControlesChat;
	aoEscolher(opcao: ModeloOpcao): void;
	aoEsforco(passo: -1 | 1): void;
	aoFechar(): void;
	aoErro(mensagem: string): void;
}

function SeletorModelo({ chatId, controles, aoEscolher, aoEsforco, aoFechar, aoErro }: PropsSeletor): ReactNode {
	const [modelos, setModelos] = useState<ModeloOpcao[] | null>(() => listas.get(chatId)?.modelos ?? null);
	const [busca, setBusca] = useState("");
	const [marcado, setMarcado] = useState(-1);
	const listaRef = useRef<HTMLUListElement | null>(null);

	useEffect(() => {
		const guardada = listas.get(chatId);
		if (guardada && Date.now() - guardada.em < VALIDADE_LISTA_MS) return;
		let vivo = true;
		api<{ modelos: ModeloOpcao[] }>("GET", caminhoDoChat(chatId, "/modelos")).then(
			({ modelos: lista }) => {
				listas.set(chatId, { em: Date.now(), modelos: lista });
				if (vivo) setModelos(lista);
			},
			(err: unknown) => {
				if (!vivo) return;
				setModelos(antes => antes ?? []);
				aoErro(err instanceof Error ? err.message : String(err));
			},
		);
		return () => {
			vivo = false;
		};
	}, [chatId, aoErro]);

	const atual = controles.modelo;
	const linhas = useMemo(() => {
		const termo = busca.trim().toLowerCase();
		const todas = modelos ?? [];
		return termo
			? todas.filter(m => `${nomeAmigavel(m.nome, m.id)} ${m.provider}/${m.id}`.toLowerCase().includes(termo))
			: todas;
	}, [modelos, busca]);
	const ehAtual = (m: ModeloOpcao): boolean => m.provider === atual?.provider && m.id === atual.id;
	// Opening marks the running model; typing a search goes back to the top.
	const indice = marcado >= 0 ? Math.min(marcado, linhas.length - 1) : Math.max(0, linhas.findIndex(ehAtual));
	const escolhida = linhas[indice];

	useEffect(() => {
		listaRef.current?.querySelector(`#seletor-modelo-${indice}`)?.scrollIntoView({ block: "nearest" });
	}, [indice]);

	const nivel = controles.esforco ?? "auto";
	const detalhe = escolhida
		? [
				`${escolhida.provider}/${escolhida.id}`,
				escolhida.contexto ? `${mil(escolhida.contexto)} de contexto` : null,
				escolhida.esforcos.length > 0
					? `esforço: ${escolhida.esforcos
							.filter(n => n !== "off" && n !== "auto")
							.map(n => NIVEIS[n] ?? n)
							.join(", ")}`
					: null,
			]
				.filter(Boolean)
				.join(" · ")
		: "";

	return (
		<div className="seletor-modelo painel">
			<p className="seletor-modelo__titulo">Modelo</p>
			<p className="seletor-modelo__sub">esforço {NIVEIS[nivel] ?? nivel}</p>
			<label className="seletor-modelo__busca">
				<span aria-hidden="true">›</span>
				<input
					type="text"
					placeholder="buscar modelo"
					spellCheck={false}
					autoComplete="off"
					aria-label="Buscar modelo"
					role="combobox"
					aria-expanded="true"
					aria-controls="seletor-modelo-lista"
					aria-activedescendant={escolhida ? `seletor-modelo-${indice}` : undefined}
					autoFocus
					value={busca}
					onChange={e => {
						setBusca(e.target.value);
						setMarcado(0);
					}}
					onKeyDown={e => {
						if (e.key === "ArrowDown" || e.key === "ArrowUp") {
							e.preventDefault();
							if (linhas.length === 0) return;
							setMarcado((indice + (e.key === "ArrowDown" ? 1 : -1) + linhas.length) % linhas.length);
						} else if (e.key === "Enter") {
							e.preventDefault();
							e.stopPropagation();
							if (escolhida) aoEscolher(escolhida);
						} else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !busca) {
							// As omp's picker: ←/→ change the effort while not typing a search.
							e.preventDefault();
							aoEsforco(e.key === "ArrowRight" ? 1 : -1);
						} else if (e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							aoFechar();
						}
					}}
				/>
			</label>
			<ul
				className="seletor-modelo__lista"
				id="seletor-modelo-lista"
				role="listbox"
				aria-label="Modelos"
				ref={listaRef}
			>
				{linhas.map((m, k) => (
					<li
						key={`${m.provider}/${m.id}`}
						id={`seletor-modelo-${k}`}
						className="seletor-modelo__item"
						role="option"
						aria-selected={k === indice}
						onPointerMove={() => {
							if (k !== indice) setMarcado(k);
						}}
						onClick={() => aoEscolher(m)}
					>
						<span className="seletor-modelo__nome">
							{nomeAmigavel(m.nome, m.id)}
							{ehAtual(m) && <span className="seletor-modelo__atual"> ●</span>}
						</span>
						<span className="seletor-modelo__id">{m.provider}</span>
						<span className="seletor-modelo__ctx">{m.contexto ? mil(m.contexto) : ""}</span>
					</li>
				))}
				{linhas.length === 0 && (
					<li className="seletor-modelo__vazio">
						{modelos ? "Nenhum modelo com esse nome." : "Carregando modelos…"}
					</li>
				)}
			</ul>
			<p className="seletor-modelo__detalhe">{detalhe}</p>
		</div>
	);
}

// ── Context and Compactar (omp's status-line meter and its /compact) ────────────────────────

interface PropsContexto {
	chatId: string;
	controles: ControlesChat;
	livre: boolean;
	entries: readonly SessionEntry[];
	aoFechar(): void;
	aoErro(mensagem: string): void;
}

function PainelContexto({ chatId, controles, livre, entries, aoFechar, aoErro }: PropsContexto): ReactNode {
	const [uso, setUso] = useState<UsoChat | null>(null);
	const [manter, setManter] = useState("");
	const [enviando, setEnviando] = useState(false);
	const campoRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		let vivo = true;
		api<UsoChat>("GET", caminhoDoChat(chatId, "/uso")).then(
			valor => {
				if (vivo) setUso(valor);
			},
			() => {},
		);
		return () => {
			vivo = false;
		};
	}, [chatId, controles.contexto?.tokens]);
	useEffect(() => campoRef.current?.focus(), []);

	const ultima = entries.findLast(entry => entry.type === "compaction");
	const ctx = controles.contexto;
	const compactando = controles.compactando || enviando;
	const linhas = [
		ctx ? `${mil(ctx.tokens)} de ${mil(ctx.janela)} tokens · ${ctx.pct}%` : null,
		uso ? `Sessão: ${dolares(uso.custo)}${uso.tokens > 0 ? ` · ${mil(uso.tokens)} tokens` : ""}` : null,
		ultima?.type === "compaction"
			? `Compactada ${haQuanto(Date.parse(ultima.timestamp))}${ultima.tokensBefore > 0 ? ` · de ${mil(ultima.tokensBefore)} tokens` : ""}`
			: null,
	].filter((linha): linha is string => linha !== null);
	const motivo = compactando ? null : livre ? null : "O chat está trabalhando.";
	const pode = livre && !compactando;

	const compactar = async (): Promise<void> => {
		if (!pode) return;
		setEnviando(true);
		try {
			await api("POST", caminhoDoChat(chatId, "/compactar"), manter.trim() ? { instrucoes: manter.trim() } : {});
			setManter("");
		} catch (err) {
			aoErro(err instanceof Error ? err.message : String(err));
		} finally {
			setEnviando(false);
		}
	};

	return (
		<div
			className="seletor-modelo painel contexto-painel"
			role="dialog"
			aria-label="Contexto do chat"
			onKeyDown={e => {
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					aoFechar();
				} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					e.stopPropagation();
					void compactar();
				} else if (e.key === "Enter") e.stopPropagation();
			}}
		>
			<p className="seletor-modelo__titulo">Contexto</p>
			<ul className="contexto-painel__linhas">
				{linhas.map(linha => (
					<li key={linha}>{linha}</li>
				))}
			</ul>
			<label className="contexto-painel__manter">
				<span>O que manter</span>
				<textarea
					ref={campoRef}
					rows={2}
					maxLength={2000}
					placeholder="opcional"
					value={manter}
					onChange={e => setManter(e.target.value)}
				/>
			</label>
			<div className="contexto-painel__acoes">
				<button
					type="button"
					className="contexto-painel__compactar"
					disabled={!pode}
					onClick={() => void compactar()}
				>
					{compactando ? "Compactando…" : "Compactar agora"}
				</button>
				{motivo && (
					<span className="contexto-painel__motivo" role="status">
						{motivo}
					</span>
				)}
			</div>
		</div>
	);
}

// ── Máximo: pixel fire along the line's edge (the classic "doom fire"), orange and yellow.
// A still frame with reduced motion. ────────────────────────────────────────────────────────

const CORES_FOGO = [null, "#7a1e00", "#c23d00", "#ff5100", "#ff7a00", "#ffa300", "#ffc400", "#ffe14d"];
const LARGURA_FOGO = 96;
const ALTURA_FOGO = 10;

function Fogo(): ReactNode {
	const ref = useRef<HTMLCanvasElement | null>(null);
	useEffect(() => {
		const g = ref.current?.getContext("2d");
		if (!g) return;
		const W = LARGURA_FOGO;
		const H = ALTURA_FOGO;
		const calor = new Uint8Array(W * H);
		const passo = (): void => {
			for (let x = 0; x < W; x++) calor[(H - 1) * W + x] = CORES_FOGO.length - 1;
			for (let y = 0; y < H - 1; y++) {
				for (let x = 0; x < W; x++) {
					const de = (y + 1) * W + x;
					const r = Math.trunc(Math.random() * 3);
					const alvo = y * W + Math.min(W - 1, Math.max(0, x - r + 1));
					calor[alvo] = Math.max(0, calor[de]! - (r & 1) - (Math.random() < 0.35 ? 1 : 0));
				}
			}
			g.clearRect(0, 0, W, H);
			for (let y = 0; y < H; y++) {
				for (let x = 0; x < W; x++) {
					const cor = CORES_FOGO[calor[y * W + x]!];
					if (!cor) continue;
					g.fillStyle = cor;
					g.fillRect(x, y, 1, 1);
				}
			}
		};
		for (let k = 0; k < H; k++) passo();
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const timer = setInterval(passo, 80);
		return () => clearInterval(timer);
	}, []);
	return (
		<canvas ref={ref} className="linha-modelo__fogo" width={LARGURA_FOGO} height={ALTURA_FOGO} aria-hidden="true" />
	);
}

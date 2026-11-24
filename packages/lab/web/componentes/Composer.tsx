// The prompt box, the POC's (after Are.na's prompt box, DESIGN.md 20/11/2026): one box with the
// text on top; inside it, the audios still transcribing (dashed pills) above the text, and the
// files picked and the recording bar under it; then the tool row (clip and quadro on the left,
// quiet; Parar, the microphone and Enviar, the orange 32 px square, on the right); and across the
// foot, in a poço under a thread, the model line (LinhaModelo). Enter sends, Shift+Enter breaks
// the line, ↑ in an empty box brings back what you sent. Files come by the clip, pasting or
// dropping them on the chat; the quadro's drawing comes as a PNG. The microphone records here and
// the lab transcribes on its machine: the words land in the box.
import { shouldSubmitOnEnter } from "@oh-my-pi/collab-web/src/components/shell/Composer";
import type { SessionEntry } from "@oh-my-pi/pi-wire";
import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../lib/api";
import type { AnexoEnviado, EstadoTranscricao, ResumoChat } from "../tipos";
import { caixaDoChat, estadoTranscricao, type ItemAnexo } from "../chat/caixa";
import { Gravador, MAX_S, podeGravar } from "../chat/ditado";
import { ICONE, Pixel } from "../chat/icones";
import { tamanhoLegivel } from "../chat/modelos";
import { abrirQuadro } from "../chat/quadro";
import { type Andamento, LinhaModelo } from "./LinhaModelo";

const LINHA_PX = 20;
/** 160 px of text, then it scrolls inside. */
const MAX_LINHAS = 7;
/** Pressed longer than this: push to talk, it stops on release. */
const SEGURAR_MS = 400;
/** Held and slid this far left: the recording is dropped. */
const DESLIZAR = 80;
const SEGMENTOS = 12;

interface Props {
	chat: ResumoChat;
	trabalhando: boolean;
	andamento: Andamento | null;
	entries: readonly SessionEntry[];
	/** Resolves false when the message did not go: the box gets it back. */
	aoEnviar(texto: string, anexos: AnexoEnviado[]): Promise<boolean>;
	aoParar(): void;
	aoErro(mensagem: string): void;
}

const relogio = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Composer({ chat, trabalhando, andamento, entries, aoEnviar, aoParar, aoErro }: Props): ReactNode {
	const caixa = caixaDoChat(chat.id);
	useSyncExternalStore(caixa.subscribe, caixa.getSnapshot);
	const campoRef = useRef<HTMLTextAreaElement | null>(null);
	const formRef = useRef<HTMLFormElement | null>(null);
	const arquivoRef = useRef<HTMLInputElement | null>(null);
	const compondoRef = useRef(false);
	const [enviando, setEnviando] = useState(false);

	// ── The microphone ───────────────────────────────────────────────────────────────────────
	const [fase, setFase] = useState<"ocioso" | "pedindo" | "gravando">("ocioso");
	const [mic, setMic] = useState<EstadoTranscricao | null>(null);
	const [segurando, setSegurando] = useState(false);
	const gravadorRef = useRef<Gravador | null>(null);
	const segurarRef = useRef<{ desde: number; x: number | null; timer: number } | null>(null);
	const barraRef = useRef<HTMLDivElement | null>(null);
	const relogioRef = useRef<HTMLSpanElement | null>(null);
	gravadorRef.current ??= new Gravador(
		() => setFase(gravadorRef.current?.fase ?? "ocioso"),
		audio => {
			void caixa.transcrever(audio).then(erro => {
				if (erro) aoErro(erro);
				else campoRef.current?.focus();
			});
		},
		aoErro,
	);
	const gravador = gravadorRef.current;
	const ouvindo = fase !== "ocioso";

	useEffect(() => {
		if (podeGravar()) void estadoTranscricao().then(setMic);
		return () => gravador.cancelar();
	}, [gravador]);

	// While it records: the clock and the level, straight on the DOM once per frame.
	useEffect(() => {
		if (fase !== "gravando") return;
		let quadro = 0;
		const medir = (): void => {
			quadro = requestAnimationFrame(medir);
			const s = (performance.now() - gravador.inicio) / 1000;
			const tempo = relogio(s);
			if (relogioRef.current && relogioRef.current.textContent !== tempo) relogioRef.current.textContent = tempo;
			if (s >= MAX_S) gravador.parar();
			const acesos = Math.round(gravador.nivel() * SEGMENTOS);
			barraRef.current?.querySelectorAll(".chat__nivel span").forEach((el, i) => {
				el.classList.toggle("is-aceso", i < acesos);
			});
		};
		medir();
		return () => cancelAnimationFrame(quadro);
	}, [fase, gravador]);

	const comecar = useCallback((): void => {
		void api("POST", "/api/transcricao/aquecer").catch(() => {}); // the model loads while you speak
		void gravador.comecar();
	}, [gravador]);

	const largarSegurar = (): void => {
		const s = segurarRef.current;
		if (s) clearTimeout(s.timer);
		segurarRef.current = null;
		setSegurando(false);
		barraRef.current?.style.removeProperty("--deslize");
	};
	// A quick press toggles; a long one is push to talk, stopped on release.
	const apertar = (x: number | null): void => {
		if (gravador.fase !== "ocioso") {
			gravador.parar();
			return;
		}
		const desde = performance.now();
		segurarRef.current = {
			desde,
			x,
			timer: window.setTimeout(() => {
				if (segurarRef.current?.desde === desde && x !== null) setSegurando(true);
			}, SEGURAR_MS),
		};
		comecar();
	};
	const soltar = (): void => {
		const s = segurarRef.current;
		if (!s) return;
		largarSegurar();
		if (performance.now() - s.desde >= SEGURAR_MS) gravador.parar();
	};

	// Esc drops the recording; Enter (alone) stops it and the words come to the box; Ctrl+M held records.
	useEffect(() => {
		const tecla = (event: KeyboardEvent): void => {
			const form = formRef.current;
			if (gravador.fase !== "ocioso") {
				if (event.key === "Escape") {
					event.stopPropagation();
					gravador.cancelar();
					return;
				}
				const alvo = event.target as Element | null;
				const sozinho = !event.shiftKey && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey;
				if (event.key === "Enter" && sozinho && (form?.contains(alvo) || alvo === document.body)) {
					if (alvo?.closest(".chat__gravando button")) return;
					event.preventDefault();
					event.stopPropagation();
					gravador.parar();
					return;
				}
			}
			if (!event.ctrlKey || event.key.toLowerCase() !== "m" || event.shiftKey || event.metaKey || event.altKey) return;
			if (!form?.isConnected || mic?.disponivel !== true) return;
			event.preventDefault();
			if (!event.repeat) apertar(null);
		};
		const solta = (event: KeyboardEvent): void => {
			if (segurarRef.current && (event.key.toLowerCase() === "m" || event.key === "Control")) soltar();
		};
		addEventListener("keydown", tecla, true);
		addEventListener("keyup", solta);
		return () => {
			removeEventListener("keydown", tecla, true);
			removeEventListener("keyup", solta);
		};
	});

	// ── The field ────────────────────────────────────────────────────────────────────────────
	useLayoutEffect(() => {
		const campo = campoRef.current;
		if (!campo) return;
		campo.style.height = "0px";
		const max = MAX_LINHAS * LINHA_PX + 17;
		campo.style.height = `${Math.min(campo.scrollHeight, max)}px`;
		campo.style.overflowY = campo.scrollHeight > max ? "auto" : "hidden";
	}, [caixa.texto]);

	const adicionar = useCallback(
		(arquivos: readonly File[]): boolean => {
			if (gravadorRef.current?.fase !== "ocioso" || arquivos.length === 0) return false;
			const antes = caixa.anexos.length;
			const erro = caixa.adicionar(arquivos);
			if (erro) aoErro(erro);
			return caixa.anexos.length > antes;
		},
		[caixa, aoErro],
	);

	// Files dropped anywhere on the chat.
	useEffect(() => {
		const zona = formRef.current?.closest<HTMLElement>(".chat");
		if (!zona) return;
		let dentro = 0;
		const temArquivos = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes("Files");
		const entrar = (event: DragEvent): void => {
			if (!temArquivos(event)) return;
			event.preventDefault();
			dentro++;
			zona.classList.add("is-soltando");
		};
		const sobre = (event: DragEvent): void => {
			if (!temArquivos(event) || !event.dataTransfer) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		};
		const sair = (): void => {
			if (--dentro > 0) return;
			dentro = 0;
			zona.classList.remove("is-soltando");
		};
		const soltarArquivos = (event: DragEvent): void => {
			dentro = 0;
			zona.classList.remove("is-soltando");
			if (!temArquivos(event) || !event.dataTransfer) return;
			event.preventDefault();
			adicionar([...event.dataTransfer.files]);
			campoRef.current?.focus();
		};
		zona.addEventListener("dragenter", entrar);
		zona.addEventListener("dragover", sobre);
		zona.addEventListener("dragleave", sair);
		zona.addEventListener("drop", soltarArquivos);
		return () => {
			zona.removeEventListener("dragenter", entrar);
			zona.removeEventListener("dragover", sobre);
			zona.removeEventListener("dragleave", sair);
			zona.removeEventListener("drop", soltarArquivos);
			zona.classList.remove("is-soltando");
		};
	}, [adicionar]);

	const temAlgo = caixa.texto.trim() !== "" || caixa.anexos.length > 0;

	const enviar = async (): Promise<void> => {
		if (ouvindo) {
			gravador.parar();
			return;
		}
		const texto = caixa.texto.trim();
		if (!temAlgo || enviando) return;
		const itens = caixa.anexos;
		let anexos: AnexoEnviado[];
		setEnviando(true);
		try {
			anexos = await caixa.prontos();
		} catch (err) {
			aoErro(err instanceof Error ? err.message : String(err));
			setEnviando(false);
			return;
		}
		setEnviando(false);
		caixa.enviada(texto, itens);
		if (!(await aoEnviar(texto, anexos))) caixa.devolver(texto, itens);
	};

	const disponivel = mic?.disponivel === true;

	return (
		<form
			ref={formRef}
			className={`caixa${ouvindo ? " is-ouvindo" : ""}`}
			onSubmit={e => {
				e.preventDefault();
				void enviar();
			}}
		>
			<div className="entrada">
				{caixa.audios.length > 0 && (
					<div className="entrada__audios" aria-live="polite">
						{caixa.audios.map(audio => (
							<span key={audio.chave} className="entrada__audio">
								<Pixel d={ICONE.mic} />
								<span>transcrevendo…</span>
								<button
									type="button"
									className="entrada__audio-tirar"
									aria-label="Descartar o áudio"
									title="Descartar"
									onClick={() => caixa.descartarAudio(audio)}
								>
									×
								</button>
							</span>
						))}
					</div>
				)}
				<textarea
					ref={campoRef}
					className="entrada__campo"
					rows={1}
					placeholder={ouvindo ? "Ouvindo…" : "Mensagem"}
					aria-label="Mensagem"
					enterKeyHint="send"
					value={caixa.texto}
					readOnly={ouvindo}
					onChange={e => caixa.escrever(e.target.value)}
					onCompositionStart={() => {
						compondoRef.current = true;
					}}
					onCompositionEnd={() => {
						setTimeout(() => {
							compondoRef.current = false;
						}, 0);
					}}
					onPaste={e => {
						// Files on the clipboard (a screenshot, a copied image) become attachments.
						const arquivos = [...e.clipboardData.files];
						if (arquivos.length === 0) return;
						if (!e.clipboardData.getData("text/plain")) e.preventDefault();
						adicionar(arquivos);
					}}
					onKeyDown={e => {
						if (ouvindo) return;
						if (shouldSubmitOnEnter(e, compondoRef.current)) {
							e.preventDefault();
							void enviar();
							return;
						}
						const campo = e.currentTarget;
						const semMod = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
						const navegando = caixa.navegando !== null;
						if (e.key === "ArrowUp" && semMod && (caixa.texto === "" || navegando) && campo.selectionStart === 0) {
							if (caixa.andarNoHistorico(-1)) e.preventDefault();
						} else if (e.key === "ArrowDown" && semMod && navegando && campo.selectionEnd === campo.value.length) {
							if (caixa.andarNoHistorico(1)) e.preventDefault();
						}
					}}
				/>
				{caixa.anexos.length > 0 && <Bandeja itens={caixa.anexos} aoTirar={item => caixa.tirar(item)} />}
				{ouvindo && (
					<div
						ref={barraRef}
						className={`chat__gravando${segurando ? " is-segurando" : ""}`}
						data-estado={fase}
					>
						<span className="chat__gravando-ponto" aria-hidden="true" />
						<span ref={relogioRef} className="chat__gravando-texto" aria-hidden="true">
							{fase === "pedindo" ? "Pedindo o microfone…" : "0:00"}
						</span>
						<span className="visualmente-oculto" role="status">
							{fase === "pedindo" ? "Pedindo o microfone" : "Gravando"}
						</span>
						<span className="chat__nivel" aria-hidden="true">
							{Array.from({ length: SEGMENTOS }, (_, i) => (
								<span key={i} />
							))}
						</span>
						<span className="chat__deslizar" aria-hidden="true">
							‹ deslize para cancelar
						</span>
						<button type="button" className="botao botao--claro" onClick={() => gravador.cancelar()}>
							Cancelar
						</button>
						<button type="button" className="botao botao--claro" onClick={() => gravador.parar()}>
							Revisar
						</button>
					</div>
				)}
				<div className="entrada__acoes">
					<span className="entrada__ferramentas">
						<button
							type="button"
							className="ferramenta"
							aria-label="Anexar arquivo"
							title={`Anexar arquivo (até ${tamanhoLegivel(25 * 1024 * 1024)})`}
							disabled={ouvindo}
							onClick={() => arquivoRef.current?.click()}
						>
							<Pixel d={ICONE.clipe} />
						</button>
						<button
							type="button"
							className="ferramenta"
							aria-label="Quadro"
							title="Quadro"
							disabled={ouvindo}
							onClick={() =>
								abrirQuadro(arquivo => {
									const ok = adicionar([arquivo]);
									if (ok) campoRef.current?.focus();
									return ok;
								})
							}
						>
							<Pixel d={ICONE.quadro} />
						</button>
						<input
							ref={arquivoRef}
							type="file"
							multiple
							hidden
							onChange={e => {
								adicionar([...(e.currentTarget.files ?? [])]);
								e.currentTarget.value = "";
								campoRef.current?.focus();
							}}
						/>
					</span>
					<span className="entrada__envio">
						{trabalhando && (
							<button
								type="button"
								className="botao botao--claro entrada__parar"
								disabled={ouvindo}
								onClick={aoParar}
							>
								Parar
							</button>
						)}
						{mic && (
							<button
								type="button"
								className={`ferramenta entrada__mic${fase === "gravando" ? " is-gravando" : ""}`}
								aria-label="Gravar áudio"
								aria-pressed={ouvindo}
								aria-keyshortcuts="Control+M"
								title={disponivel ? "Gravar (Ctrl+M)" : mic.motivo}
								disabled={!disponivel}
								onPointerDown={e => {
									if (e.button !== 0) return;
									e.preventDefault(); // the field keeps the focus
									e.currentTarget.setPointerCapture(e.pointerId);
									apertar(e.clientX);
								}}
								onPointerMove={e => {
									const s = segurarRef.current;
									if (!s || s.x === null) return;
									const dx = Math.max(0, s.x - e.clientX);
									barraRef.current?.style.setProperty("--deslize", `${Math.min(dx, DESLIZAR)}px`);
									if (dx < DESLIZAR) return;
									largarSegurar();
									gravador.cancelar();
								}}
								onPointerUp={soltar}
								onPointerCancel={soltar}
								onClick={e => {
									// From the keyboard (Enter, Space on the button): a toggle.
									if (e.detail !== 0) return;
									if (gravador.fase === "ocioso") comecar();
									else gravador.parar();
								}}
							>
								<Pixel d={ICONE.mic} />
							</button>
						)}
						<button
							type="submit"
							className="botao entrada__enviar"
							aria-label="Enviar"
							title="Enviar (Enter)"
							disabled={!ouvindo && (!temAlgo || enviando)}
						>
							<Pixel d={ICONE.enviar} />
						</button>
					</span>
				</div>
				<LinhaModelo
					chatId={chat.id}
					controles={chat.controles}
					livre={!trabalhando && chat.status !== "esperando"}
					travada={ouvindo}
					andamento={andamento}
					entries={entries}
					aoErro={aoErro}
				/>
			</div>
		</form>
	);
}

/** The files picked, inside the box between the text and the tools: a chip each. */
function Bandeja({ itens, aoTirar }: { itens: readonly ItemAnexo[]; aoTirar(item: ItemAnexo): void }): ReactNode {
	return (
		<ul className="entrada__anexos" aria-label="Arquivos para enviar">
			{itens.map(item => (
				<li key={item.chave} className={`entrada__anexo is-${item.estado}`}>
					<span className="entrada__anexo-ver" aria-hidden="true">
						{item.local ? <img src={item.local} alt="" /> : <Pixel d={ICONE.pagina} />}
					</span>
					<span className="entrada__anexo-nome" title={item.arquivo.name}>
						{item.arquivo.name}
					</span>
					<span className="entrada__anexo-info" title={item.erro ?? undefined}>
						{item.estado === "enviando"
							? "enviando…"
							: item.estado === "erro"
								? `✕ ${item.erro}`
								: tamanhoLegivel(item.arquivo.size)}
					</span>
					<button
						type="button"
						className="entrada__anexo-tirar"
						aria-label={`Tirar ${item.arquivo.name}`}
						onClick={() => aoTirar(item)}
					>
						×
					</button>
				</li>
			))}
		</ul>
	);
}

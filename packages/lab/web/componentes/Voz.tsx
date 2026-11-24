// The call panel, like omp's: a status square and its word, the mic level bar, the caption, and
// Mudo [espaço] / Encerrar [esc]. In the chat column on a desktop, full screen on a phone.
import { Mic, MicOff, PhoneOff } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLab } from "../lib/contexto";
import { Chamada, type FaseVoz } from "../lib/voz";
import type { ResumoChat } from "../tipos";
import { Rosto } from "./Rosto";

const PALAVRA: Record<FaseVoz, string> = {
	conectando: "conectando",
	ouvindo: "ouvindo",
	trabalhando: "trabalhando",
	falando: "falando",
	mudo: "mudo",
	caiu: "caiu",
	erro: "sem voz",
};

export function Voz({ chat, aoFechar }: { chat: ResumoChat; aoFechar(): void }): ReactNode {
	const { conexao } = useLab();
	const chamada = useMemo(() => new Chamada(chat.id, conexao), [chat.id, conexao]);
	const foto = useSyncExternalStore(chamada.subscribe, chamada.getSnapshot);
	const ativa = foto.fase !== "caiu" && foto.fase !== "erro";

	useEffect(() => {
		void chamada.iniciar();
		return () => chamada.encerrar();
	}, [chamada]);

	useEffect(() => {
		const tecla = (e: KeyboardEvent): void => {
			const alvo = e.target;
			if (alvo instanceof HTMLElement && alvo.closest("input, textarea, select, [contenteditable]")) return;
			if (e.key === "Escape") {
				e.preventDefault();
				chamada.encerrar();
				aoFechar();
			} else if (e.key === " " && ativa) {
				e.preventDefault();
				chamada.alternarMudo();
			}
		};
		addEventListener("keydown", tecla);
		return () => removeEventListener("keydown", tecla);
	}, [chamada, aoFechar, ativa]);

	const encerrar = (): void => {
		chamada.encerrar();
		aoFechar();
	};

	return (
		<section className="voz" data-fase={foto.fase} aria-label={`Chamada com ${chat.nome}`}>
			<p className="voz__nome">{chat.nome}</p>
			<p className="voz__estado" role="status">
				<span className="voz__ponto" aria-hidden="true" />
				{PALAVRA[foto.fase]}
			</p>
			<div className="voz__palco">
				<Rosto semente={chat.id} papel={chat.papel} agente tamanho="g" />
				{ativa && (
					<div
						className="voz__nivel"
						role="meter"
						aria-label="Microfone"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(foto.nivel * 100)}
					>
						<span style={{ "--nivel": foto.nivel }} />
					</div>
				)}
			</div>
			{ativa ? (
				<p className="voz__legenda" aria-live="polite">
					{foto.legenda && (
						<>
							<span className="voz__quem">{foto.legenda.quem === "voce" ? "Você" : chat.nome}</span>
							<span className="voz__frase">{foto.legenda.texto}</span>
						</>
					)}
				</p>
			) : (
				<p className="voz__erro" role="alert">
					{foto.fase === "caiu" ? "A chamada caiu" : foto.erro}
					{foto.fase === "caiu" && foto.erro && foto.erro !== "A chamada caiu" && (
						<span className="voz__motivo">{foto.erro}</span>
					)}
				</p>
			)}
			<div className="voz__controles">
				{ativa ? (
					<>
						<button
							type="button"
							className="voz__botao voz__botao--mic"
							aria-pressed={!foto.mudo}
							aria-label={foto.mudo ? "Ligar microfone" : "Mudo"}
							title={foto.mudo ? "Ligar microfone [espaço]" : "Mudo [espaço]"}
							onClick={() => chamada.alternarMudo()}
						>
							{foto.mudo ? <MicOff /> : <Mic />}
						</button>
						<button
							type="button"
							className="voz__botao voz__botao--fim"
							aria-label="Encerrar"
							title="Encerrar [esc]"
							onClick={encerrar}
						>
							<PhoneOff />
						</button>
					</>
				) : (
					<>
						<button type="button" className="botao" onClick={() => void chamada.iniciar()}>
							Ligar de novo
						</button>
						<button type="button" className="botao botao--claro" onClick={encerrar}>
							Fechar
						</button>
					</>
				)}
			</div>
			{ativa && (
				<p className="voz__teclas" aria-hidden="true">
					<span>
						<kbd>espaço</kbd> mudo
					</span>
					<span>
						<kbd>esc</kbd> encerrar
					</span>
				</p>
			)}
		</section>
	);
}

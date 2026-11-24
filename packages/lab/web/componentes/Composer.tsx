// The prompt box, the POC's (after Are.na's): one box with the text on top and the tool row
// under it; Parar while the agent works, Enviar the orange 32 px square in the corner.
import { shouldSubmitOnEnter } from "@oh-my-pi/collab-web/src/components/shell/Composer";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

const LINHA_PX = 20;
const MAX_LINHAS = 8;

interface Props {
	trabalhando: boolean;
	desativado?: boolean;
	aoEnviar(texto: string): void;
	aoParar(): void;
}

export function Composer({ trabalhando, desativado = false, aoEnviar, aoParar }: Props): ReactNode {
	const [texto, setTexto] = useState("");
	const campoRef = useRef<HTMLTextAreaElement | null>(null);
	const compondoRef = useRef(false);

	useLayoutEffect(() => {
		const campo = campoRef.current;
		if (!campo) return;
		campo.style.height = "0px";
		const max = MAX_LINHAS * LINHA_PX + 17;
		campo.style.height = `${Math.min(campo.scrollHeight, max)}px`;
		campo.style.overflowY = campo.scrollHeight > max ? "auto" : "hidden";
	}, [texto]);

	const enviar = (): void => {
		const limpo = texto.trim();
		if (!limpo || desativado) return;
		aoEnviar(limpo);
		setTexto("");
	};

	return (
		<form
			className="entrada"
			onSubmit={e => {
				e.preventDefault();
				enviar();
			}}
		>
			<textarea
				ref={campoRef}
				className="entrada__campo"
				rows={1}
				placeholder="Mensagem"
				aria-label="Mensagem"
				enterKeyHint="send"
				value={texto}
				disabled={desativado}
				onChange={e => setTexto(e.target.value)}
				onCompositionStart={() => {
					compondoRef.current = true;
				}}
				onCompositionEnd={() => {
					setTimeout(() => {
						compondoRef.current = false;
					}, 0);
				}}
				onKeyDown={e => {
					if (shouldSubmitOnEnter(e, compondoRef.current)) {
						e.preventDefault();
						enviar();
					}
				}}
			/>
			<div className="entrada__acoes">
				<span />
				<span className="entrada__envio">
					{trabalhando && (
						<button type="button" className="botao botao--claro entrada__parar" onClick={aoParar}>
							Parar
						</button>
					)}
					<button
						type="submit"
						className="botao entrada__enviar"
						aria-label="Enviar"
						title="Enviar (Enter)"
						disabled={desativado}
					>
						<svg viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
							<path
								fill="currentColor"
								d="M0 0h1v1h-1zM0 1h3v1h-3zM0 2h5v1h-5zM0 3h7v1h-7zM2 4h7v1h-7zM0 5h7v1h-7zM0 6h5v1h-5zM0 7h3v1h-3zM0 8h1v1h-1z"
							/>
						</svg>
					</button>
				</span>
			</div>
		</form>
	);
}

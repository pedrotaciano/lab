// The Sala tab: the view from the registry (visoes.ts; the one kept in this browser, else the
// first) on a canvas, shown the Estado on every change. A figure opens its chat; the empty
// table, the folder picker.
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useLab } from "../lib/contexto";
import type { Estado } from "../tipos";
import { type VisaoNaTela, visaoGuardada } from "../visoes";

export function Sala({ estado }: { estado: Estado }): ReactNode {
	const { abrirChat, adicionarTime } = useLab();
	const visao = useMemo(visaoGuardada, []);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const telaRef = useRef<VisaoNaTela | null>(null);
	const acoes = useRef({ abrirChat, adicionarTime });
	acoes.current = { abrirChat, adicionarTime };

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const tela = visao.criar(canvas, {
			aoClicar: chatId => acoes.current.abrirChat(chatId),
			aoAdicionarTime: () => acoes.current.adicionarTime(),
		});
		telaRef.current = tela;
		return () => {
			tela.destruir();
			telaRef.current = null;
		};
	}, [visao]);

	useEffect(() => {
		telaRef.current?.mostrar(estado);
	}, [estado]);

	return (
		<div className="sala">
			<canvas ref={canvasRef} className="sala__cena" aria-label={visao.nome} />
		</div>
	);
}

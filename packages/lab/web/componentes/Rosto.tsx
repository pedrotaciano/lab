// A face in its frame (the POC's .moldura): a person's own photo (Tailscale's profile picture, an
// https address) or the pixel face the room draws for that seed (a chat id, a login).
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { desenharRosto } from "../sala";

interface Props {
	semente: string;
	papel?: string | null;
	foto?: string | null;
	/** An agent's face: the frame goes orange (the POC's `little`). */
	agente?: boolean;
	tamanho?: "p" | "m" | "g";
	titulo?: string;
}

export function Rosto({ semente, papel = null, foto = null, agente = false, tamanho = "m", titulo }: Props): ReactNode {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const usarFoto = typeof foto === "string" && foto.startsWith("https://");

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || usarFoto) return;
		void desenharRosto(canvas, semente, papel);
	}, [semente, papel, usarFoto]);

	return (
		<span
			className={`moldura rosto rosto--${tamanho}${agente ? " is-agente" : ""}`}
			title={titulo}
			aria-hidden="true"
		>
			{usarFoto ? (
				<img src={foto ?? undefined} alt="" loading="lazy" referrerPolicy="no-referrer" />
			) : (
				<canvas ref={canvasRef} width={16} height={20} />
			)}
		</span>
	);
}

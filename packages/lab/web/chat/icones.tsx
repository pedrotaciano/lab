// The prompt box's 9×9 pixel icons (the POC's chat.js, anexos.js, quadro.js): one path each,
// drawn crisp in currentColor.
import type { ReactNode } from "react";

export const ICONE = {
	enviar:
		"M0 0h1v1h-1zM0 1h3v1h-3zM0 2h5v1h-5zM0 3h7v1h-7zM2 4h7v1h-7zM0 5h7v1h-7zM0 6h5v1h-5zM0 7h3v1h-3zM0 8h1v1h-1z",
	clipe: "M3 0h3v1h-3zM2 1h1v7h-1zM6 1h1v5h-1zM4 2h1v4h-1zM5 6h1v1h-1zM3 8h2v1h-2z",
	quadro:
		"M0 0h9v1h-9zM0 6h9v1h-9zM0 1h1v5h-1zM8 1h1v5h-1zM2 4h1v1h-1zM3 3h1v1h-1zM4 4h1v1h-1zM5 3h1v1h-1zM6 2h1v1h-1zM2 7h1v2h-1zM6 7h1v2h-1z",
	mic: "M3 0h3v1h-3zM2 1h5v3h-5zM3 4h3v1h-3zM1 4h1v2h-1zM7 4h1v2h-1zM2 6h5v1h-5zM4 7h1v1h-1zM2 8h5v1h-5z",
	pagina: "M1 0h5v1h-5zM6 1h1v1h-1zM7 2h1v6h-1zM1 1h1v7h-1zM1 8h7v1h-7z",
} as const;

export function Pixel({ d }: { d: string }): ReactNode {
	return (
		<svg viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
			<path fill="currentColor" d={d} />
		</svg>
	);
}

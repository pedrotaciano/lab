// The laboratório switcher, on top of the left column (on a phone, on top of Sala and Times): the
// lab on screen with its mark and how many chats work there; open, every lab with its machine and
// how many work and wait for you. Choosing one goes to its page (`/l/<id>/`), so everything on
// screen changes with it and the address keeps it.
import { ChevronDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { apiDaEntrada } from "../lib/api";
import { enderecoDoLab, LAB_DA_PAGINA } from "../lib/laboratorio";
import type { ResumoLaboratorio } from "../tipos";

/** The marks, in the labs' order: the brand's verde, azul, amarelo, azul claro. */
const MARCAS = ["#027539", "#4e70c6", "#fdd900", "#10c4e4"];

type Sinal = "online" | "conectando" | "fora";

/** The page's own lab is "conectando" until its first estado arrives. */
function sinalDe(lab: ResumoLaboratorio, vivo: boolean): Sinal {
	if (lab.estado === "fora") return "fora";
	if (lab.estado === "conectando" || (lab.id === LAB_DA_PAGINA && !vivo)) return "conectando";
	return "online";
}

function Marca({ cor, sinal }: { cor: string; sinal: Sinal }): ReactNode {
	return (
		<span className="lab-marca" data-sinal={sinal} style={{ "--cor": cor } as CSSProperties} aria-hidden="true" />
	);
}

function linhaDe(lab: ResumoLaboratorio, sinal: Sinal): string {
	if (sinal === "fora") return lab.motivo && lab.motivo !== "desligado" ? `fora do ar · ${lab.motivo}` : "fora do ar";
	if (sinal === "conectando") return "conectando";
	const partes: string[] = [];
	if (lab.trabalhando > 0) partes.push(`${lab.trabalhando} trabalhando`);
	if (lab.esperando > 0) partes.push(lab.esperando === 1 ? "1 espera você" : `${lab.esperando} esperam você`);
	return partes.join(" · ") || "ninguém trabalhando";
}

function tentar(id: string): void {
	void apiDaEntrada("POST", `/api/laboratorios/${encodeURIComponent(id)}/tentar`).catch(() => undefined);
}

interface Contagem {
	trabalhando: number;
	esperando: number;
}

/**
 * `agora`: the page's own lab counted from its live estado, fresher than the entry lab's poll.
 */
export function TrocaLab({
	labs: doServidor,
	vivo,
	agora,
}: {
	labs: ResumoLaboratorio[];
	vivo: boolean;
	agora: Contagem | null;
}): ReactNode {
	const [aberto, setAberto] = useState(false);
	const raiz = useRef<HTMLDivElement>(null);
	const labs = agora ? doServidor.map(lab => (lab.id === LAB_DA_PAGINA ? { ...lab, ...agora } : lab)) : doServidor;
	const indice = Math.max(
		0,
		labs.findIndex(lab => lab.id === LAB_DA_PAGINA),
	);
	const atual = labs.find(lab => lab.id === LAB_DA_PAGINA) ?? {
		id: LAB_DA_PAGINA,
		nome: LAB_DA_PAGINA,
		maquina: "",
		estado: "conectando",
		trabalhando: 0,
		esperando: 0,
	};
	const sinal = sinalDe(atual, vivo);
	const esperamFora = labs.reduce((soma, lab) => (lab.id === LAB_DA_PAGINA ? soma : soma + lab.esperando), 0);

	useEffect(() => {
		if (!aberto) return;
		const fora = (evento: PointerEvent): void => {
			if (!raiz.current?.contains(evento.target as Node)) setAberto(false);
		};
		const tecla = (evento: KeyboardEvent): void => {
			if (evento.key === "Escape") setAberto(false);
		};
		addEventListener("pointerdown", fora);
		addEventListener("keydown", tecla);
		return () => {
			removeEventListener("pointerdown", fora);
			removeEventListener("keydown", tecla);
		};
	}, [aberto]);

	const escolher = (lab: ResumoLaboratorio): void => {
		setAberto(false);
		if (lab.id !== LAB_DA_PAGINA) location.assign(enderecoDoLab(lab.id));
	};

	return (
		<div className={`troca-lab${aberto ? " is-aberto" : ""}`}>
			<div className="troca-lab__caixa" ref={raiz}>
				<button
					type="button"
					className="troca-lab__atual"
					aria-expanded={aberto}
					aria-haspopup="true"
					onClick={() => setAberto(!aberto)}
				>
					<Marca cor={MARCAS[indice % MARCAS.length]!} sinal={sinal} />
					<span className="troca-lab__texto">
						<span className="troca-lab__nome" title={atual.nome}>
							{atual.nome}
						</span>
						<span className="troca-lab__linha">{linhaDe(atual, sinal)}</span>
					</span>
					{esperamFora > 0 && (
						<span className="aba__selo" title={`${esperamFora} esperando você em outro laboratório`}>
							{esperamFora}
						</span>
					)}
					<ChevronDown size={14} className="troca-lab__seta" aria-hidden="true" />
				</button>
				{aberto && (
					<ul className="troca-lab__lista painel" aria-label="Laboratórios">
						{labs.map((lab, i) => {
							const s = sinalDe(lab, vivo);
							return (
								<li
									key={lab.id}
									className="troca-lab__item"
									aria-current={lab.id === LAB_DA_PAGINA ? "true" : undefined}
								>
									<button type="button" className="troca-lab__escolher" onClick={() => escolher(lab)}>
										<Marca cor={MARCAS[i % MARCAS.length]!} sinal={s} />
										<span className="troca-lab__texto">
											<span className="troca-lab__nome" title={lab.nome}>
												{lab.nome}
											</span>
											<span className="troca-lab__linha">{linhaDe(lab, s)}</span>
										</span>
										<span className="troca-lab__maquina">{lab.maquina}</span>
										{lab.esperando > 0 && (
											<span className="aba__selo" title={`${lab.esperando} esperando você`}>
												{lab.esperando}
											</span>
										)}
									</button>
									{s === "fora" && (
										<button
											type="button"
											className="botao botao--claro botao--p"
											onClick={() => tentar(lab.id)}
										>
											Tentar de novo
										</button>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
			{sinal === "fora" && (
				<button
					type="button"
					className="botao botao--claro botao--p troca-lab__tentar"
					onClick={() => tentar(atual.id)}
				>
					Tentar de novo
				</button>
			)}
		</div>
	);
}

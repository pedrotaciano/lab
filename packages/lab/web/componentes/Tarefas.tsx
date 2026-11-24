// Tarefas: the board of what the agents do, from the Estado alone. Esperando você (a question),
// Trabalhando (its checklist "3 de 5" and the current step, or its activity), Pronto (finished
// today). A card opens its chat.
import type { ReactNode } from "react";
import { useLab } from "../lib/contexto";
import type { Estado, ResumoChat } from "../tipos";
import { Rosto } from "./Rosto";

const hora = (ms: number): string => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function Tarefas({ estado }: { estado: Estado }): ReactNode {
	const hoje = new Date();
	hoje.setHours(0, 0, 0, 0);
	const recentes = [...estado.chats].sort((a, b) => b.atualizadoEm - a.atualizadoEm);
	const esperando = recentes.filter(chat => chat.status === "esperando");
	const trabalhando = recentes.filter(chat => chat.status === "trabalhando");
	const prontos = recentes.filter(
		chat =>
			(chat.status === "livre" || chat.status === "parado") &&
			chat.ultimaResposta !== null &&
			chat.atualizadoEm >= hoje.getTime(),
	);
	const nomeDoTime = new Map(estado.times.map(time => [time.id, time.nome]));

	if (esperando.length + trabalhando.length + prontos.length === 0) {
		return (
			<div className="tarefas tarefas--vazio">
				<p className="tarefas__nada">Nenhum agente trabalhando</p>
			</div>
		);
	}
	return (
		<div className="tarefas">
			<Coluna titulo="Esperando você" tipo="esperando" chats={esperando} times={nomeDoTime} />
			<Coluna titulo="Trabalhando" tipo="trabalhando" chats={trabalhando} times={nomeDoTime} />
			<Coluna titulo="Pronto" tipo="pronto" chats={prontos} times={nomeDoTime} />
		</div>
	);
}

interface ColunaProps {
	titulo: string;
	tipo: "esperando" | "trabalhando" | "pronto";
	chats: ResumoChat[];
	times: ReadonlyMap<string, string>;
}

function Coluna({ titulo, tipo, chats, times }: ColunaProps): ReactNode {
	return (
		<section className={`tarefas__coluna tarefas__coluna--${tipo}`} aria-label={titulo}>
			<h2 className="tarefas__cabeca">
				{titulo}
				<span className="tarefas__n">{chats.length}</span>
			</h2>
			<ul className="tarefas__cartoes">
				{chats.map(chat => (
					<li key={chat.id}>
						<Cartao chat={chat} tipo={tipo} time={times.get(chat.timeId) ?? ""} />
					</li>
				))}
			</ul>
		</section>
	);
}

function Cartao({ chat, tipo, time }: { chat: ResumoChat; tipo: ColunaProps["tipo"]; time: string }): ReactNode {
	const { abrirChat } = useLab();
	return (
		<button type="button" className="tarefas__cartao" onClick={() => abrirChat(chat.id)}>
			<span className="tarefas__quem">
				<Rosto semente={chat.id} papel={chat.papel} agente tamanho="p" />
				<span className="tarefas__nome" title={`${chat.nome} · ${time}`}>
					{chat.nome}
					<span className="tarefas__time"> · {time}</span>
				</span>
				{tipo === "pronto" && <span className="tarefas__hora">{hora(chat.atualizadoEm)}</span>}
			</span>
			{tipo === "esperando" && (
				<span className="tarefas__linha tarefas__linha--esperando" title={chat.pergunta?.titulo}>
					{chat.pergunta?.titulo ?? "espera você"}
				</span>
			)}
			{tipo === "trabalhando" && (
				<>
					{chat.todo && (
						<span className="tarefas__todo">
							<span className="tarefas__passos" aria-hidden="true">
								{Array.from({ length: Math.min(chat.todo.total, 12) }, (_, i) => (
									<span key={i} className={i < (chat.todo?.feitas ?? 0) ? "is-feito" : undefined} />
								))}
							</span>
							{chat.todo.feitas} de {chat.todo.total}
						</span>
					)}
					<span className="tarefas__linha" title={chat.todo?.atual ?? chat.atividade ?? undefined}>
						{chat.todo?.atual ?? chat.atividade ?? "trabalhando"}
					</span>
					{chat.todo?.atual && chat.atividade && <span className="tarefas__atividade">{chat.atividade}</span>}
				</>
			)}
			{tipo === "pronto" && (
				<span className="tarefas__linha tarefas__linha--resposta" title={chat.ultimaResposta ?? undefined}>
					{chat.ultimaResposta}
				</span>
			)}
		</button>
	);
}

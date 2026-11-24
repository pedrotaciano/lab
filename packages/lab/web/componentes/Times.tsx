// "Times e chats": each team (a project folder) with its chats under it, the people online, and
// "Adicionar time" with the folder picker.
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api, caminhoDoChat, ErroApi } from "../lib/api";
import { linhaDoChat, nomeDaPasta, useLab } from "../lib/contexto";
import type { Autor, Estado, ResumoChat, Time } from "../tipos";
import { Rosto } from "./Rosto";

export function Times({ estado }: { estado: Estado }): ReactNode {
	const { adicionarTime } = useLab();
	return (
		<nav className="times" aria-label="Times e chats">
			<p className="rotulo times__titulo">Times</p>
			{estado.times.length > 0 && (
				<ul className="times__lista">
					{estado.times.map(time => (
						<LinhaTime key={time.id} time={time} chats={estado.chats.filter(chat => chat.timeId === time.id)} />
					))}
				</ul>
			)}
			<button type="button" className="times__novo" onClick={adicionarTime}>
				<Plus size={14} aria-hidden="true" /> Adicionar time
			</button>
			<Pessoas pessoas={estado.pessoas} />
		</nav>
	);
}

function LinhaTime({ time, chats }: { time: Time; chats: ResumoChat[] }): ReactNode {
	const { chatAberto, abrirChat } = useLab();
	const [erro, setErro] = useState<string | null>(null);
	const aberto = chats.some(chat => chat.id === chatAberto);
	const ausente = time.ausente === true;

	const novoChat = async (): Promise<void> => {
		setErro(null);
		try {
			const chat = await api<ResumoChat>("POST", "/api/chats", { timeId: time.id });
			abrirChat(chat.id);
		} catch (err) {
			setErro(err instanceof ErroApi ? err.message : String(err));
		}
	};
	const remover = async (): Promise<void> => {
		if (aberto) abrirChat(null);
		try {
			await api("DELETE", `/api/times/${encodeURIComponent(time.id)}`);
		} catch (err) {
			setErro(err instanceof ErroApi ? err.message : String(err));
		}
	};

	return (
		<li className={`time${aberto ? " is-aberto" : ""}${ausente ? " is-ausente" : ""}`}>
			<div className="time__cabeca">
				<div className="time__texto">
					<span className="time__nome" title={time.nome}>
						{time.nome}
					</span>
					<span className="time__pasta" title={time.pasta}>
						{ausente ? "Pasta não encontrada" : time.pasta.replace(/^\/Users\/[^/]+/, "~")}
					</span>
				</div>
				{!ausente && (
					<button
						type="button"
						className="icone icone--quieto"
						title="Novo chat"
						aria-label="Novo chat"
						onClick={novoChat}
					>
						<Plus size={14} />
					</button>
				)}
				{ausente ? (
					<button type="button" className="botao botao--claro botao--p" onClick={remover}>
						Remover
					</button>
				) : (
					<button
						type="button"
						className="icone icone--quieto"
						title="Remover time"
						aria-label="Remover time"
						onClick={remover}
					>
						<X size={14} />
					</button>
				)}
			</div>
			{erro && <p className="time__erro">{erro}</p>}
			{chats.length > 0 && (
				<ul className="time__chats">
					{chats.map(chat => (
						<LinhaChat key={chat.id} chat={chat} />
					))}
				</ul>
			)}
		</li>
	);
}

function LinhaChat({ chat }: { chat: ResumoChat }): ReactNode {
	const { chatAberto, abrirChat } = useLab();
	const reabrir = (): void => {
		void api("POST", caminhoDoChat(chat.id, "/reabrir")).catch(() => undefined);
		abrirChat(chat.id);
	};
	const fechar = (): void => {
		if (chatAberto === chat.id) abrirChat(null);
		void api("DELETE", caminhoDoChat(chat.id)).catch(() => undefined);
	};
	const linha = linhaDoChat(chat);
	return (
		<li className="chat-linha" data-status={chat.status} aria-current={chatAberto === chat.id ? "true" : undefined}>
			<button type="button" className="chat-linha__abrir" onClick={() => abrirChat(chat.id)}>
				<Rosto semente={chat.id} papel={chat.papel} agente tamanho="p" />
				<span className="chat-linha__texto">
					<span className="chat-linha__nome" title={chat.papel ? `${chat.nome} · ${chat.papel}` : chat.nome}>
						{chat.nome}
						{chat.papel && <span className="chat-linha__papel">{chat.papel}</span>}
					</span>
					<span className="chat-linha__estado" title={linha}>
						{linha}
					</span>
				</span>
			</button>
			{chat.status === "erro" && (
				<button type="button" className="botao botao--claro botao--p" onClick={reabrir}>
					Reabrir
				</button>
			)}
			<button
				type="button"
				className="icone icone--quieto chat-linha__fechar"
				title="Fechar chat"
				aria-label="Fechar chat"
				onClick={fechar}
			>
				<X size={13} />
			</button>
		</li>
	);
}

function Pessoas({ pessoas }: { pessoas: readonly Autor[] }): ReactNode {
	if (pessoas.length === 0) return null;
	return (
		<section className="pessoas" aria-label="Online">
			<p className="rotulo">Online</p>
			<ul className="pessoas__lista">
				{pessoas.map(pessoa => (
					<li key={pessoa.login} title={pessoa.nome}>
						<Rosto semente={pessoa.login} foto={pessoa.foto} tamanho="p" />
						<span className="pessoas__nome">{pessoa.nome}</span>
					</li>
				))}
			</ul>
		</section>
	);
}

interface Pastas {
	caminho: string;
	pastas: string[];
}

const PASTA_INICIAL = "~/Documents/orbi";

/** The folder picker: starts at ~/Documents/orbi (the recent projects), walks up and down. */
export function AdicionarTime({ aoFechar }: { aoFechar(): void }): ReactNode {
	const { abrirChat } = useLab();
	const [lista, setLista] = useState<Pastas | null>(null);
	const [escolhida, setEscolhida] = useState<string | null>(null);
	const [nome, setNome] = useState("");
	const [erro, setErro] = useState<string | null>(null);
	const [ocupado, setOcupado] = useState(false);
	const [digitado, setDigitado] = useState("");

	const ir = async (caminho: string): Promise<void> => {
		setErro(null);
		try {
			const resposta = await api<Pastas>("GET", `/api/pastas?caminho=${encodeURIComponent(caminho)}`);
			setLista(resposta);
			setDigitado(resposta.caminho);
			setEscolhida(null);
			setNome("");
		} catch (err) {
			setErro(err instanceof ErroApi ? err.message : String(err));
		}
	};
	// The first listing, once on open.
	useEffect(() => {
		void ir(PASTA_INICIAL);
	}, []);

	const caminhoDe = (pasta: string): string =>
		pasta.startsWith("/") || pasta.startsWith("~") ? pasta : `${lista?.caminho.replace(/\/+$/, "") ?? ""}/${pasta}`;
	const acima = lista ? lista.caminho.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/" : null;
	const alvo = escolhida ?? lista?.caminho ?? null;

	const adicionar = async (): Promise<void> => {
		if (!alvo) return;
		setOcupado(true);
		setErro(null);
		try {
			const time = await api<Time>("POST", "/api/times", { nome: nome.trim() || nomeDaPasta(alvo), pasta: alvo });
			const chat = await api<ResumoChat>("POST", "/api/chats", { timeId: time.id });
			abrirChat(chat.id);
			aoFechar();
		} catch (err) {
			setErro(err instanceof ErroApi ? err.message : String(err));
		} finally {
			setOcupado(false);
		}
	};

	return (
		<div className="dialogo__fundo" onClick={aoFechar}>
			<section
				className="dialogo painel"
				role="dialog"
				aria-modal="true"
				aria-label="Adicionar time"
				onClick={e => e.stopPropagation()}
			>
				<header className="dialogo__cabeca">
					<p className="rotulo">Adicionar time</p>
					<button type="button" className="icone icone--quieto" aria-label="Fechar" onClick={aoFechar}>
						<X size={14} />
					</button>
				</header>
				<div className="pastas">
					<div className="pastas__onde">
						<button
							type="button"
							className="icone"
							title="Pasta acima"
							aria-label="Pasta acima"
							disabled={!acima || acima === lista?.caminho}
							onClick={() => acima && ir(acima)}
						>
							↑
						</button>
						<input
							className="pastas__caminho"
							aria-label="Caminho"
							title={lista?.caminho}
							value={digitado}
							spellCheck={false}
							autoCapitalize="off"
							onChange={e => setDigitado(e.target.value)}
							onKeyDown={e => {
								if (e.key === "Enter" && digitado.trim()) void ir(digitado.trim());
							}}
						/>
					</div>
					<ul className="pastas__lista">
						{lista?.pastas.map(pasta => {
							const caminho = caminhoDe(pasta);
							return (
								<li key={caminho} className="pastas__item">
									<button
										type="button"
										className="pastas__pasta"
										aria-pressed={escolhida === caminho}
										title={caminho}
										onClick={() => {
											setEscolhida(caminho);
											setNome(nomeDaPasta(caminho));
										}}
										onDoubleClick={() => ir(caminho)}
									>
										{nomeDaPasta(pasta)}
									</button>
									<button
										type="button"
										className="pastas__entrar"
										title="Abrir pasta"
										aria-label={`Abrir ${nomeDaPasta(pasta)}`}
										onClick={() => ir(caminho)}
									>
										›
									</button>
								</li>
							);
						})}
						{lista && lista.pastas.length === 0 && <li className="pastas__vazia">Sem pastas</li>}
					</ul>
				</div>
				<label className="campo">
					<span className="rotulo-campo">Nome</span>
					<input
						value={nome}
						placeholder={alvo ? nomeDaPasta(alvo) : ""}
						onChange={e => setNome(e.target.value)}
						onKeyDown={e => {
							if (e.key === "Enter") void adicionar();
						}}
					/>
				</label>
				{erro && <p className="dialogo__erro">{erro}</p>}
				<footer className="dialogo__pe">
					<span className="dialogo__alvo" title={alvo ?? undefined}>
						{alvo ? nomeDaPasta(alvo) : ""}
					</span>
					<button type="button" className="botao" disabled={!alvo || ocupado} onClick={adicionar}>
						Adicionar
					</button>
				</footer>
			</section>
		</div>
	);
}

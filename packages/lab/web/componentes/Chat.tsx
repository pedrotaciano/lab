// The open chat: its face, name and state on top; the transcript (collab-web's Transcript, fed by
// the chat's replica); then what it does now, the messages in the queue, and the prompt box, or
// the ask card in its place.
import {
	Transcript,
	type TranscriptLabels,
	TranscriptLabelsContext,
} from "@oh-my-pi/collab-web/src/components/transcript/Transcript";
import type { SessionEntry } from "@oh-my-pi/pi-wire";
import { ArrowLeft, AudioLines } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, caminhoDoChat } from "../lib/api";
import { linhaDoChat, PALAVRA_DO_STATUS, useLab } from "../lib/contexto";
import type { Autor, Estado, ResumoChat } from "../tipos";
import { Composer } from "./Composer";
import { Pergunta } from "./Pergunta";
import { Rosto } from "./Rosto";
import { Voz } from "./Voz";

/** The words of a user message, to retry it or match it against the queue. */
function textoDoUsuario(entry: SessionEntry): string | null {
	if (entry.type !== "message" || entry.message.role !== "user") return null;
	const conteudo = entry.message.content;
	if (typeof conteudo === "string") return conteudo;
	return conteudo.flatMap(bloco => (bloco.type === "text" ? [bloco.text] : [])).join("\n");
}

/** A face and a first name in the transcript's gutter; `outro`: someone else's message (Carly, a member). */
function Autoria({ rosto, nome, outro = false }: { rosto: ReactNode; nome: string; outro?: boolean }): ReactNode {
	return (
		<span className={`autoria${outro ? " autoria--outro" : ""}`} title={nome}>
			{rosto}
			<span className="autoria__nome">{nome.split(" ")[0]}</span>
		</span>
	);
}

function autorDe(nome: string, pessoas: readonly Autor[]): Autor | null {
	const chave = nome.toLowerCase();
	return pessoas.find(p => p.nome.toLowerCase() === chave || p.login.toLowerCase() === chave) ?? null;
}

interface Props {
	chat: ResumoChat;
	estado: Estado;
	celular: boolean;
}

export function Chat({ chat, estado, celular }: Props): ReactNode {
	const { conexao, eu, abrirChat } = useLab();
	const replica = useMemo(() => conexao.replica(chat.id), [conexao, chat.id]);
	const foto = useSyncExternalStore(replica.subscribe, replica.getSnapshot);
	const [fila, setFila] = useState<{ texto: string; depoisDe: number }[]>([]);
	const [voz, setVoz] = useState(false);
	const [erroEnvio, setErroEnvio] = useState<string | null>(null);

	useEffect(() => conexao.assinar(chat.id), [conexao, chat.id]);
	useEffect(() => {
		setFila([]);
		setVoz(false);
		setErroEnvio(null);
	}, [chat.id]);

	// A queued message leaves the queue once it lands in the transcript.
	useEffect(() => {
		if (fila.length === 0) return;
		const restantes = fila.filter(
			item => !foto.entries.slice(item.depoisDe).some(entry => textoDoUsuario(entry)?.trim() === item.texto),
		);
		if (restantes.length !== fila.length) setFila(restantes);
	}, [foto.entries, fila]);

	const enviar = useCallback(
		(texto: string): void => {
			setErroEnvio(null);
			if (foto.working) setFila(antes => [...antes, { texto, depoisDe: foto.entries.length }]);
			api("POST", caminhoDoChat(chat.id, "/mensagem"), { texto }).catch((err: unknown) => {
				setErroEnvio(err instanceof Error ? err.message : String(err));
				setFila(antes => antes.filter(item => item.texto !== texto));
			});
		},
		[chat.id, foto.working, foto.entries.length],
	);
	const parar = (): void => {
		void api("POST", caminhoDoChat(chat.id, "/parar")).catch(() => undefined);
	};
	const reabrir = (): void => {
		void api("POST", caminhoDoChat(chat.id, "/reabrir")).catch(() => undefined);
	};

	const rotulos = useMemo<TranscriptLabels>(
		() => ({
			user: eu ? <Autoria rosto={<Rosto semente={eu.login} foto={eu.foto} tamanho="p" />} nome={eu.nome} /> : "",
			agent: <Autoria rosto={<Rosto semente={chat.id} papel={chat.papel} agente tamanho="p" />} nome={chat.nome} />,
			from: nome => {
				const autor = autorDe(nome, estado.pessoas);
				const semente = autor?.login ?? (nome.toLowerCase() === "carly" ? "carly" : nome);
				return <Autoria rosto={<Rosto semente={semente} foto={autor?.foto} tamanho="p" />} nome={nome} outro />;
			},
			thinking: "pensando…",
			empty: "",
			earlier: count => `mais ${count} acima`,
		}),
		[eu, chat.id, chat.papel, chat.nome, estado.pessoas],
	);

	// The model's error, inline under its message: retry the last request.
	const ultima = foto.entries[foto.entries.length - 1];
	const erroDoModelo =
		!foto.working &&
		foto.stream === null &&
		ultima?.type === "message" &&
		ultima.message.role === "assistant" &&
		ultima.message.stopReason === "error";
	const tentarDeNovo = (): void => {
		for (let i = foto.entries.length - 1; i >= 0; i--) {
			const entry = foto.entries[i];
			const texto = entry ? textoDoUsuario(entry) : null;
			if (texto) {
				enviar(texto);
				return;
			}
		}
	};
	const caiu = chat.status === "erro" && !erroDoModelo;
	const semVoz = estado.voz === false;
	const linha = linhaDoChat(chat);

	return (
		<section className="chat" aria-label={`Chat com ${chat.nome}`}>
			<header className="chat__cabeca">
				{celular && (
					<button type="button" className="icone icone--quieto" aria-label="Chats" onClick={() => abrirChat(null)}>
						<ArrowLeft size={16} />
					</button>
				)}
				<Rosto semente={chat.id} papel={chat.papel} agente tamanho="m" />
				<div className="chat__quem">
					<p className="chat__nome" title={chat.nome}>
						{chat.nome}
						{chat.papel && <span className="chat__papel">{chat.papel}</span>}
					</p>
					<p className="chat__status" data-status={chat.status} title={linha}>
						{PALAVRA_DO_STATUS[chat.status]}
						{chat.modelo && <span className="chat__modelo"> · {chat.modelo}</span>}
					</p>
				</div>
				<button
					type="button"
					className="icone"
					aria-label="Ligar"
					title={semVoz ? "Entre no ChatGPT no omp (/login)" : "Ligar"}
					disabled={semVoz || caiu}
					onClick={() => setVoz(true)}
				>
					<AudioLines size={16} />
				</button>
			</header>
			{caiu && (
				<div className="aviso" role="alert">
					<span className="aviso__texto" title={chat.erro ?? undefined}>
						{chat.erro ? `O omp parou: ${chat.erro}` : "O omp parou"}
					</span>
					<button type="button" className="botao botao--claro botao--p" onClick={reabrir}>
						Reabrir
					</button>
				</div>
			)}
			<div className="chat__corpo">
				<TranscriptLabelsContext.Provider value={rotulos}>
					{foto.carregando && foto.entries.length === 0 ? (
						<Esqueleto />
					) : (
						<Transcript
							entries={foto.entries}
							stream={foto.stream}
							streamDone={foto.streamDone}
							activeTools={foto.activeTools}
							working={foto.working}
						/>
					)}
				</TranscriptLabelsContext.Provider>
			</div>
			<div className="chat__pe">
				{erroDoModelo && (
					<div className="chat__tentar">
						<button type="button" className="botao botao--claro botao--p" onClick={tentarDeNovo}>
							Tentar de novo
						</button>
					</div>
				)}
				{chat.status === "trabalhando" && (
					<p className="chat__atividade" title={linha}>
						<span className="pixspin" aria-hidden="true" />
						<span className="chat__atividade-texto">{chat.atividade ?? "trabalhando"}</span>
						{chat.todo && (
							<span className="chat__todo">
								{chat.todo.feitas} de {chat.todo.total}
							</span>
						)}
					</p>
				)}
				{fila.length > 0 && (
					<ul className="fila" aria-label="Na fila">
						{fila.map((item, i) => (
							<li key={`${i}-${item.texto}`} className="fila__item" title={item.texto}>
								<span className="fila__marca">na fila</span>
								<span className="fila__texto">{item.texto}</span>
							</li>
						))}
					</ul>
				)}
				{(erroEnvio ?? foto.aviso) && <p className="chat__erro">{erroEnvio ?? foto.aviso}</p>}
				{foto.pergunta ? (
					<Pergunta chatId={chat.id} pedido={foto.pergunta} aoResponder={reqId => replica.respondida(reqId)} />
				) : (
					<Composer trabalhando={foto.working} aoEnviar={enviar} aoParar={parar} />
				)}
			</div>
			{voz && <Voz chat={chat} aoFechar={() => setVoz(false)} />}
		</section>
	);
}

/** Loading the history: rows in the transcript's own layout, so nothing moves when it arrives. */
function Esqueleto(): ReactNode {
	return (
		<div className="tr-root esqueleto" aria-busy="true" aria-label="Carregando">
			{[62, 88, 45].map((largura, i) => (
				<div key={largura} className={`tr-row tr-row--${i % 2 === 0 ? "user" : "assistant"}`}>
					<div className="tr-gutter" />
					<div className="tr-body">
						<span className="esqueleto__linha" style={{ width: `${largura}%` }} />
						{i % 2 === 1 && <span className="esqueleto__linha" style={{ width: "54%" }} />}
					</div>
				</div>
			))}
		</div>
	);
}

/** No chat open (the desktop column, a phone's Chat tab without one). */
export function SemChat(): ReactNode {
	return (
		<section className="chat chat--vazio" aria-label="Chat">
			<p className="chat__sem">Nenhum chat aberto</p>
		</section>
	);
}

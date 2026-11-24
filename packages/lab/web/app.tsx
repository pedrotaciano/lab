// lab's page: the teams and chats on the left, the room or the task board in the middle, the open
// chat on the right; on a phone (≤ 720 px) one screen at a time under the tabs Sala / Chat / Tarefas.
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Chat, SemChat } from "./componentes/Chat";
import { Sala } from "./componentes/Sala";
import { Tarefas } from "./componentes/Tarefas";
import { AdicionarTime, Times } from "./componentes/Times";
import { api } from "./lib/api";
import { Conexao } from "./lib/conexao";
import { ESTADO_VAZIO, type Lab, LabContexto, useConexao } from "./lib/contexto";
import type { Autor } from "./tipos";
import "./fontes/fontes.css";
import "./estilo.css";

type Aba = "sala" | "chat" | "tarefas";

const CELULAR = "(max-width: 720px)";
/** The keyboard is up when the visual viewport loses this much of the window. */
const TECLADO_PX = 120;

function chatDoEndereco(): string | null {
	const achado = /^#chat=(.+)$/.exec(location.hash);
	return achado?.[1] ? decodeURIComponent(achado[1]) : null;
}

function useMedia(consulta: string): boolean {
	const [bate, setBate] = useState(() => matchMedia(consulta).matches);
	useEffect(() => {
		const lista = matchMedia(consulta);
		const mudar = (): void => setBate(lista.matches);
		lista.addEventListener("change", mudar);
		return () => lista.removeEventListener("change", mudar);
	}, [consulta]);
	return bate;
}

/** Night from 19 h to 6 h, as the POC's sky (its lights on): the page goes dark. */
function useNoite(): void {
	useEffect(() => {
		const pintar = (): void => {
			const h = new Date().getHours();
			const noite = h >= 19 || h < 6;
			document.documentElement.classList.toggle("is-noite", noite);
			document.querySelector('meta[name="theme-color"]')?.setAttribute("content", noite ? "#29251e" : "#f7f6f3");
		};
		pintar();
		const timer = setInterval(pintar, 60_000);
		return () => clearInterval(timer);
	}, []);
}

/** The phone's keyboard: the page fits the visual viewport, so the prompt box stays above the keys. */
function useTeclado(): void {
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const medir = (): void => {
			document.documentElement.style.setProperty("--altura", `${vv.height}px`);
			document.documentElement.classList.toggle("tem-teclado", window.innerHeight - vv.height > TECLADO_PX);
			window.scrollTo(0, 0);
		};
		medir();
		vv.addEventListener("resize", medir);
		vv.addEventListener("scroll", medir);
		return () => {
			vv.removeEventListener("resize", medir);
			vv.removeEventListener("scroll", medir);
		};
	}, []);
}

const horaCurta = (ms: number): string =>
	new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function App(): ReactNode {
	const conexao = useMemo(() => new Conexao(), []);
	const foto = useConexao(conexao);
	const [eu, setEu] = useState<Autor | null>(null);
	const [chatAberto, setChatAberto] = useState<string | null>(chatDoEndereco);
	const [aba, setAba] = useState<Aba>(() => (chatDoEndereco() ? "chat" : "sala"));
	const [adicionando, setAdicionando] = useState(false);
	const celular = useMedia(CELULAR);
	useNoite();
	useTeclado();

	useEffect(() => {
		void api<Autor>("GET", "/api/eu")
			.then(setEu)
			.catch(() => undefined);
	}, []);

	const abrirChat = useCallback((chatId: string | null): void => {
		setChatAberto(chatId);
		history.replaceState(null, "", chatId ? `#chat=${encodeURIComponent(chatId)}` : location.pathname);
		if (chatId) setAba("chat");
	}, []);
	const adicionarTime = useCallback((): void => setAdicionando(true), []);

	const estado = foto.estado ?? ESTADO_VAZIO;
	const chat = chatAberto ? estado.chats.find(c => c.id === chatAberto) : undefined;

	// A chat that was here and is gone (closed elsewhere) closes here too; a new one may not be in
	// the Estado yet.
	const vistoRef = useRef<string | null>(null);
	useEffect(() => {
		if (chat) vistoRef.current = chat.id;
		else if (chatAberto && vistoRef.current === chatAberto) {
			vistoRef.current = null;
			abrirChat(null);
		}
	}, [chatAberto, chat, abrirChat]);

	const lab = useMemo<Lab>(
		() => ({ conexao, eu, chatAberto, abrirChat, adicionarTime }),
		[conexao, eu, chatAberto, abrirChat, adicionarTime],
	);

	const esperando = estado.chats.filter(c => c.status === "esperando").length;
	const visivel: Aba = !celular && aba === "chat" ? "sala" : aba;
	const banner = !foto.online && foto.offlineDesde !== null && (
		<p className="banner" role="alert">
			Sem conexão desde {horaCurta(foto.offlineDesde)}
		</p>
	);

	if (!foto.estado) {
		return (
			<div className="carregando" role="status">
				<p className="rotulo">
					{foto.offlineDesde ? `Sem conexão desde ${horaCurta(foto.offlineDesde)}` : "Abrindo o lab"}
				</p>
				<div className="carregando__barra" aria-hidden="true">
					{Array.from({ length: 10 }, (_, i) => (
						<span key={i} />
					))}
				</div>
			</div>
		);
	}

	const abaBotao = (qual: Aba, nome: string, selo = 0): ReactNode => (
		<button
			key={qual}
			type="button"
			role="tab"
			className="aba"
			aria-selected={visivel === qual}
			onClick={() => setAba(qual)}
		>
			{nome}
			{selo > 0 && <span className="aba__selo">{selo}</span>}
		</button>
	);

	return (
		<LabContexto.Provider value={lab}>
			{celular ? (
				<div className="app app--celular">
					{banner}
					<main className="app__tela">
						<div className="app__painel" hidden={visivel !== "sala"}>
							<Sala estado={estado} />
						</div>
						{visivel === "chat" &&
							(chat ? (
								<Chat key={chat.id} chat={chat} estado={estado} celular />
							) : (
								<div className="app__painel app__painel--rolar">
									<Times estado={estado} />
								</div>
							))}
						{visivel === "tarefas" && (
							<div className="app__painel app__painel--rolar">
								<Tarefas estado={estado} />
							</div>
						)}
					</main>
					<nav className="abas abas--baixo" role="tablist" aria-label="Telas">
						{abaBotao("sala", "Sala")}
						{abaBotao("chat", "Chat")}
						{abaBotao("tarefas", "Tarefas", esperando)}
					</nav>
				</div>
			) : (
				<div className="app">
					<aside className="app__lateral">
						<Times estado={estado} />
					</aside>
					<main className="app__meio">
						<nav className="abas" role="tablist" aria-label="Vistas">
							{abaBotao("sala", "Sala")}
							{abaBotao("tarefas", "Tarefas", esperando)}
						</nav>
						{banner}
						<div className="app__painel" hidden={visivel !== "sala"}>
							<Sala estado={estado} />
						</div>
						{visivel === "tarefas" && (
							<div className="app__painel app__painel--rolar">
								<Tarefas estado={estado} />
							</div>
						)}
					</main>
					{chat ? <Chat key={chat.id} chat={chat} estado={estado} celular={false} /> : <SemChat />}
				</div>
			)}
			{adicionando && <AdicionarTime aoFechar={() => setAdicionando(false)} />}
		</LabContexto.Provider>
	);
}

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("falta o #raiz");
createRoot(raiz).render(<App />);

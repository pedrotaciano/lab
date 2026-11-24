// Memória: an Egregore team's shared memory, read-only. Its sections (Handoffs … Identidade) with
// what each file is, who wrote it and when, from the memory repo's history; a file opens in a
// reader beside the list (full screen on a phone). Under the team's name, the memory against the
// team's remote and Egregore's own sync. A file someone else adds while it is open enters the
// list on top, marked "novo"; the reader stays where it is.
import { Markdown } from "@oh-my-pi/collab-web/src/components/transcript/Markdown";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ErroApi } from "../lib/api";
import { useConexao, useLab } from "../lib/contexto";
import type { Estado, ItemMemoria, MemoriaTime, SecaoMemoria, SecaoMemoriaId, SincroniaMemoria, Time } from "../tipos";
import { Rosto } from "./Rosto";

const POR_SECAO = 20;
const ESPERA_BUSCA_MS = 200;
const INTERVALO_SINCRONIA_MS = 120_000;
/** Holds the knowledge; Pessoas and Identidade exist from the first day. */
const SECOES_DO_TRABALHO: readonly SecaoMemoriaId[] = [
	"handoffs",
	"decisoes",
	"descobertas",
	"padroes",
	"perguntas",
	"quests",
	"wraps",
];

const caminhoDaMemoria = (timeId: string, resto = ""): string =>
	`/api/times/${encodeURIComponent(timeId)}/memoria${resto}`;

function quando(ms: number): string {
	const data = new Date(ms);
	const hoje = new Date();
	const dias = Math.round(
		(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime() -
			new Date(data.getFullYear(), data.getMonth(), data.getDate()).getTime()) /
			86_400_000,
	);
	if (dias === 0) return `hoje, ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
	if (dias === 1) return "ontem";
	const mes = `${data.getDate()} ${data.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}`;
	return data.getFullYear() === hoje.getFullYear() ? mes : `${mes} ${data.getFullYear()}`;
}

export function Memoria({ estado, celular }: { estado: Estado; celular: boolean }): ReactNode {
	const { chatAberto } = useLab();
	const egregores = estado.times.filter(time => time.egregore);
	const doChat = estado.chats.find(chat => chat.id === chatAberto)?.timeId;
	const [escolhido, setEscolhido] = useState<string | null>(null);
	const time =
		egregores.find(t => t.id === escolhido) ?? egregores.find(t => t.id === doChat) ?? egregores[0] ?? null;
	if (!time) return null;
	return (
		<MemoriaDoTime
			key={time.id}
			time={time}
			outros={egregores.length > 1 ? egregores : []}
			escolher={setEscolhido}
			celular={celular}
		/>
	);
}

interface PropsTime {
	time: Time;
	outros: Time[];
	escolher(timeId: string): void;
	celular: boolean;
}

function MemoriaDoTime({ time, outros, escolher, celular }: PropsTime): ReactNode {
	const { conexao } = useLab();
	const { online } = useConexao(conexao);
	const [memoria, setMemoria] = useState<MemoriaTime | null>(null);
	const [erro, setErro] = useState<string | null>(null);
	const [sincronia, setSincronia] = useState<SincroniaMemoria | null>(null);
	const [busca, setBusca] = useState("");
	const [consulta, setConsulta] = useState("");
	const [aberto, setAberto] = useState<ItemMemoria | null>(null);
	const [novos, setNovos] = useState<ReadonlySet<string>>(new Set());
	const conhecidos = useRef<Set<string> | null>(null);

	const carregar = useCallback(async (): Promise<void> => {
		try {
			const lida = await api<MemoriaTime>("GET", caminhoDaMemoria(time.id, `?q=${encodeURIComponent(consulta)}`));
			setErro(null);
			setMemoria(lida);
			// What arrives from someone else after the first look is new; a search shows a part only.
			if (consulta) return;
			const itens = lida.secoes.flatMap(secao => secao.itens);
			const antes = conhecidos.current;
			conhecidos.current = new Set(itens.map(item => item.caminho));
			if (!antes) return;
			const chegaram = itens.filter(item => !item.meu && !antes.has(item.caminho)).map(item => item.caminho);
			if (chegaram.length > 0) setNovos(atual => new Set([...atual, ...chegaram]));
		} catch (err) {
			setErro(err instanceof ErroApi ? err.message : String(err));
		}
	}, [time.id, consulta]);

	const medir = useCallback(async (): Promise<void> => {
		try {
			setSincronia(await api<SincroniaMemoria>("GET", caminhoDaMemoria(time.id, "/sincronia")));
		} catch {
			// The line keeps the last known state.
		}
	}, [time.id]);

	useEffect(() => {
		const timer = setTimeout(() => setConsulta(busca.trim()), ESPERA_BUSCA_MS);
		return () => clearTimeout(timer);
	}, [busca]);

	useEffect(() => {
		if (!online) return;
		void carregar();
	}, [carregar, online]);

	useEffect(() => {
		if (!online) return;
		void medir();
		const timer = setInterval(() => void medir(), INTERVALO_SINCRONIA_MS);
		return () => clearInterval(timer);
	}, [medir, online]);

	useEffect(
		() =>
			conexao.ouvirMemoria(timeId => {
				if (timeId !== time.id) return;
				void carregar();
				void medir();
			}),
		[conexao, time.id, carregar, medir],
	);

	const sincronizar = useCallback(async (): Promise<void> => {
		setSincronia(atual => (atual ? { ...atual, sincronizando: true, erro: undefined } : atual));
		try {
			setSincronia(await api<SincroniaMemoria>("POST", caminhoDaMemoria(time.id, "/sincronizar")));
		} catch (err) {
			setSincronia(atual => ({
				atras: atual?.atras ?? 0,
				frente: atual?.frente ?? 0,
				sincronizando: false,
				erro: err instanceof ErroApi ? err.message : String(err),
			}));
		}
	}, [time.id]);

	const abrir = useCallback((item: ItemMemoria): void => {
		setAberto(item);
		setNovos(atual => {
			if (!atual.has(item.caminho)) return atual;
			const resto = new Set(atual);
			resto.delete(item.caminho);
			return resto;
		});
	}, []);

	const lendo = aberto !== null;
	return (
		<div className={`memoria${lendo ? " memoria--lendo" : ""}${celular ? " memoria--celular" : ""}`}>
			<div className="memoria__lista">
				<header className="memoria__topo">
					{outros.length > 0 && (
						<div className="memoria__times" role="tablist" aria-label="Egregores">
							{outros.map(outro => (
								<button
									key={outro.id}
									type="button"
									role="tab"
									className="memoria__time"
									aria-selected={outro.id === time.id}
									onClick={() => escolher(outro.id)}
								>
									{outro.nome}
								</button>
							))}
						</div>
					)}
					<h2 className="memoria__nome">{time.nome}</h2>
					{memoria?.presente !== false && <LinhaSincronia sincronia={sincronia} sincronizar={sincronizar} />}
					{memoria?.presente !== false && (
						<input
							className="memoria__busca"
							type="search"
							value={busca}
							placeholder="Buscar"
							aria-label="Buscar na memória"
							onChange={evento => setBusca(evento.target.value)}
							onKeyDown={evento => {
								if (evento.key === "Escape") setBusca("");
							}}
						/>
					)}
				</header>
				{erro && !memoria ? (
					<p className="memoria__aviso">{erro}</p>
				) : !memoria ? (
					<p className="memoria__aviso" role="status">
						Abrindo a memória
					</p>
				) : !memoria.presente ? (
					<div className="memoria__ausente">
						<p>A memória deste Egregore não está nesta máquina</p>
						{memoria.comando && <code className="memoria__comando">{memoria.comando}</code>}
					</div>
				) : (
					<Secoes
						memoria={memoria}
						consulta={consulta}
						limpar={() => setBusca("")}
						novos={novos}
						aberto={aberto?.caminho ?? null}
						abrir={abrir}
					/>
				)}
			</div>
			{aberto && <Leitor key={aberto.caminho} timeId={time.id} item={aberto} fechar={() => setAberto(null)} celular={celular} />}
		</div>
	);
}

function LinhaSincronia({
	sincronia,
	sincronizar,
}: {
	sincronia: SincroniaMemoria | null;
	sincronizar(): Promise<void>;
}): ReactNode {
	if (!sincronia) return <p className="memoria__sincronia">&nbsp;</p>;
	if (sincronia.sincronizando) {
		return (
			<p className="memoria__sincronia" role="status">
				<span className="pixspin" aria-hidden="true" /> sincronizando
			</p>
		);
	}
	if (sincronia.erro) {
		return (
			<p className="memoria__sincronia memoria__sincronia--erro" role="alert">
				<span className="memoria__motivo" title={sincronia.erro}>
					Não deu para sincronizar: {sincronia.erro}
				</span>
				<button type="button" className="link" onClick={() => void sincronizar()}>
					Tentar de novo
				</button>
			</p>
		);
	}
	const { atras, frente } = sincronia;
	if (atras === 0 && frente === 0) return <p className="memoria__sincronia">memória em dia</p>;
	const botao = (
		<button type="button" className="link" onClick={() => void sincronizar()}>
			Sincronizar
		</button>
	);
	return (
		<p className={`memoria__sincronia${atras > 0 ? " memoria__sincronia--novidade" : ""}`}>
			{atras > 0 && (
				<>
					<span>{atras === 1 ? "1 novidade do time" : `${atras} novidades do time`}</span>
					<span aria-hidden="true">·</span>
					{botao}
				</>
			)}
			{atras > 0 && frente > 0 && <span aria-hidden="true">·</span>}
			{frente > 0 && (
				<span className="memoria__pendente">
					{frente === 1 ? "1 seu ainda não subiu" : `${frente} seus ainda não subiram`}
				</span>
			)}
			{atras === 0 && (
				<>
					<span aria-hidden="true">·</span>
					{botao}
				</>
			)}
		</p>
	);
}

interface PropsSecoes {
	memoria: MemoriaTime;
	consulta: string;
	limpar(): void;
	novos: ReadonlySet<string>;
	aberto: string | null;
	abrir(item: ItemMemoria): void;
}

function Secoes({ memoria, consulta, limpar, novos, aberto, abrir }: PropsSecoes): ReactNode {
	const [abertas, setAbertas] = useState<Partial<Record<SecaoMemoriaId, boolean>>>({});
	const [todas, setTodas] = useState<Partial<Record<SecaoMemoriaId, boolean>>>({});
	const nova = useMemo(
		() =>
			memoria.secoes.every(secao => !SECOES_DO_TRABALHO.includes(secao.id) || secao.itens.length === 0),
		[memoria],
	);

	if (consulta) {
		const achadas = memoria.secoes.filter(secao => secao.itens.length > 0);
		if (achadas.length === 0) {
			return (
				<div className="memoria__nada">
					<p>Nada com '{consulta}'</p>
					<button type="button" className="botao botao--claro botao--p" onClick={limpar}>
						Limpar
					</button>
				</div>
			);
		}
		return (
			<div className="memoria__secoes">
				{achadas.map(secao => (
					<Secao
						key={secao.id}
						secao={secao}
						aberta
						alternar={() => undefined}
						todas={todas[secao.id] === true}
						verTodas={() => setTodas(atual => ({ ...atual, [secao.id]: true }))}
						novos={novos}
						aberto={aberto}
						abrir={abrir}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="memoria__secoes">
			{memoria.secoes.map(secao => {
				const padrao = nova ? secao.id === "identidade" : secao.itens.length > 0;
				const aberta = (abertas[secao.id] ?? padrao) && secao.itens.length > 0;
				return (
					<Secao
						key={secao.id}
						secao={secao}
						aberta={aberta}
						alternar={() => setAbertas(atual => ({ ...atual, [secao.id]: !aberta }))}
						todas={todas[secao.id] === true}
						verTodas={() => setTodas(atual => ({ ...atual, [secao.id]: true }))}
						novos={novos}
						aberto={aberto}
						abrir={abrir}
					/>
				);
			})}
			{nova && <p className="memoria__comeco">Os handoffs e as decisões do time aparecem aqui</p>}
		</div>
	);
}

interface PropsSecao {
	secao: SecaoMemoria;
	aberta: boolean;
	alternar(): void;
	todas: boolean;
	verTodas(): void;
	novos: ReadonlySet<string>;
	aberto: string | null;
	abrir(item: ItemMemoria): void;
}

function Secao({ secao, aberta, alternar, todas, verTodas, novos, aberto, abrir }: PropsSecao): ReactNode {
	const vazia = secao.itens.length === 0;
	const mostrados = todas ? secao.itens : secao.itens.slice(0, POR_SECAO);
	return (
		<section className={`memoria__secao${vazia ? " is-vazia" : ""}`} aria-label={secao.nome}>
			<h3 className="memoria__cabeca">
				<button type="button" aria-expanded={aberta} disabled={vazia} onClick={alternar}>
					<span className="memoria__seta" aria-hidden="true">
						{aberta ? "▾" : "▸"}
					</span>
					{secao.nome}
					<span className="memoria__n">{secao.itens.length}</span>
				</button>
			</h3>
			{aberta && (
				<>
					<ul className={`memoria__itens${todas ? " memoria__itens--todas" : ""}`}>
						{mostrados.map(item => (
							<li key={item.caminho}>
								<Item item={item} novo={novos.has(item.caminho)} aberto={item.caminho === aberto} abrir={abrir} />
							</li>
						))}
					</ul>
					{!todas && secao.itens.length > POR_SECAO && (
						<button type="button" className="link memoria__todos" onClick={verTodas}>
							Ver todos ({secao.itens.length})
						</button>
					)}
				</>
			)}
		</section>
	);
}

function Item({
	item,
	novo,
	aberto,
	abrir,
}: {
	item: ItemMemoria;
	novo: boolean;
	aberto: boolean;
	abrir(item: ItemMemoria): void;
}): ReactNode {
	return (
		<button
			type="button"
			className={`memoria__item${aberto ? " is-aberto" : ""}${novo ? " is-novo" : ""}`}
			aria-current={aberto || undefined}
			onClick={() => abrir(item)}
		>
			<span className="memoria__titulo" title={item.titulo}>
				{item.titulo}
			</span>
			<span className="memoria__quem">
				<Assinatura item={item} />
				{novo && <span className="memoria__novo">novo</span>}
			</span>
			{item.primeiraLinha && <span className="memoria__linha">{item.primeiraLinha}</span>}
		</button>
	);
}

/** Who wrote it (face and name) and when; just when, while it is not committed. */
function Assinatura({ item }: { item: ItemMemoria }): ReactNode {
	return (
		<>
			{item.autor && (
				<>
					<Rosto semente={item.autor.login ?? item.autor.nome} tamanho="p" />
					<span className="memoria__autor">{item.autor.nome}</span>
					<span aria-hidden="true">·</span>
				</>
			)}
			<time dateTime={new Date(item.data).toISOString()}>{quando(item.data)}</time>
		</>
	);
}

interface PropsLeitor {
	timeId: string;
	item: ItemMemoria;
	fechar(): void;
	celular: boolean;
}

/** Fetched once on opening: a change to the memory does not move what is being read. */
function Leitor({ timeId, item, fechar, celular }: PropsLeitor): ReactNode {
	const [texto, setTexto] = useState<string | null>(null);
	const [erro, setErro] = useState<string | null>(null);

	useEffect(() => {
		let vivo = true;
		void api<string>("GET", caminhoDaMemoria(timeId, `/arquivo?caminho=${encodeURIComponent(item.caminho)}`))
			.then(lido => {
				if (vivo) setTexto(lido);
			})
			.catch((err: unknown) => {
				if (vivo) setErro(err instanceof ErroApi ? err.message : String(err));
			});
		return () => {
			vivo = false;
		};
	}, [timeId, item.caminho]);

	useEffect(() => {
		const tecla = (evento: KeyboardEvent): void => {
			if (evento.key === "Escape") fechar();
		};
		addEventListener("keydown", tecla);
		return () => removeEventListener("keydown", tecla);
	}, [fechar]);

	return (
		<article className="memoria__leitor" aria-label={item.titulo}>
			<header className="memoria__leitor-topo">
				{celular && (
					<button type="button" className="icone" aria-label="Voltar" onClick={fechar}>
						←
					</button>
				)}
				<div className="memoria__leitor-quem">
					<h2 className="memoria__leitor-titulo">{item.titulo}</h2>
					<p className="memoria__quem">
						<Assinatura item={item} />
					</p>
				</div>
				{!celular && (
					<button type="button" className="icone icone--quieto" aria-label="Fechar" onClick={fechar}>
						✕
					</button>
				)}
			</header>
			<div className="memoria__texto">
				{erro ? (
					<p className="memoria__aviso">{erro}</p>
				) : texto === null ? (
					<p className="memoria__aviso" role="status">
						Abrindo
					</p>
				) : (
					<Markdown text={semFrontmatter(texto)} />
				)}
			</div>
		</article>
	);
}

/** The YAML on top is metadata (shown in the header), not the text. */
function semFrontmatter(texto: string): string {
	const achado = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(texto);
	return achado ? texto.slice(achado[0].length) : texto;
}

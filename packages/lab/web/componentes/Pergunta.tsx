// The ask card: the agent's pending question in the prompt box's place. A form (the `ask` tool's
// HTML) is read by formulario.ts into controlled inputs; a select or confirm is a list of options;
// input/editor a text box. The answer goes to POST /api/chats/:id/resposta.
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { api, caminhoDoChat, ErroApi } from "../lib/api";
import type { LabUiRequest } from "../tipos";
import {
	type Bloco,
	chaveOutra,
	dadosDoFormulario,
	type Estado,
	escolhaSozinha,
	type Formulario,
	lerFormulario,
} from "../chat/formulario";

interface Props {
	chatId: string;
	pedido: LabUiRequest;
	aoResponder(reqId: number): void;
}

export function Pergunta({ chatId, pedido, aoResponder }: Props): ReactNode {
	const [erro, setErro] = useState<string | null>(null);
	const [ocupado, setOcupado] = useState(false);

	const responder = async (valor: unknown): Promise<void> => {
		setOcupado(true);
		setErro(null);
		try {
			await api("POST", caminhoDoChat(chatId, "/resposta"), { reqId: pedido.rpcId, valor });
			aoResponder(pedido.reqId);
		} catch (err) {
			setErro(err instanceof ErroApi ? err.message : String(err));
		} finally {
			setOcupado(false);
		}
	};

	const dispensar = (
		<button type="button" className="link" disabled={ocupado} onClick={() => responder(null)}>
			Dispensar
		</button>
	);
	return (
		<section className="pergunta painel is-aberta" aria-label="Pergunta">
			<p className="rotulo">Pergunta</p>
			{pedido.title && pedido.kind !== "form" && <p className="pergunta__texto">{pedido.title}</p>}
			{pedido.kind === "form" && (
				<CorpoFormulario
					key={pedido.reqId}
					titulo={pedido.title}
					html={pedido.html}
					ocupado={ocupado}
					dispensar={dispensar}
					aoEnviar={responder}
				/>
			)}
			{pedido.kind === "select" && (
				<div className="pergunta__opcoes">
					{pedido.helpText && <p className="pergunta__ajuda">{pedido.helpText}</p>}
					{pedido.options.map((opcao, i) => {
						const rotulo = typeof opcao === "string" ? opcao : opcao.label;
						const descricao = typeof opcao === "string" ? undefined : opcao.description;
						return (
							<button
								key={rotulo}
								type="button"
								className="pergunta__opcao"
								disabled={ocupado}
								onClick={() => responder(pedido.method === "confirm" ? rotulo === "Sim" : rotulo)}
							>
								<span className="pergunta__marca">{i + 1}</span>
								<span>
									{rotulo}
									{descricao && <span className="pergunta__descricao">{descricao}</span>}
								</span>
							</button>
						);
					})}
				</div>
			)}
			{pedido.kind === "editor" && (
				<CorpoTexto
					key={pedido.reqId}
					inicial={pedido.prefill ?? ""}
					ocupado={ocupado}
					dispensar={dispensar}
					aoEnviar={responder}
				/>
			)}
			{erro && <p className="pergunta__erro">{erro}</p>}
			{pedido.kind === "select" && <div className="pergunta__pe">{dispensar}</div>}
		</section>
	);
}

function CorpoTexto({
	inicial,
	ocupado,
	dispensar,
	aoEnviar,
}: {
	inicial: string;
	ocupado: boolean;
	dispensar: ReactNode;
	aoEnviar(valor: string): void;
}): ReactNode {
	const [texto, setTexto] = useState(inicial);
	return (
		<form
			className="pergunta__form"
			onSubmit={e => {
				e.preventDefault();
				aoEnviar(texto);
			}}
		>
			<textarea
				className="pergunta__area"
				rows={3}
				value={texto}
				aria-label="Resposta"
				onChange={e => setTexto(e.target.value)}
			/>
			<div className="pergunta__pe">
				{dispensar}
				<button type="submit" className="botao" disabled={ocupado}>
					Responder
				</button>
			</div>
		</form>
	);
}

function CorpoFormulario({
	titulo,
	html,
	ocupado,
	dispensar,
	aoEnviar,
}: {
	titulo: string;
	html: string;
	ocupado: boolean;
	dispensar: ReactNode;
	aoEnviar(valor: unknown): void;
}): ReactNode {
	const form = useMemo<Formulario>(() => lerFormulario(html), [html]);
	const [estado, setEstado] = useState<Estado>(form.inicial);
	// The ask tool's title is often the form's own first question: say it once.
	const primeiro = form.blocos[0];
	const repete =
		(primeiro?.t === "grupo" && primeiro.legenda === titulo) ||
		(primeiro?.t === "texto" && primeiro.texto === titulo);
	return (
		<form
			className="pergunta__form"
			onSubmit={e => {
				e.preventDefault();
				aoEnviar(dadosDoFormulario(form, estado));
			}}
		>
			{titulo && !repete && <p className="pergunta__texto">{titulo}</p>}
			<Blocos blocos={form.blocos} estado={estado} mudar={setEstado} />
			<div className="pergunta__pe">
				{dispensar}
				<button type="submit" className="botao" disabled={ocupado}>
					Responder
				</button>
			</div>
		</form>
	);
}

interface BlocosProps {
	blocos: readonly Bloco[];
	estado: Estado;
	mudar(fn: (antes: Estado) => Estado): void;
}

function Blocos({ blocos, estado, mudar }: BlocosProps): ReactNode {
	const marcar = (nome: string, valores: string[]): void =>
		mudar(antes => ({ ...antes, marcados: { ...antes.marcados, [nome]: valores } }));
	const escrever = (chave: string, texto: string): void =>
		mudar(antes => ({ ...antes, textos: { ...antes.textos, [chave]: texto } }));

	return blocos.map((bloco, i) => {
		switch (bloco.t) {
			case "texto":
				if (bloco.estilo === "pre")
					return (
						<pre key={i} className="pergunta__detalhe">
							{bloco.texto}
						</pre>
					);
				return (
					<p key={i} className={`pergunta__p pergunta__p--${bloco.estilo}`}>
						{bloco.texto}
					</p>
				);
			case "imagem":
				return <img key={i} className="pergunta__imagem" src={bloco.src} alt={bloco.alt} />;
			case "grupo":
				return (
					<fieldset key={i} className="pergunta__grupo">
						{bloco.legenda && <legend className="pergunta__legenda">{bloco.legenda}</legend>}
						<Blocos blocos={bloco.blocos} estado={estado} mudar={mudar} />
					</fieldset>
				);
			case "escolha": {
				const marcados = estado.marcados[bloco.nome] ?? [];
				const sozinha = escolhaSozinha(bloco);
				const outra = estado.textos[chaveOutra(bloco.nome)] ?? "";
				return (
					<div key={i} className="pergunta__opcoes" role={bloco.multipla ? "group" : "radiogroup"}>
						{bloco.opcoes.map((opcao, n) => {
							const marcada = marcados.includes(opcao.valor);
							return (
								<button
									key={opcao.valor}
									type="button"
									role={bloco.multipla ? "checkbox" : "radio"}
									aria-checked={marcada}
									className={`pergunta__opcao${marcada ? " is-marcada" : ""}`}
									disabled={opcao.desativada}
									onClick={() => {
										if (bloco.multipla) {
											marcar(
												bloco.nome,
												marcada ? marcados.filter(v => v !== opcao.valor) : [...marcados, opcao.valor],
											);
										} else {
											marcar(bloco.nome, [opcao.valor]);
											escrever(chaveOutra(bloco.nome), "");
										}
									}}
								>
									<span className="pergunta__marca">{n + 1}</span>
									<span>{opcao.rotulo}</span>
								</button>
							);
						})}
						{!sozinha && (
							<input
								className={`pergunta__outra${outra.trim() ? " is-marcada" : ""}`}
								placeholder="Outra"
								aria-label="Outra resposta"
								value={outra}
								onChange={e => {
									escrever(chaveOutra(bloco.nome), e.target.value);
									if (!bloco.multipla && e.target.value.trim()) marcar(bloco.nome, []);
								}}
							/>
						)}
					</div>
				);
			}
			case "lista":
				return (
					<label key={i} className="campo">
						{bloco.rotulo && <span className="rotulo-campo">{bloco.rotulo}</span>}
						<select
							multiple={bloco.multipla}
							value={
								bloco.multipla ? (estado.marcados[bloco.nome] ?? []) : (estado.marcados[bloco.nome]?.[0] ?? "")
							}
							onChange={e =>
								marcar(
									bloco.nome,
									[...e.target.selectedOptions].map(opcao => opcao.value),
								)
							}
						>
							{bloco.opcoes.map(opcao => (
								<option key={opcao.valor} value={opcao.valor} disabled={opcao.desativada}>
									{opcao.rotulo}
								</option>
							))}
						</select>
					</label>
				);
			case "campo":
				return (
					<label key={i} className="campo">
						{bloco.rotulo && <span className="rotulo-campo">{bloco.rotulo}</span>}
						{bloco.tipo === "textarea" ? (
							<textarea
								rows={3}
								value={estado.textos[bloco.nome] ?? ""}
								placeholder={bloco.placeholder}
								required={bloco.obrigatorio}
								onChange={e => escrever(bloco.nome, e.target.value)}
							/>
						) : (
							<input
								type={bloco.tipo}
								value={estado.textos[bloco.nome] ?? ""}
								placeholder={bloco.placeholder}
								required={bloco.obrigatorio}
								min={bloco.min}
								max={bloco.max}
								pattern={bloco.pattern}
								onChange={e => escrever(bloco.nome, e.target.value)}
							/>
						)}
					</label>
				);
			default:
				return null;
		}
	});
}

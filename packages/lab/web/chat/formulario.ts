// The `ask` tool's HTML form, read safely: DOMParser turns it into a small model of blocks (text,
// pictures, choice groups, fields) that React renders as controlled inputs. Nothing of the HTML is
// injected; scripts, styles, buttons and event attributes never get past the model.

export type ValorForm = string | number | string[];
export type DadosForm = Record<string, ValorForm>;

export interface Opcao {
	valor: string;
	rotulo: string;
	desativada: boolean;
}

export type Bloco =
	| { t: "texto"; estilo: "p" | "titulo" | "pre" | "item"; texto: string }
	| { t: "imagem"; src: string; alt: string }
	| { t: "grupo"; legenda: string; blocos: Bloco[] }
	| { t: "escolha"; nome: string; multipla: boolean; opcoes: Opcao[] }
	| { t: "lista"; nome: string; rotulo: string; multipla: boolean; opcoes: Opcao[] }
	| {
			t: "campo";
			nome: string;
			tipo: "text" | "number" | "date" | "email" | "url" | "textarea";
			rotulo: string;
			placeholder: string;
			obrigatorio: boolean;
			min?: string;
			max?: string;
			pattern?: string;
	  };

export interface Formulario {
	blocos: Bloco[];
	/** What the form holds before any answer (checked/selected/value). */
	inicial: Estado;
}

/** The form's state while answering: by control name. */
export interface Estado {
	/** Choice groups and lists: the checked values. */
	marcados: Record<string, string[]>;
	/** Free text of a choice group's "Outra" answer, and every text field. */
	textos: Record<string, string>;
}

const TIPOS_CAMPO: Record<string, "text" | "number" | "date" | "email" | "url"> = {
	text: "text",
	search: "text",
	tel: "text",
	number: "number",
	date: "date",
	email: "email",
	url: "url",
};
const IGNORAR: Record<string, true> = {
	SCRIPT: true,
	STYLE: true,
	BUTTON: true,
	TEMPLATE: true,
	IFRAME: true,
	OBJECT: true,
	EMBED: true,
	LINK: true,
	META: true,
};
const BLOCOS_TEXTO: Record<string, "p" | "titulo" | "pre"> = {
	P: "p",
	H1: "titulo",
	H2: "titulo",
	H3: "titulo",
	H4: "titulo",
	H5: "titulo",
	H6: "titulo",
	PRE: "pre",
	BLOCKQUOTE: "p",
};

const espacos = (texto: string): string => texto.replace(/\s+/g, " ").trim();

/** A label's own words: its text without the controls' (a select's options). */
function textoDoRotulo(rotulo: Element): string {
	const copia = rotulo.cloneNode(true) as Element; // cloneNode of an Element is an Element
	for (const controle of copia.querySelectorAll("select, textarea, img, svg")) controle.remove();
	return espacos(copia.textContent ?? "");
}

function srcSegura(src: string | null): string | null {
	if (!src) return null;
	if (/^https?:\/\//i.test(src) || /^data:image\//i.test(src)) return src;
	return null;
}

export function lerFormulario(html: string): Formulario {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const raiz = doc.querySelector("form") ?? doc.body;
	const inicial: Estado = { marcados: {}, textos: {} };
	const escolhas = new Map<string, Extract<Bloco, { t: "escolha" }>>();
	const usados = new Set<Element>();

	const controle = (el: Element, rotulo: string, destino: Bloco[]): void => {
		usados.add(el);
		const nome = el.getAttribute("name");
		// A disabled option still shows (dimmed); a disabled field is never submitted.
		const tipoInput = el.tagName === "INPUT" ? (el.getAttribute("type") ?? "text").toLowerCase() : null;
		const opcaoDeEscolha = tipoInput === "radio" || tipoInput === "checkbox";
		if (!nome || (el.hasAttribute("disabled") && !opcaoDeEscolha)) return;
		if (el.tagName === "SELECT") {
			const multipla = el.hasAttribute("multiple");
			const opcoes: Opcao[] = [];
			const marcados: string[] = [];
			for (const opcao of el.querySelectorAll("option")) {
				const valor = opcao.getAttribute("value") ?? espacos(opcao.textContent ?? "");
				opcoes.push({
					valor,
					rotulo: espacos(opcao.textContent ?? "") || valor,
					desativada: opcao.hasAttribute("disabled"),
				});
				if (opcao.hasAttribute("selected")) marcados.push(valor);
			}
			if (!multipla && marcados.length === 0 && opcoes[0]) marcados.push(opcoes[0].valor);
			inicial.marcados[nome] = multipla ? marcados : marcados.slice(-1);
			destino.push({ t: "lista", nome, rotulo, multipla, opcoes });
			return;
		}
		if (el.tagName === "TEXTAREA") {
			inicial.textos[nome] = el.textContent ?? "";
			destino.push({
				t: "campo",
				nome,
				tipo: "textarea",
				rotulo,
				placeholder: el.getAttribute("placeholder") ?? "",
				obrigatorio: el.hasAttribute("required"),
			});
			return;
		}
		const tipo = (el.getAttribute("type") ?? "text").toLowerCase();
		if (tipo === "radio" || tipo === "checkbox") {
			const valor = el.getAttribute("value") ?? "on";
			let grupo = escolhas.get(nome);
			if (!grupo) {
				grupo = { t: "escolha", nome, multipla: tipo === "checkbox", opcoes: [] };
				escolhas.set(nome, grupo);
				destino.push(grupo);
				inicial.marcados[nome] = [];
			}
			grupo.opcoes.push({ valor, rotulo: rotulo || valor, desativada: el.hasAttribute("disabled") });
			if (el.hasAttribute("checked")) {
				inicial.marcados[nome] = grupo.multipla ? [...(inicial.marcados[nome] ?? []), valor] : [valor];
			}
			return;
		}
		if (tipo === "hidden" || tipo === "submit" || tipo === "button" || tipo === "reset" || tipo === "image") return;
		inicial.textos[nome] = el.getAttribute("value") ?? "";
		destino.push({
			t: "campo",
			nome,
			tipo: TIPOS_CAMPO[tipo] ?? "text",
			rotulo,
			placeholder: el.getAttribute("placeholder") ?? "",
			obrigatorio: el.hasAttribute("required"),
			min: el.getAttribute("min") ?? undefined,
			max: el.getAttribute("max") ?? undefined,
			pattern: el.getAttribute("pattern") ?? undefined,
		});
	};

	const andar = (no: Node, destino: Bloco[]): void => {
		for (const filho of no.childNodes) {
			if (filho.nodeType === Node.TEXT_NODE) {
				const texto = espacos(filho.textContent ?? "");
				if (texto) destino.push({ t: "texto", estilo: "p", texto });
				continue;
			}
			// Inline <svg> (another namespace) is not drawn: its markup never reaches the page.
			if (!(filho instanceof HTMLElement) || IGNORAR[filho.tagName] || usados.has(filho)) continue;
			const tag = filho.tagName;
			const estilo = BLOCOS_TEXTO[tag];
			if (estilo && !filho.querySelector("input, select, textarea")) {
				const texto =
					estilo === "pre" ? (filho.textContent ?? "").replace(/^\n|\n$/g, "") : espacos(filho.textContent ?? "");
				if (texto) destino.push({ t: "texto", estilo, texto });
				continue;
			}
			switch (tag) {
				case "FIELDSET": {
					const legenda = filho.querySelector(":scope > legend");
					const grupo: Extract<Bloco, { t: "grupo" }> = {
						t: "grupo",
						legenda: espacos(legenda?.textContent ?? ""),
						blocos: [],
					};
					if (legenda) usados.add(legenda);
					destino.push(grupo);
					andar(filho, grupo.blocos);
					break;
				}
				case "LABEL": {
					const alvo =
						filho.querySelector("input, select, textarea") ??
						(filho.getAttribute("for") ? doc.getElementById(filho.getAttribute("for") ?? "") : null);
					if (alvo) controle(alvo, textoDoRotulo(filho), destino);
					else {
						const texto = espacos(filho.textContent ?? "");
						if (texto) destino.push({ t: "texto", estilo: "p", texto });
					}
					break;
				}
				case "INPUT":
				case "SELECT":
				case "TEXTAREA": {
					const id = filho.getAttribute("id");
					const rotulo = id ? raiz.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
					controle(filho, rotulo ? textoDoRotulo(rotulo) : (filho.getAttribute("aria-label") ?? ""), destino);
					break;
				}
				case "IMG": {
					const src = srcSegura(filho.getAttribute("src"));
					const alt = filho.getAttribute("alt") ?? "";
					if (src) destino.push({ t: "imagem", src, alt });
					else if (alt) destino.push({ t: "texto", estilo: "p", texto: alt });
					break;
				}
				case "LI": {
					if (filho.querySelector("input, select, textarea")) andar(filho, destino);
					else {
						const texto = espacos(filho.textContent ?? "");
						if (texto) destino.push({ t: "texto", estilo: "item", texto });
					}
					break;
				}
				case "TR": {
					const celulas = [...filho.children].map(celula => espacos(celula.textContent ?? "")).filter(Boolean);
					if (celulas.length > 0) destino.push({ t: "texto", estilo: "item", texto: celulas.join(" · ") });
					break;
				}
				case "LEGEND":
					break;
				default:
					andar(filho, destino);
			}
		}
	};

	const blocos: Bloco[] = [];
	andar(raiz, blocos);
	return { blocos, inicial };
}

/** The checkbox name holds a single box: submitted as its value, not an array. */
export function escolhaSozinha(bloco: Extract<Bloco, { t: "escolha" }>): boolean {
	return bloco.multipla && bloco.opcoes.length === 1;
}

/** The answer as the server takes it (HtmlFormData): see the ask tool's "Answer values". */
export function dadosDoFormulario(form: Formulario, estado: Estado): DadosForm {
	const dados: DadosForm = {};
	const visitar = (blocos: readonly Bloco[]): void => {
		for (const bloco of blocos) {
			switch (bloco.t) {
				case "grupo":
					visitar(bloco.blocos);
					break;
				case "escolha": {
					const marcados = estado.marcados[bloco.nome] ?? [];
					const outra = (estado.textos[chaveOutra(bloco.nome)] ?? "").trim();
					if (escolhaSozinha(bloco)) {
						if (marcados[0] !== undefined) dados[bloco.nome] = marcados[0];
					} else if (bloco.multipla) {
						const valores = outra ? [...marcados, outra] : marcados;
						if (valores.length > 0) dados[bloco.nome] = valores;
					} else if (outra && marcados.length === 0) {
						dados[bloco.nome] = outra;
					} else if (marcados[0] !== undefined) {
						dados[bloco.nome] = marcados[0];
					}
					break;
				}
				case "lista": {
					const marcados = estado.marcados[bloco.nome] ?? [];
					if (bloco.multipla) dados[bloco.nome] = marcados;
					else if (marcados[0] !== undefined) dados[bloco.nome] = marcados[0];
					break;
				}
				case "campo": {
					const texto = estado.textos[bloco.nome] ?? "";
					if (bloco.tipo === "number") {
						if (texto.trim() !== "" && Number.isFinite(Number(texto))) dados[bloco.nome] = Number(texto);
					} else dados[bloco.nome] = texto;
					break;
				}
				default:
					break;
			}
		}
	};
	visitar(form.blocos);
	return dados;
}

/** The key of a choice group's "Outra" text in {@link Estado.textos}. */
export const chaveOutra = (nome: string): string => `${nome}\u0000outra`;

// Which laboratório this page shows: `/l/<id>/…` is that lab through the entry lab's proxy, anything
// else is the entry lab itself ("mac"). Every API call and the WebSocket go under its prefix. The
// last estado of each lab and the list of labs stay in this browser, for a lab that is down.
import type { Estado, ResumoLaboratorio } from "../tipos";

/** The entry lab (src/laboratorios.ts `ID_ENTRADA`): the page at `/`. */
export const ID_ENTRADA = "mac";

function labDoEndereco(): string {
	const achado = /^\/l\/([^/]+)/.exec(location.pathname);
	if (!achado?.[1]) return ID_ENTRADA;
	try {
		return decodeURIComponent(achado[1]);
	} catch {
		return ID_ENTRADA;
	}
}

export const LAB_DA_PAGINA = labDoEndereco();

const PREFIXO = LAB_DA_PAGINA === ID_ENTRADA ? "" : `/l/${encodeURIComponent(LAB_DA_PAGINA)}`;

/** `/api/…` and `/ws` of this page's lab. */
export function noLab(caminho: string): string {
	return PREFIXO + caminho;
}

/** Where a lab's page lives. */
export function enderecoDoLab(id: string): string {
	return id === ID_ENTRADA ? "/" : `/l/${encodeURIComponent(id)}/`;
}

const CHAVE_LISTA = "lab.laboratorios";
const CHAVE_ESTADO = `lab.estado.${LAB_DA_PAGINA}`;

function ler<T>(chave: string): T | null {
	try {
		const texto = localStorage.getItem(chave);
		return texto ? (JSON.parse(texto) as T) : null;
	} catch {
		return null;
	}
}

function gravar(chave: string, valor: unknown): void {
	try {
		localStorage.setItem(chave, JSON.stringify(valor));
	} catch {
		// Private mode or full storage: the page just has no memory of it.
	}
}

export const laboratoriosGuardados = (): ResumoLaboratorio[] | null => ler<ResumoLaboratorio[]>(CHAVE_LISTA);
export const guardarLaboratorios = (lista: ResumoLaboratorio[]): void => gravar(CHAVE_LISTA, lista);

/** This lab's last estado seen in this browser, without the people (they were there then). */
export const estadoGuardado = (): Estado | null => ler<Estado>(CHAVE_ESTADO);
export const guardarEstado = (estado: Estado): void =>
	gravar(CHAVE_ESTADO, { ...estado, pessoas: [] } satisfies Estado);

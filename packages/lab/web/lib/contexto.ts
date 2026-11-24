// What every screen shares: the connection, who you are, the open chat and how to open one.
import { createContext, useContext, useSyncExternalStore } from "react";
import type { Autor, Estado, ResumoChat, StatusChat } from "../tipos";
import type { Conexao, FotoConexao } from "./conexao";

export interface Lab {
	conexao: Conexao;
	eu: Autor | null;
	chatAberto: string | null;
	abrirChat(chatId: string | null): void;
	adicionarTime(): void;
}

export const LabContexto = createContext<Lab | null>(null);

export function useLab(): Lab {
	const lab = useContext(LabContexto);
	if (!lab) throw new Error("LabContexto ausente");
	return lab;
}

export function useConexao(conexao: Conexao): FotoConexao {
	return useSyncExternalStore(conexao.subscribe, conexao.getSnapshot);
}

export const ESTADO_VAZIO: Estado = { times: [], chats: [], pessoas: [], voz: null };

export const PALAVRA_DO_STATUS: Record<StatusChat, string> = {
	parado: "parado",
	livre: "livre",
	trabalhando: "trabalhando",
	esperando: "espera você",
	erro: "erro",
};

/** The status line under a name: the activity while working, the question while waiting. */
export function linhaDoChat(chat: ResumoChat): string {
	if (chat.status === "trabalhando") return chat.atividade ?? "trabalhando";
	if (chat.status === "erro") return chat.erro ? `erro · ${chat.erro}` : "erro";
	return PALAVRA_DO_STATUS[chat.status];
}

/** The last segment of a path (a folder's name). */
export function nomeDaPasta(caminho: string): string {
	const partes = caminho.replace(/\/+$/, "").split("/");
	return partes[partes.length - 1] || caminho;
}

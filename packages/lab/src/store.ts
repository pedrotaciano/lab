/**
 * Persistent lab state: `<casa>/estado.json` with teams and chat records.
 * Writes are serialized and atomic (temp file + rename).
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";
import type { Time } from "./tipos";

/** What survives a restart of one chat; the live summary comes from its process. */
export interface RegistroChat {
	id: string;
	timeId: string;
	nome: string;
	papel: string | null;
	/** omp session file, once the process reported it; `--resume` target. */
	sessionFile: string | null;
	criadoEm: number;
}

interface Arquivo {
	times: Time[];
	chats: RegistroChat[];
}

/** Lab home: `LAB_CASA`, else `~/.lab`. */
export function casaDoLab(): string {
	return path.resolve(Bun.env.LAB_CASA || path.join(os.homedir(), ".lab"));
}

export class Store {
	readonly #arquivo: string;
	#times: Time[] = [];
	#chats: RegistroChat[] = [];
	#gravando: Promise<void> = Promise.resolve();

	constructor(casa: string) {
		this.#arquivo = path.join(casa, "estado.json");
	}

	async carregar(): Promise<void> {
		let dados: Partial<Arquivo>;
		try {
			dados = (await Bun.file(this.#arquivo).json()) as Partial<Arquivo>;
		} catch (err) {
			if (isEnoent(err)) return;
			throw err;
		}
		this.#times = Array.isArray(dados.times) ? dados.times : [];
		const times = new Set(this.#times.map(time => time.id));
		this.#chats = (Array.isArray(dados.chats) ? dados.chats : []).filter(chat => times.has(chat.timeId));
	}

	get times(): readonly Time[] {
		return this.#times;
	}

	get chats(): readonly RegistroChat[] {
		return this.#chats;
	}

	time(id: string): Time | undefined {
		return this.#times.find(time => time.id === id);
	}

	chat(id: string): RegistroChat | undefined {
		return this.#chats.find(chat => chat.id === id);
	}

	/** The team of `pasta`, created when none exists (one team per folder). */
	criarTime(nome: string, pasta: string): Time {
		const existente = this.#times.find(time => time.pasta === pasta);
		if (existente) return existente;
		const time: Time = { id: novoId(), nome, pasta, criadoEm: Date.now() };
		this.#times.push(time);
		this.#salvar();
		return time;
	}

	removerTime(id: string): void {
		this.#times = this.#times.filter(time => time.id !== id);
		this.#chats = this.#chats.filter(chat => chat.timeId !== id);
		this.#salvar();
	}

	criarChat(timeId: string, nome: string, papel: string | null): RegistroChat {
		const chat: RegistroChat = { id: novoId(), timeId, nome, papel, sessionFile: null, criadoEm: Date.now() };
		this.#chats.push(chat);
		this.#salvar();
		return chat;
	}

	atualizarChat(id: string, mudanca: Partial<Pick<RegistroChat, "nome" | "papel" | "sessionFile">>): void {
		const chat = this.chat(id);
		if (!chat) return;
		Object.assign(chat, mudanca);
		this.#salvar();
	}

	removerChat(id: string): void {
		this.#chats = this.#chats.filter(chat => chat.id !== id);
		this.#salvar();
	}

	/** Resolves once every write queued so far reached the disk. */
	gravado(): Promise<void> {
		return this.#gravando;
	}

	#salvar(): void {
		const conteudo = `${JSON.stringify({ times: this.#times, chats: this.#chats } satisfies Arquivo, null, "\t")}\n`;
		this.#gravando = this.#gravando
			.then(async () => {
				const temporario = `${this.#arquivo}.${process.pid}.tmp`;
				await Bun.write(temporario, conteudo);
				await fs.rename(temporario, this.#arquivo);
			})
			.catch(err => logger.error("lab: failed to save state", { arquivo: this.#arquivo, error: String(err) }));
	}
}

function novoId(): string {
	return Bun.randomUUIDv7().replaceAll("-", "").slice(-12);
}

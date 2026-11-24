/**
 * Egregore teams. A team folder that is an Egregore instance (`egregore.json`, or listed in
 * `~/.egregore/instances.json`) shows its shared memory, read-only: the Markdown under `memory/`
 * by section, each file's author and date from the memory repo's history, the repo against its
 * `origin`, and Egregore's own sync (`bin/agent.sh sync`, what `egregore runtime sync` runs).
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { VcsGitRepo } from "@oh-my-pi/pi-natives";
import * as vcs from "@oh-my-pi/pi-natives/vcs";
import { isEnoent, logger, parseFrontmatter, ptree } from "@oh-my-pi/pi-utils";
import { ErroLab } from "./chat";
import type {
	EgregoreTime,
	ItemMemoria,
	MemoriaTime,
	SecaoMemoria,
	SecaoMemoriaId,
	SincroniaMemoria,
} from "./tipos";

/** Sections in the page's order: where Egregore writes each kind of record. */
const SECOES: readonly { id: SecaoMemoriaId; nome: string; pasta: string }[] = [
	{ id: "handoffs", nome: "Handoffs", pasta: "handoffs" },
	{ id: "decisoes", nome: "Decisões", pasta: "knowledge/decisions" },
	{ id: "descobertas", nome: "Descobertas", pasta: "knowledge/findings" },
	{ id: "padroes", nome: "Padrões", pasta: "knowledge/patterns" },
	{ id: "perguntas", nome: "Perguntas", pasta: "knowledge/questions" },
	{ id: "quests", nome: "Quests", pasta: "quests" },
	{ id: "wraps", nome: "Wraps", pasta: "wraps" },
	{ id: "pessoas", nome: "Pessoas", pasta: "people" },
	{ id: "identidade", nome: "Identidade", pasta: "identity" },
];

/** Ledgers and folder notes, not records (`handoffs/index.md`, `README.md`). */
const NAO_SAO_REGISTROS: Record<string, true> = { "index.md": true, "readme.md": true };
const ESPERA_AVISO_MS = 400;
/** A `GET /sincronia` fetches `origin` at most this often. */
const INTERVALO_BUSCA_MS = 60_000;
const LIMITE_BUSCA_MS = 30_000;
const LIMITE_SYNC_MS = 300_000;
const PARALELO_GIT = 8;
const PRIMEIRA_LINHA_MAX = 240;

const REGISTRO_EGREGORE = path.join(os.homedir(), ".egregore", "instances.json");

interface Configuracao {
	org_name?: unknown;
	github_org?: unknown;
	repo_name?: unknown;
	memory_repo?: unknown;
}

/** The Egregore instance at `pasta`, or null. */
export async function detectarEgregore(pasta: string): Promise<EgregoreTime | null> {
	const memoria = path.join(pasta, "memory");
	const config = await lerJson<Configuracao>(path.join(pasta, "egregore.json"));
	if (config && typeof config.org_name === "string" && config.org_name.trim()) {
		return { org: config.org_name.trim(), memoria };
	}
	const registro = await lerJson<unknown>(REGISTRO_EGREGORE);
	if (Array.isArray(registro)) {
		const real = await fsp.realpath(pasta).catch(() => pasta);
		for (const entrada of registro as { path?: unknown; name?: unknown }[]) {
			if (typeof entrada?.path !== "string") continue;
			const caminho = await fsp.realpath(entrada.path).catch(() => entrada.path as string);
			if (caminho !== real) continue;
			const nome = typeof entrada.name === "string" && entrada.name.trim() ? entrada.name.trim() : null;
			return { org: nome ?? path.basename(pasta), memoria };
		}
	}
	return config ? { org: path.basename(pasta), memoria } : null;
}

async function lerJson<T>(arquivo: string): Promise<T | null> {
	try {
		return (await Bun.file(arquivo).json()) as T;
	} catch {
		return null;
	}
}

interface Leitura {
	mtimeMs: number;
	size: number;
	titulo: string;
	primeiraLinha: string;
	/** Frontmatter date (created_at / date), epoch ms. */
	dataDeclarada: number | null;
	/** Title and text, folded for search. */
	busca: string;
}

interface Autoria {
	autor: { nome: string; login?: string };
	email: string;
	data: number;
}

/** One Egregore team's memory. */
export class MemoriaEgregore {
	readonly info: EgregoreTime;
	readonly #pasta: string;
	readonly #aoMudar: () => void;
	readonly #leituras = new Map<string, Leitura>();
	/** Path inside the repo → its first commit; cleared when local history moves, uncommitted files never kept. */
	readonly #autorias = new Map<string, Autoria>();
	#raiz: string | null = null;
	#vigia: fs.FSWatcher | null = null;
	#timerAviso: NodeJS.Timeout | undefined;
	#ultimaBusca = 0;
	#busca: Promise<void> | null = null;
	#sincronizando: Promise<void> | null = null;
	#erro: string | null = null;

	constructor(pasta: string, info: EgregoreTime, aoMudar: () => void) {
		this.#pasta = pasta;
		this.info = info;
		this.#aoMudar = aoMudar;
	}

	/** (Re)check that `memory/` is here; watch it while it is. */
	async verificar(): Promise<void> {
		const raiz = await fsp.realpath(this.info.memoria).catch(() => null);
		const ehPasta = raiz ? await fsp.stat(raiz).then(s => s.isDirectory(), () => false) : false;
		const nova = ehPasta ? raiz : null;
		if (nova === this.#raiz) return;
		this.#vigia?.close();
		this.#vigia = null;
		this.#raiz = nova;
		this.#leituras.clear();
		this.#autorias.clear();
		if (nova) this.#vigiar(nova);
		this.#avisar();
	}

	fechar(): void {
		clearTimeout(this.#timerAviso);
		this.#vigia?.close();
		this.#vigia = null;
	}

	async listar(consulta: string): Promise<MemoriaTime> {
		const raiz = this.#raiz;
		if (!raiz) return { presente: false, comando: await this.#comandoParaTrazer(), secoes: [] };
		const repo = gitDaMemoria(raiz);
		const meuEmail = repo ? ((await repo.configGet("user.email").catch(() => null)) ?? "").toLowerCase() : "";
		const pessoas = await this.#loginsPorEmail(raiz);
		// The same person commits from several addresses (`login@…` and `id+login@users.noreply…`).
		const meuLogin = loginDoGithub(meuEmail) ?? pessoas.get(meuEmail);
		const termo = dobrar(consulta.trim());
		const secoes: SecaoMemoria[] = [];
		for (const secao of SECOES) {
			const arquivos = await arquivosMarkdown(raiz, secao.pasta);
			const leituras = await Promise.all(arquivos.map(caminho => this.#ler(raiz, caminho)));
			const autorias = await mapearLimitado(arquivos, PARALELO_GIT, caminho =>
				repo ? this.#autoria(repo, caminho) : Promise.resolve(null),
			);
			const itens: ItemMemoria[] = [];
			for (let i = 0; i < arquivos.length; i++) {
				const leitura = leituras[i];
				if (!leitura || (termo && !leitura.busca.includes(termo))) continue;
				const autoria = autorias[i] ?? null;
				const login = autoria?.autor.login ?? pessoas.get(autoria?.email ?? "");
				itens.push({
					caminho: arquivos[i]!,
					titulo: leitura.titulo,
					autor: autoria ? (login ? { nome: autoria.autor.nome, login } : { nome: autoria.autor.nome }) : null,
					data: autoria?.data ?? leitura.dataDeclarada ?? leitura.mtimeMs,
					primeiraLinha: leitura.primeiraLinha,
					meu:
						autoria !== null &&
						meuEmail !== "" &&
						(autoria.email === meuEmail || (meuLogin !== undefined && login === meuLogin)),
				});
			}
			itens.sort((a, b) => b.data - a.data || a.caminho.localeCompare(b.caminho));
			secoes.push({ id: secao.id, nome: secao.nome, itens });
		}
		return { presente: true, comando: null, secoes };
	}

	/** A Markdown file inside `memory/`: relative, `.md`, and resolving (symlinks too) inside it. */
	async arquivo(caminho: string): Promise<string> {
		const raiz = this.#raiz;
		if (!raiz) throw new ErroLab(404, "a memória não está nesta máquina");
		const limpo = path.posix.normalize(caminho.replaceAll("\\", "/"));
		if (
			!caminho ||
			path.isAbsolute(caminho) ||
			limpo.startsWith("../") ||
			limpo === ".." ||
			limpo.split("/").includes(".git") ||
			!limpo.toLowerCase().endsWith(".md")
		) {
			throw new ErroLab(400, "caminho inválido");
		}
		const real = await fsp.realpath(path.join(raiz, limpo)).catch(() => null);
		if (!real) throw new ErroLab(404, "arquivo não encontrado");
		if (!real.startsWith(raiz + path.sep)) throw new ErroLab(400, "caminho inválido");
		return await Bun.file(real).text();
	}

	/** Ahead/behind `origin`; fetches it when the last fetch is older than a minute. */
	async sincronia(): Promise<SincroniaMemoria> {
		if (!this.#sincronizando && Date.now() - this.#ultimaBusca > INTERVALO_BUSCA_MS) {
			this.#busca ??= this.#buscar().finally(() => {
				this.#busca = null;
			});
			await this.#busca;
		}
		return this.#contar();
	}

	/** Egregore's sync (`bin/agent.sh sync`: pull --rebase, push what is ahead, refresh the index). */
	async sincronizar(): Promise<SincroniaMemoria> {
		if (!this.#raiz) throw new ErroLab(409, "a memória não está nesta máquina");
		if (!this.#sincronizando) {
			this.#sincronizando = this.#rodarSync().finally(() => {
				this.#sincronizando = null;
				this.#avisar();
			});
			this.#avisar();
		}
		await this.#sincronizando;
		return this.#contar();
	}

	// ── internals ───────────────────────────────────────────────────────────

	#vigiar(raiz: string): void {
		try {
			this.#vigia = fs.watch(raiz, { recursive: true }, (_evento, nome) => {
				const relativo = typeof nome === "string" ? nome.replaceAll("\\", "/") : "";
				// Inside .git only what moves a branch (a commit, a fetch, a pull) matters.
				if (relativo.startsWith(".git/") || relativo === ".git") {
					if (!/^\.git\/(HEAD|packed-refs|refs\/)/.test(relativo)) return;
					// A rebase or reset rewrites first commits; a fetch (refs/remotes) does not.
					if (!relativo.startsWith(".git/refs/remotes/")) this.#autorias.clear();
				}
				this.#avisar();
			});
			this.#vigia.on("error", err => {
				logger.warn("lab: memory watch failed", { raiz, error: String(err) });
				this.#vigia?.close();
				this.#vigia = null;
			});
		} catch (err) {
			logger.warn("lab: cannot watch memory", { raiz, error: String(err) });
		}
	}

	#avisar(): void {
		clearTimeout(this.#timerAviso);
		this.#timerAviso = setTimeout(() => this.#aoMudar(), ESPERA_AVISO_MS);
	}

	async #ler(raiz: string, caminho: string): Promise<Leitura | null> {
		const arquivo = path.join(raiz, caminho);
		const info = await fsp.lstat(arquivo).catch(() => null);
		// A symlink could point out of memory/: not listed (`arquivo()` checks where it lands).
		if (!info?.isFile()) return null;
		const guardada = this.#leituras.get(caminho);
		if (guardada && guardada.mtimeMs === info.mtimeMs && guardada.size === info.size) return guardada;
		const texto = await Bun.file(arquivo)
			.text()
			.catch(() => null);
		if (texto === null) return null;
		const leitura: Leitura = { mtimeMs: info.mtimeMs, size: info.size, ...resumir(texto, caminho) };
		this.#leituras.set(caminho, leitura);
		return leitura;
	}

	async #autoria(repo: VcsGitRepo, caminho: string): Promise<Autoria | null> {
		const guardada = this.#autorias.get(caminho);
		if (guardada) return guardada;
		try {
			const commits = await repo.revListTouching("HEAD", caminho, 100_000);
			const primeiro = commits.at(-1);
			if (!primeiro) return null;
			const { author } = await repo.commitDetails(primeiro);
			const email = author.email.toLowerCase();
			const login = loginDoGithub(email);
			const data = author.date ? Date.parse(author.date) : Number.NaN;
			const autoria: Autoria = {
				autor: login ? { nome: author.name || login, login } : { nome: author.name || email },
				email,
				data: Number.isFinite(data) ? data : Date.now(),
			};
			this.#autorias.set(caminho, autoria);
			return autoria;
		} catch {
			return null;
		}
	}

	/** `memory/people/*.md` name each person's `GitHub:` login and `Email:`/`Emails:`. */
	async #loginsPorEmail(raiz: string): Promise<Map<string, string>> {
		const mapa = new Map<string, string>();
		for (const caminho of await arquivosMarkdown(raiz, "people")) {
			const texto = await Bun.file(path.join(raiz, caminho))
				.text()
				.catch(() => "");
			const login = /^GitHub:[ \t]*(\S+)/m.exec(texto)?.[1];
			if (!login) continue;
			for (const linha of texto.matchAll(/^Emails?:[ \t]*(.*)$/gm)) {
				for (const email of (linha[1] ?? "").split(/[,\s]+/)) {
					if (email.includes("@")) mapa.set(email.toLowerCase(), login);
				}
			}
		}
		return mapa;
	}

	async #buscar(): Promise<void> {
		const raiz = this.#raiz;
		const repo = raiz ? gitDaMemoria(raiz) : null;
		this.#ultimaBusca = Date.now();
		if (!repo) return;
		const ramo = await repo.currentBranch().catch(() => null);
		if (!ramo || !(await repo.remoteUrl("origin").catch(() => null))) return;
		try {
			await repo.fetch("origin", `refs/heads/${ramo}`, `refs/remotes/origin/${ramo}`, LIMITE_BUSCA_MS);
			this.#erro = null;
		} catch (err) {
			this.#erro = motivoGit(err);
		}
	}

	async #rodarSync(): Promise<void> {
		const raiz = this.#raiz!;
		const agente = path.join(this.#pasta, "bin", "agent.sh");
		if (await Bun.file(agente).exists()) {
			const resultado = await ptree
				.exec(["bash", agente, "sync"], { cwd: this.#pasta, allowNonZero: true, timeout: LIMITE_SYNC_MS })
				.catch((err: unknown) => ({ ok: false, stdout: "", stderr: String(err) }));
			this.#erro = resultado.ok ? null : motivo(`${resultado.stdout}\n${resultado.stderr}`);
		} else {
			this.#erro = await puxarSoAvancando(raiz);
		}
		this.#ultimaBusca = Date.now();
		this.#autorias.clear();
	}

	async #contar(): Promise<SincroniaMemoria> {
		const base = { atras: 0, frente: 0, sincronizando: this.#sincronizando !== null };
		const comErro = (s: SincroniaMemoria): SincroniaMemoria => (this.#erro ? { ...s, erro: this.#erro } : s);
		const repo = this.#raiz ? gitDaMemoria(this.#raiz) : null;
		if (!repo) return comErro(base);
		const ramo = await repo.currentBranch().catch(() => null);
		const remoto = ramo ? `refs/remotes/origin/${ramo}` : null;
		if (!remoto || !(await repo.refExists(remoto).catch(() => false))) return comErro(base);
		const [atras, frente] = await Promise.all([
			repo.revListRange("HEAD", remoto).catch(() => []),
			repo.revListRange(remoto, "HEAD").catch(() => []),
		]);
		return comErro({ ...base, atras: atras.length, frente: frente.length });
	}

	/** Linked from a sibling clone (`bin/pull.sh` does it), else the clone comes with `join`. */
	async #comandoParaTrazer(): Promise<string> {
		const config = (await lerJson<Configuracao>(path.join(this.#pasta, "egregore.json"))) ?? {};
		const repoMemoria = typeof config.memory_repo === "string" ? config.memory_repo : "";
		const irmao = repoMemoria ? path.join(path.dirname(this.#pasta), path.basename(repoMemoria, ".git")) : "";
		if (irmao && (await fsp.stat(path.join(irmao, ".git")).catch(() => null))) return "bash bin/pull.sh";
		const org = typeof config.github_org === "string" ? config.github_org : "";
		const repo = typeof config.repo_name === "string" ? config.repo_name : path.basename(this.#pasta);
		return `npx -y create-egregore@latest join ${org ? `${org}/${repo}` : repo}`;
	}
}

/** The memory's own repo (a separate clone), never the instance's around it. */
function gitDaMemoria(raiz: string): VcsGitRepo | null {
	const repo = vcs.git(raiz);
	return repo && repo.info().repoRoot === raiz ? repo : null;
}

/** `git pull --ff-only` for an instance without `bin/agent.sh`; the failure's reason, or null. */
async function puxarSoAvancando(raiz: string): Promise<string | null> {
	const repo = gitDaMemoria(raiz);
	if (!repo) return "a memória não é um repositório git";
	try {
		const ramo = await repo.currentBranch();
		if (!ramo) return "a memória está fora de um ramo";
		const remoto = `refs/remotes/origin/${ramo}`;
		await repo.fetch("origin", `refs/heads/${ramo}`, remoto, LIMITE_BUSCA_MS);
		const cabeca = await repo.headSha();
		const alvo = await repo.resolveRef(remoto);
		if (!alvo || alvo === cabeca) return null;
		if (cabeca && (await repo.mergeBase(cabeca, alvo)) !== cabeca) return "a memória local divergiu do time";
		await repo.reset("keep", alvo);
		return null;
	} catch (err) {
		return motivoGit(err);
	}
}

/** Markdown records under `memory/<pasta>`, relative to `memory/`, without following symlinked folders. */
async function arquivosMarkdown(raiz: string, pasta: string): Promise<string[]> {
	const dir = path.join(raiz, pasta);
	const info = await fsp.lstat(dir).catch(() => null);
	if (!info?.isDirectory()) return [];
	const achados: string[] = [];
	try {
		for await (const relativo of new Bun.Glob("**/*.md").scan({ cwd: dir, followSymlinks: false, dot: false })) {
			if (NAO_SAO_REGISTROS[path.basename(relativo).toLowerCase()]) continue;
			achados.push(path.posix.join(pasta, relativo.replaceAll("\\", "/")));
		}
	} catch (err) {
		if (!isEnoent(err)) throw err;
	}
	return achados;
}

/** Title (frontmatter `title`/`topic`, else the first heading, else the name), first line, date. */
function resumir(texto: string, caminho: string): Omit<Leitura, "mtimeMs" | "size"> {
	const { frontmatter, body } = parseFrontmatter(texto, { level: "off", rawKeys: true });
	const campo = (nome: string): string | null => {
		const valor = frontmatter[nome];
		return typeof valor === "string" && valor.trim() ? valor.trim() : valor instanceof Date ? valor.toISOString() : null;
	};
	let titulo = campo("title") ?? campo("topic");
	let primeiraLinha = "";
	for (const bruta of body.split("\n")) {
		const linha = bruta.trim();
		if (!linha || linha === "---") continue;
		const cabecalho = /^#{1,6}\s+(.*)$/.exec(linha);
		if (cabecalho) {
			titulo ??= limparMarkdown(cabecalho[1] ?? "");
			continue;
		}
		primeiraLinha = limparMarkdown(linha).slice(0, PRIMEIRA_LINHA_MAX);
		break;
	}
	titulo ||= path.basename(caminho, ".md");
	const declarada = campo("created_at") ?? campo("date");
	const data = declarada ? Date.parse(declarada) : Number.NaN;
	return {
		titulo,
		primeiraLinha,
		dataDeclarada: Number.isFinite(data) ? data : null,
		busca: dobrar(`${titulo}\n${body}`),
	};
}

/** The line as plain text: list/quote markers, links and emphasis go; code spans stay as written. */
function limparMarkdown(linha: string): string {
	return linha
		.replace(/^(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/^>\s*/, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.split("`")
		.map((parte, i) =>
			i % 2 === 1
				? parte
				: parte
						.replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
						.replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=[\s).,;:!?]|$)/g, "$1$3"),
		)
		.join("")
		.trim();
}

/** Lowercase without accents, so "decisao" finds "Decisão". */
function dobrar(texto: string): string {
	return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** `12345+login@users.noreply.github.com` → `login`. */
function loginDoGithub(email: string): string | undefined {
	return /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email)?.[1];
}

/** The reason in a failure's output: Egregore's `failure:` line, else git's first `fatal:`/`error:`, else the last line. */
function motivo(texto: string): string {
	const linhas = texto
		.split("\n")
		.map(linha => linha.trim())
		.filter(Boolean);
	const linha =
		linhas.find(l => l.startsWith("failure:")) ?? linhas.find(l => /^(fatal|error):/i.test(l)) ?? linhas.at(-1) ?? "";
	return linha.replace(/^failure:\s*/, "").replace(/\b(fatal|error):\s*/gi, "") || "falhou";
}

function motivoGit(err: unknown): string {
	const erro = err as { stderr?: unknown; message?: unknown } | null;
	return motivo(typeof erro?.stderr === "string" && erro.stderr.trim() ? erro.stderr : String(erro?.message ?? err));
}

async function mapearLimitado<T, R>(itens: readonly T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const resultados = new Array<R>(itens.length);
	let proximo = 0;
	const trabalhar = async (): Promise<void> => {
		while (proximo < itens.length) {
			const i = proximo++;
			resultados[i] = await fn(itens[i]!);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhar));
	return resultados;
}

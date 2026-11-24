#!/usr/bin/env bun
/**
 * `lab [--port 4300] [--host 127.0.0.1] [--no-abrir]`: one lab server per home
 * (`LAB_CASA`, default `~/.lab`). A second start just points at the running one.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { isPidAlive } from "@oh-my-pi/pi-utils";
import { Laboratorio } from "./server";
import { casaDoLab } from "./store";

interface RegistroServidor {
	pid: number;
	port: number;
	host: string;
	url: string;
}

const { values } = parseArgs({
	options: {
		port: { type: "string", default: "4300" },
		host: { type: "string", default: "127.0.0.1" },
		"no-abrir": { type: "boolean", default: false },
	},
});

const porta = Number(values.port);
if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
	process.stderr.write(`porta inválida: ${values.port}\n`);
	process.exit(2);
}
const abrir = !values["no-abrir"];
const casa = casaDoLab();
const arquivoServidor = path.join(casa, "servidor.json");

function abrirNoNavegador(url: string): void {
	if (!abrir) return;
	const comando = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
	Bun.spawn([comando, url], { stdout: "ignore", stderr: "ignore" }).unref();
}

async function servidorVivo(): Promise<RegistroServidor | null> {
	let registro: RegistroServidor;
	try {
		registro = (await Bun.file(arquivoServidor).json()) as RegistroServidor;
	} catch {
		return null;
	}
	if (!registro.pid || registro.pid === process.pid || !isPidAlive(registro.pid)) return null;
	try {
		const resposta = await fetch(`${registro.url}/api/estado`, { signal: AbortSignal.timeout(2_000) });
		return resposta.ok ? registro : null;
	} catch {
		return null;
	}
}

const existente = await servidorVivo();
if (existente) {
	process.stdout.write(`lab já está rodando: ${existente.url}\n`);
	abrirNoNavegador(existente.url);
	process.exit(0);
}

const lab = new Laboratorio(casa);
const url = await lab.iniciar({ host: values.host, port: porta });
const endereco = new URL(url);
await Bun.write(
	arquivoServidor,
	`${JSON.stringify({ pid: process.pid, port: Number(endereco.port), host: endereco.hostname, url } satisfies RegistroServidor)}\n`,
);
process.stdout.write(`lab: ${url}\n`);
abrirNoNavegador(url);

let saindo = false;
async function sair(codigo: number): Promise<void> {
	if (saindo) return;
	saindo = true;
	try {
		await lab.parar();
	} finally {
		const registro = (await Bun.file(arquivoServidor)
			.json()
			.catch(() => null)) as RegistroServidor | null;
		if (registro?.pid === process.pid) await fs.rm(arquivoServidor, { force: true });
		process.exit(codigo);
	}
}

process.on("SIGINT", () => void sair(0));
process.on("SIGTERM", () => void sair(0));
process.on("SIGHUP", () => void sair(0));

#!/usr/bin/env bun
/**
 * Puts the prebuilt native addon that matches `packages/natives/package.json` in
 * `packages/natives/native/`. The fork follows upstream release tags, and every tag
 * has its addon on npm (`@oh-my-pi/pi-natives-<platform>-<arch>`), so the fork runs
 * from source without a Rust toolchain. Run after `git merge vX.Y.Z` + `bun install`.
 * It takes the package of the machine running it: darwin-arm64 on the Mac, linux-x64
 * (glibc) on the EC2. x64 packages carry a `-modern` (AVX2) and a `-baseline` addon; both
 * are copied and the loader picks one by the CPU.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";

const raiz = path.join(import.meta.dir, "..", "..", "..");
const nativos = path.join(raiz, "packages", "natives");
const { version } = (await Bun.file(path.join(nativos, "package.json")).json()) as { version: string };
const pacote = `@oh-my-pi/pi-natives-${process.platform}-${process.arch}`;
const url = `https://registry.npmjs.org/${pacote}/-/${pacote.split("/")[1]}-${version}.tgz`;

const resposta = await fetch(url);
if (!resposta.ok) {
	process.stderr.write(`${pacote}@${version} não está no npm (${resposta.status}); use uma tag lançada do upstream\n`);
	process.exit(1);
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "lab-nativos-"));
try {
	const tgz = path.join(temp, "pacote.tgz");
	await Bun.write(tgz, resposta);
	await $`tar -xzf ${tgz} -C ${temp}`.quiet();
	const addons = (await fs.readdir(path.join(temp, "package"))).filter(nome => nome.endsWith(".node"));
	for (const nome of addons) {
		await fs.copyFile(path.join(temp, "package", nome), path.join(nativos, "native", nome));
		process.stdout.write(`${nome} ${version}\n`);
	}
} finally {
	await fs.rm(temp, { recursive: true, force: true });
}

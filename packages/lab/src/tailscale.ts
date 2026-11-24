/**
 * Who owns this Mac on the tailnet. `tailscale serve` tells the lab who each
 * visitor is (`Tailscale-User-Login`); the visitor whose login is this
 * machine's own tailnet user is the owner, not a member.
 */
import * as fs from "node:fs/promises";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";

/** The macOS app ships its CLI inside the bundle; Homebrew/Linux put `tailscale` on PATH. */
const CLI_DO_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const PRAZO_MS = 5_000;

/** `LoginName` of the tailnet user that owns this node, from `tailscale status --json`. */
export function loginDoDono(status: unknown): string | null {
	if (typeof status !== "object" || status === null) return null;
	const { Self: eu, User: usuarios } = status as { Self?: { UserID?: unknown }; User?: Record<string, unknown> };
	if (typeof eu?.UserID !== "number" || typeof usuarios !== "object" || usuarios === null) return null;
	const usuario = usuarios[String(eu.UserID)] as { LoginName?: unknown } | undefined;
	return typeof usuario?.LoginName === "string" && usuario.LoginName ? usuario.LoginName : null;
}

async function cli(): Promise<string | null> {
	const noPath = Bun.which("tailscale");
	if (noPath) return noPath;
	try {
		await fs.access(CLI_DO_APP);
		return CLI_DO_APP;
	} catch (err) {
		if (!isEnoent(err)) logger.debug("lab: Tailscale app unreadable", { error: String(err) });
		return null;
	}
}

/** This machine's tailnet login, or null when Tailscale is missing, logged out or stopped. */
export async function lerLoginDoDono(): Promise<string | null> {
	const comando = await cli();
	if (!comando) return null;
	const processo = Bun.spawn([comando, "status", "--json"], {
		stdout: "pipe",
		stderr: "ignore",
		timeout: PRAZO_MS,
	});
	const [saida, codigo] = await Promise.all([new Response(processo.stdout).text(), processo.exited]);
	if (codigo !== 0) return null;
	try {
		return loginDoDono(JSON.parse(saida));
	} catch (err) {
		logger.debug("lab: unreadable tailscale status", { error: String(err) });
		return null;
	}
}

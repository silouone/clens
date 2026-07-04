#!/usr/bin/env bun
/**
 * cLens dev launcher — one supervised command for the whole dashboard stack.
 *
 * Replaces the old `&`-chained two-terminal launch. This process is the SOLE
 * port authority: it picks a free API port and a free web port, hands the API
 * port to the server in STRICT mode (bind exactly that or fail), and injects the
 * same ports into Vite so the proxy targets the API we actually bound. It owns
 * the full process tree and reaps the whole group on Ctrl-C — no orphaned
 * esbuild daemons.
 *
 * Usage:
 *   bun run scripts/dev.ts [--clean] [--doctor] [--no-open]
 *                          [--api-port N] [--web-port N] [--local]
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort } from "../packages/cli/src/utils/net";
import { bold, cyan, dim, green, red, yellow } from "../packages/cli/src/commands/shared";
import {
	spawnSupervised,
	teardown,
	installSignalHandlers,
	type SupervisedChild,
} from "./lib/supervise";
import { enumerateOrphans, clean, type OrphanProcess } from "./lib/orphans";

// ── Paths ──────────────────────────────────────────────────────────

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const webDir = resolve(repoRoot, "packages/web");

// Bun normally hoists the vite bin to the workspace root, but fall back to the
// package-local copy if a future install layout keeps it under packages/web —
// otherwise the launcher would ENOENT on the first `bun run dev`.
const resolveViteBin = (): string => {
	const hoisted = resolve(repoRoot, "node_modules/.bin/vite");
	const packageLocal = resolve(webDir, "node_modules/.bin/vite");
	return existsSync(hoisted) ? hoisted : packageLocal;
};
const viteBin = resolveViteBin();

const DEFAULT_API_PORT = 3117;
const DEFAULT_WEB_PORT = 3701;

// ── Local ANSI (violet has no helper in shared.ts) ─────────────────

const violet = (s: string): string => `\x1b[35m${s}\x1b[0m`;

// ── Flags ──────────────────────────────────────────────────────────

type Flags = {
	readonly clean: boolean;
	readonly doctor: boolean;
	readonly noOpen: boolean;
	readonly global: boolean;
	readonly apiPort?: number;
	readonly webPort?: number;
};

const flagValue = (args: readonly string[], name: string): string | undefined => {
	const i = args.indexOf(name);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const numFlag = (args: readonly string[], name: string): number | undefined => {
	const raw = flagValue(args, name);
	if (raw === undefined) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
};

const parseFlags = (args: readonly string[]): Flags => ({
	clean: args.includes("--clean"),
	doctor: args.includes("--doctor"),
	noOpen: args.includes("--no-open"),
	// Global is the default (matches the previous `dev:api:global` behaviour);
	// pass --local to scope the dashboard to the current project only.
	global: !args.includes("--local"),
	...(numFlag(args, "--api-port") !== undefined ? { apiPort: numFlag(args, "--api-port") } : {}),
	...(numFlag(args, "--web-port") !== undefined ? { webPort: numFlag(args, "--web-port") } : {}),
});

// ── Browser ────────────────────────────────────────────────────────

const openBrowser = (url: string): void => {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
	} catch {
		// User can open the URL manually.
	}
};

// ── HTTP readiness (recursion + timer, no loops, no blocking sleep) ─

const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

const waitForUrl = async (
	url: string,
	timeoutMs: number,
	accept: (res: Response) => boolean,
): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	const poll = async (): Promise<boolean> => {
		const ok = await fetch(url)
			.then((res) => accept(res))
			.catch(() => false);
		if (ok) return true;
		if (Date.now() >= deadline) return false;
		await wait(250);
		return poll();
	};
	return poll();
};

// ── Orphan doctor / preflight ──────────────────────────────────────

const pad = (s: string | number, width: number): string => String(s).padEnd(width);

const printOrphanTable = (found: readonly OrphanProcess[]): void => {
	console.log(bold(`${pad("PID", 8)}${pad("TYPE", 22)}${pad("PORT", 8)}${pad("STATE", 8)}KILLABLE`));
	found.forEach((p) =>
		console.log(
			`${pad(p.pid, 8)}${pad(p.type, 22)}${pad(p.port ?? "-", 8)}${pad(p.stat, 8)}${
				p.state === "killable" ? green("yes") : red("no")
			}`,
		),
	);
};

/** `--doctor`: report the dev-server process tree, clean killable, advise on zombies. */
const runDoctor = async (): Promise<void> => {
	const found = await enumerateOrphans();
	if (found.length === 0) {
		console.log(green("No dev-server orphans found. All clear."));
		return;
	}
	printOrphanTable(found);
	const unkillable = found.filter((p) => p.state === "unkillable");
	const result = await clean();
	console.log("");
	console.log(green(`${result.cleaned.length} orphan${result.cleaned.length === 1 ? "" : "s"} cleaned`));
	if (unkillable.length > 0) {
		console.log(
			bold(
				red(
					`${unkillable.length} unkillable esbuild/vite zombie${unkillable.length === 1 ? "" : "s"} — reboot to clear`,
				),
			),
		);
	}
};

/** Pre-flight: optionally clean killable orphans; warn (but continue) on zombies. */
const preflight = async (flags: Flags): Promise<void> => {
	const found = await enumerateOrphans();
	const killable = found.filter((p) => p.state === "killable");
	const unkillable = found.filter((p) => p.state === "unkillable");

	if (killable.length > 0 && flags.clean) {
		const result = await clean();
		console.log(dim(`Pre-flight: cleaned ${result.cleaned.length} orphan dev process(es)`));
	} else if (killable.length > 0) {
		console.log(
			yellow(`Pre-flight: ${killable.length} orphan dev process(es) found — run \`bun run dev:clean\` to remove`),
		);
	}

	if (unkillable.length > 0) {
		console.log(
			bold(red(`⚠ ${unkillable.length} UNKILLABLE esbuild/vite zombie(s) detected (uninterruptible kernel state).`)),
		);
		console.log(bold(red(`  Signals cannot clear these — REBOOT to fully clean. Continuing on fresh ports…`)));
	}
};

// ── API server (strict bind, re-allocate on failure) ───────────────

const startApi = async (
	preferred: number,
	flags: Flags,
): Promise<{ readonly child: SupervisedChild; readonly port: number }> => {
	const attempt = async (
		seed: number,
		triesLeft: number,
	): Promise<{ readonly child: SupervisedChild; readonly port: number }> => {
		const apiPort = await findFreePort(seed);
		const child = spawnSupervised({
			cmd: "bun",
			args: [
				"--watch",
				"run",
				"packages/web/src/server/index.ts",
				...(flags.global ? ["--global"] : []),
				"--port",
				String(apiPort),
			],
			label: "api",
			cwd: repoRoot,
			// Strict: the launcher is the port authority — the server binds exactly
			// apiPort or fails, so we never lose track of where the API landed.
			env: { CLENS_PORT_STRICT: "1" },
			colorize: cyan,
		});

		const outcome = await Promise.race([
			waitForUrl(`http://127.0.0.1:${apiPort}/api/health`, 15_000, (r) => r.ok).then((ok) =>
				ok ? "healthy" : "timeout",
			),
			child.exited.then(() => "exited" as const),
		]);

		if (outcome === "healthy") return { child, port: apiPort };

		// Strict bind failed or the server crashed — reap this group and retry on
		// the next port. Port selection stays in this one place.
		await teardown([child]);
		if (triesLeft <= 1) throw new Error(`API server failed to start after multiple attempts (last port ${apiPort})`);
		console.log(yellow(`[api] did not come up on ${apiPort} (${outcome}) — retrying on a fresh port`));
		return attempt(apiPort + 1, triesLeft - 1);
	};

	return attempt(preferred, 5);
};

// ── Main ───────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
	const flags = parseFlags(process.argv.slice(2));

	if (flags.doctor) {
		await runDoctor();
		return;
	}

	await preflight(flags);

	// Sole port authority: bind the API first.
	const api = await startApi(flags.apiPort ?? DEFAULT_API_PORT, flags);

	console.log(cyan(`[api] healthy on http://127.0.0.1:${api.port}`));

	// Select the web port immediately before spawning Vite — NOT up-front before
	// the multi-second API health wait. Vite uses strictPort (no silent auto-bump
	// that would desync the proxy), so it cannot recover if the port is taken; doing
	// the selection here shrinks the race window to near-zero so a clean Ctrl-C
	// doesn't get pre-empted by an EADDRINUSE that tears down the healthy API too.
	const webPort = await findFreePort(flags.webPort ?? DEFAULT_WEB_PORT);

	// Vite child: inject the bound API port (proxy target) and the chosen web port.
	const web = spawnSupervised({
		cmd: viteBin,
		args: ["dev"],
		label: "web",
		cwd: webDir,
		env: {
			CLENS_API_PORT: String(api.port),
			CLENS_WEB_PORT: String(webPort),
		},
		colorize: violet,
	});

	const children: readonly SupervisedChild[] = [api.child, web];
	// Single guard flag: once an intentional teardown starts, the fail-together
	// watchers below stay quiet (a child exiting is the EFFECT of teardown, not a
	// crash). Mutated in one place; read in one place.
	const shutdown = { active: false };
	const guardedTeardown = installSignalHandlers(children, {
		onTeardown: () => {
			shutdown.active = true;
			console.log(dim("\nShutting down dev stack…"));
		},
	});

	// Fail-together: if a child exits while we are NOT already tearing down, it
	// crashed — reap the other and exit non-zero. NOTE: the SIGINT path registers
	// exit(0) on the same memoized teardown promise *before* these watchers, so on
	// a clean Ctrl-C exit(0) wins the race; don't reorder these registrations.
	children.forEach((c) =>
		void c.exited.then(() => {
			if (shutdown.active) return;
			shutdown.active = true;
			console.log(red(`[${c.label}] exited unexpectedly — tearing down the stack`));
			void guardedTeardown().then(() => process.exit(1));
		}),
	);

	// Wait for Vite to actually serve before announcing / opening the browser.
	const webReady = await waitForUrl(`http://localhost:${webPort}/`, 30_000, () => true);
	const openUrl = `http://localhost:${webPort}`;

	console.log("");
	console.log(bold(green("  cLens dev dashboard ready")));
	console.log(`  ${bold("Open:")} ${cyan(openUrl)}`);
	console.log(`  ${dim(`API:  http://127.0.0.1:${api.port}  ·  web: ${webPort}  ·  ${flags.global ? "global" : "local"} mode`)}`);
	console.log(`  ${dim("Press Ctrl-C to stop everything (no orphans).")}`);
	console.log("");

	if (!webReady) {
		console.log(yellow("Note: web server did not answer within 30s — it may still be starting."));
	}
	if (webReady && !flags.noOpen) {
		openBrowser(openUrl);
	}

	// Keep the supervisor attached so it can reap the group on signal.
	await new Promise(() => {});
};

main().catch((err) => {
	console.error(red(`dev launcher failed: ${err instanceof Error ? err.message : String(err)}`));
	process.exit(1);
});

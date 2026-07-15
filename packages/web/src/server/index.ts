import type { ProjectEntry } from "@silou/clens";
import { resolveProjectRoot } from "@silou/clens/src/utils";
import { serveOnFreePort } from "@silou/clens/src/utils/net";
import { createApp } from "./app";
import { startLiveWatcher } from "./live";
import { currentLevel, log } from "./logger";

// ── Server options ─────────────────────────────────────────────────

type StartServerOptions = {
	readonly projectDir: string;
	readonly port?: number;
	readonly token?: string;
	readonly projects?: readonly ProjectEntry[];
	/** Directory holding the built static client bundle (see AppOptions.distDir). */
	readonly distDir?: string;
	/**
	 * When true, bind exactly `port` or fail loudly — never auto-bump. The dev
	 * launcher sets this (it is the sole port authority); also triggered by the
	 * `CLENS_PORT_STRICT=1` env var. Standalone `clens web` leaves it false so a
	 * busy port falls through to the next free one.
	 */
	readonly strict?: boolean;
	/**
	 * Runtime mode. Callers pass this explicitly: the `web` CLI command passes
	 * `production`, the dev launcher/`dev:api` run in development. When omitted it
	 * falls back to NODE_ENV — see the fallback comment in startServer for why
	 * bundled code must NOT rely on that path.
	 */
	readonly mode?: "development" | "production";
};

type ServerHandle = {
	readonly url: string;
	readonly port: number;
	readonly token: string;
	readonly stop: () => void;
};

// ── Token generation ───────────────────────────────────────────────

const generateToken = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

// ── Bootstrap ──────────────────────────────────────────────────────

/**
 * Start the cLens web server.
 * Binds to 127.0.0.1 only (local access).
 * Generates a random auth token printed to stdout for the CLI to capture.
 */
const startServer = (options: StartServerOptions): ServerHandle => {
	const port = options.port ?? 3117;
	const token = options.token ?? generateToken();
	const strict = options.strict ?? process.env.CLENS_PORT_STRICT === "1";
	// Mode is an explicit caller-supplied option (production for `clens web`,
	// development for the dev launcher). The NODE_ENV read below is ONLY a
	// fallback for direct server invocation.
	//
	// ROOT CAUSE (2026-07-11 publish audit): `bun build` constant-folds
	// `process.env.NODE_ENV` at bundle time, so bundled code that branches on it
	// gets pinned to whatever value was set during the build. The shipped CLI
	// carried the literal `mode = "development"`, which 404'd the dashboard and
	// silently disabled the auth gate. Bundled code (anything reached via the CLI
	// `web` command) MUST pass `mode` explicitly and never depend on this branch.
	const mode: "development" | "production" =
		options.mode ?? (process.env.NODE_ENV === "production" ? "production" : "development");

	log.info(`Starting server mode=${mode} logLevel=${currentLevel}`);
	const app = createApp({
		token,
		mode,
		projectDir: options.projectDir,
		...(options.projects ? { projects: options.projects } : {}),
		...(options.distDir ? { distDir: options.distDir } : {}),
	});

	// Bind-and-retry (no probe-then-bind TOCTOU). In strict mode this binds
	// exactly `port` or throws StrictPortUnavailableError.
	const { server, port: actualPort } = serveOnFreePort(
		(p) => ({
			port: p,
			hostname: "127.0.0.1",
			idleTimeout: 255, // max value (seconds) — prevents SSE connections from being killed
			fetch: app.fetch,
		}),
		port,
		{ strict },
	);

	const url = `http://127.0.0.1:${actualPort}`;

	if (actualPort !== port) {
		log.warn(`Port ${port} busy — requested ${port}, bound ${actualPort}`);
	}
	log.info(`Server bound to ${url}`);
	log.info(`Project dir: ${options.projectDir}`);

	// Start file watcher(s) for live SSE push
	const watchers = options.projects
		? options.projects.map((p) => startLiveWatcher(p.path))
		: [startLiveWatcher(options.projectDir)];

	return {
		url,
		port: actualPort,
		token,
		stop: () => {
			watchers.forEach((w) => {
				w.stop();
			});
			server.stop(true);
		},
	};
};

export type { AppType } from "./app";
export type { ServerHandle, StartServerOptions };
export { findProjectDir, generateToken, startServer };

// ── Project dir resolution ─────────────────────────────────────────

/**
 * Resolve the project root (where `.clens/` data lives) from `start`.
 * Delegates to the canonical `resolveProjectRoot` so the dashboard reads from
 * exactly the root the capture hook writes to — `.clens`-first, then `.git`,
 * then `start`. (Re-implementing this with `.git`-first precedence desynced the
 * two in repos with a parent `.git` and a sub-dir `.clens`.)
 */
const findProjectDir = (start: string): string => resolveProjectRoot(start);

// ── Direct execution ───────────────────────────────────────────────

// When run directly: `bun run src/server/index.ts [--global] [--port N]`
if (import.meta.main) {
	const args = process.argv.slice(2);
	const isGlobal = args.includes("--global");
	const portFlagIdx = args.indexOf("--port");
	const portArg = portFlagIdx !== -1 ? parseInt(args[portFlagIdx + 1], 10) : undefined;

	const projectDir = process.env.CLENS_PROJECT_DIR ?? findProjectDir(process.cwd());
	const port = portArg ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : undefined);

	const projects = isGlobal
		? await (async () => {
				const { discoverAndRegisterProjects } = await import("@silou/clens/src/session/registry");
				return discoverAndRegisterProjects();
			})()
		: undefined;

	const handle = startServer({
		projectDir,
		port,
		...(projects && projects.length > 0 ? { projects } : {}),
	});
	console.log(`cLens server listening on ${handle.url}`);
	if (projects && projects.length > 0) {
		console.log(`Mode: global (${projects.length} project${projects.length === 1 ? "" : "s"})`);
	}
	console.log(`Project dir: ${projectDir}`);
	console.log(`Auth token: ${handle.token}`);
	console.log(`Open: ${handle.url}?token=${handle.token}`);
}

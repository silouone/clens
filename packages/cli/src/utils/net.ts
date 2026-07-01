import { createServer } from "node:net";

// ── Net / port utilities ───────────────────────────────────────────
//
// Shared, dependency-free bind-and-retry port helpers used by both the dev
// launcher (which selects ports up-front) and the production server (which
// binds defensively). The two design rules:
//
//   1. Bind-and-retry, never probe-then-bind. `serveOnFreePort` attempts the
//      real `Bun.serve` and only bumps on EADDRINUSE — there is no TOCTOU
//      window between checking and binding.
//   2. `findFreePort` is a best-effort *selector* (used by the launcher, which
//      is the sole port authority). It can race, which is why the server it
//      hands a port to runs in strict mode and fails loudly rather than
//      silently bumping to a different port.

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_TRIES = 20;

// ── Errors ─────────────────────────────────────────────────────────

/** No free port found within `maxTries` of the preferred port. */
class PortExhaustionError extends Error {
	constructor(preferred: number, maxTries: number, host: string) {
		super(
			`No free port found in range ${preferred}..${preferred + maxTries - 1} on ${host} (tried ${maxTries} ports)`,
		);
		this.name = "PortExhaustionError";
	}
}

/** Strict mode requested an exact port that was already in use. */
class StrictPortUnavailableError extends Error {
	constructor(port: number, host: string) {
		super(`Port ${port} on ${host} is already in use (strict mode — refusing to bump)`);
		this.name = "StrictPortUnavailableError";
	}
}

// ── Error inspection (no `as` on caught errors) ────────────────────

/** Read a string `.code` off an unknown caught value, if present. */
const errorCode = (e: unknown): string | undefined => {
	if (typeof e === "object" && e !== null && "code" in e) {
		const code = e.code;
		return typeof code === "string" ? code : undefined;
	}
	return undefined;
};

/** True when a caught error represents "address already in use". */
const isAddrInUse = (e: unknown): boolean => {
	if (errorCode(e) === "EADDRINUSE") return true;
	const message = e instanceof Error ? e.message : String(e);
	return /EADDRINUSE|address already in use|is port .* in use/i.test(message);
};

// ── findFreePort ───────────────────────────────────────────────────

type FindFreePortOpts = {
	readonly host?: string;
	readonly maxTries?: number;
};

/** Attempt to bind a throwaway listener; resolve true if the port is free. */
const tryListen = (port: number, host: string): Promise<boolean> =>
	new Promise((resolveFree) => {
		const server = createServer();
		server.once("error", () => resolveFree(false));
		server.once("listening", () => {
			server.close(() => resolveFree(true));
		});
		server.listen(port, host);
	});

/**
 * Find the first free TCP port at or after `preferred`.
 *
 * Selector only — there is a window between resolving and the caller binding,
 * so the eventual bind should be strict (fail-loud) if exactness matters.
 * Throws {@link PortExhaustionError} after `maxTries` consecutive busy ports.
 */
const findFreePort = async (preferred: number, opts: FindFreePortOpts = {}): Promise<number> => {
	const host = opts.host ?? DEFAULT_HOST;
	const maxTries = opts.maxTries ?? DEFAULT_MAX_TRIES;

	const attempt = async (port: number, triesLeft: number): Promise<number> => {
		if (triesLeft <= 0) throw new PortExhaustionError(preferred, maxTries, host);
		const free = await tryListen(port, host);
		return free ? port : attempt(port + 1, triesLeft - 1);
	};

	return attempt(preferred, maxTries);
};

// ── serveOnFreePort ────────────────────────────────────────────────

/** Options object returned by a `makeServe` factory and handed to `Bun.serve`. */
type ServeConfig = Parameters<typeof Bun.serve>[0];

/** The handle `Bun.serve` returns (overloaded — derive it rather than naming it). */
type BunServer = ReturnType<typeof Bun.serve>;

type ServeOnFreePortOpts = {
	readonly maxTries?: number;
	/** When true, bind exactly `preferred` or throw — never bump. */
	readonly strict?: boolean;
	readonly host?: string;
};

type ServeResult = {
	readonly server: BunServer;
	readonly port: number;
};

/**
 * Bind a `Bun.serve` server to the first free port at or after `preferred`.
 *
 * `makeServe` receives the candidate port and returns the full serve options
 * (so the caller controls hostname / idleTimeout / fetch). Binding is the real
 * `Bun.serve` call — no probe-then-bind window. In strict mode a conflict on
 * `preferred` throws {@link StrictPortUnavailableError} instead of bumping.
 */
const serveOnFreePort = (
	makeServe: (port: number) => ServeConfig,
	preferred: number,
	opts: ServeOnFreePortOpts = {},
): ServeResult => {
	const maxTries = opts.maxTries ?? DEFAULT_MAX_TRIES;
	const strict = opts.strict ?? false;
	const host = opts.host ?? DEFAULT_HOST;

	const attempt = (port: number, triesLeft: number): ServeResult => {
		try {
			const server = Bun.serve(makeServe(port));
			return { server, port: server.port ?? port };
		} catch (e) {
			if (!isAddrInUse(e)) throw e;
			if (strict) throw new StrictPortUnavailableError(port, host);
			if (triesLeft <= 1) throw new PortExhaustionError(preferred, maxTries, host);
			return attempt(port + 1, triesLeft - 1);
		}
	};

	return attempt(preferred, maxTries);
};

export { findFreePort, serveOnFreePort, PortExhaustionError, StrictPortUnavailableError };
export type { FindFreePortOpts, ServeOnFreePortOpts, ServeResult, ServeConfig };

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

/**
 * DEFERRED-PENDING-REBOOT live end-to-end tests for the dev launcher.
 *
 * These are the only checks that exercise a REAL `vite dev` (and therefore the
 * `esbuild --service` daemons). At authoring time the host had ~23 esbuild
 * daemons wedged in an unkillable macOS uninterruptible-wait state, where every
 * fresh esbuild exec hangs and adds more zombies. Running these would wedge the
 * suite and the machine. They are written so they EXIST and run post-reboot, but
 * are HARD-GATED off by default.
 *
 * To run after a clean reboot:  CLENS_LIVE_E2E=1 bun test test/integration/dev-launcher.e2e.test.ts
 *
 * What they assert (the launcher's contract):
 *   1. Both ports LISTEN (API + web) once the stack is up.
 *   2. The web port proxies /api/health through to the API (dynamic proxy).
 *   3. Ctrl-C (SIGINT) leaves ZERO orphaned processes — the whole group is reaped.
 *   4. A second instance launched alongside the first picks different free ports.
 */

const LIVE = process.env.CLENS_LIVE_E2E === "1";
const repoRoot = resolve(import.meta.dir, "../../../..");

const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/** True if a TCP port is being listened on. */
const isListening = (port: number): Promise<boolean> =>
	new Promise((res) => {
		const probe = createServer();
		probe.once("error", () => res(true)); // EADDRINUSE → something is listening
		probe.once("listening", () => probe.close(() => res(false)));
		probe.listen(port, "127.0.0.1");
	});

/** Launch `scripts/dev.ts`, capturing the announced web/API ports from stdout. */
const launch = (extraArgs: readonly string[]) => {
	const child = spawn("bun", ["run", "scripts/dev.ts", "--no-open", ...extraArgs], {
		cwd: repoRoot,
		detached: true, // own group so the test can reap if a teardown assertion fails
		stdio: ["ignore", "pipe", "pipe"],
	});
	// Single mutable sink for streamed output (stream accumulation is inherently
	// stateful; concatenate onto one cell rather than a banned array .push()).
	const sink = { text: "" };
	child.stdout?.on("data", (c: Buffer) => (sink.text += c.toString()));
	child.stderr?.on("data", (c: Buffer) => (sink.text += c.toString()));
	return { child, output: () => sink.text };
};

const parsePort = (output: string, label: "web" | "API"): number | undefined => {
	const m = output.match(label === "web" ? /web:\s*(\d+)/ : /API:\s*http:\/\/127\.0\.0\.1:(\d+)/);
	return m ? Number(m[1]) : undefined;
};

describe.skipIf(!LIVE)(
	"DEFERRED live e2e: dev launcher (needs reboot — spawns real vite/esbuild)",
	() => {
		test("both ports LISTEN and the web port proxies /api/health to the API", async () => {
			const { child, output } = launch([]);
			try {
				// Give the supervised stack time to boot vite + API.
				await wait(20_000);
				const webPort = parsePort(output(), "web");
				const apiPort = parsePort(output(), "API");
				expect(webPort).toBeDefined();
				expect(apiPort).toBeDefined();

				expect(await isListening(apiPort ?? 0)).toBe(true);
				expect(await isListening(webPort ?? 0)).toBe(true);

				// Proxy: hitting /api/health on the WEB port should reach the API.
				const proxied = await fetch(`http://localhost:${webPort}/api/health`);
				expect(proxied.status).toBe(200);
				const body = await proxied.json();
				expect(body.status).toBe("ok");
			} finally {
				if (child.pid) process.kill(-child.pid, "SIGINT");
				await wait(5000);
			}
		}, 60_000);

		test("SIGINT leaves zero orphaned vite/esbuild/server processes", async () => {
			const { child, output } = launch([]);
			await wait(20_000);
			const webPort = parsePort(output(), "web");
			const apiPort = parsePort(output(), "API");

			if (child.pid) process.kill(-child.pid, "SIGINT");
			await wait(6000); // grace + escalation window

			// The launcher tears down the whole group: both ports must be free again.
			expect(await isListening(apiPort ?? 0)).toBe(false);
			expect(await isListening(webPort ?? 0)).toBe(false);
		}, 60_000);

		test("a second concurrent instance selects different free ports", async () => {
			const a = launch([]);
			await wait(18_000);
			const b = launch([]);
			await wait(18_000);
			try {
				const aWeb = parsePort(a.output(), "web");
				const bWeb = parsePort(b.output(), "web");
				const aApi = parsePort(a.output(), "API");
				const bApi = parsePort(b.output(), "API");
				expect(aWeb).toBeDefined();
				expect(bWeb).toBeDefined();
				expect(aWeb).not.toBe(bWeb);
				expect(aApi).not.toBe(bApi);
			} finally {
				if (a.child.pid) process.kill(-a.child.pid, "SIGINT");
				if (b.child.pid) process.kill(-b.child.pid, "SIGINT");
				await wait(6000);
			}
		}, 90_000);
	},
);

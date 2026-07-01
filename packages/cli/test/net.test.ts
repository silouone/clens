import { describe, test, expect } from "bun:test";
import { createServer } from "node:net";
import {
	findFreePort,
	serveOnFreePort,
	PortExhaustionError,
	StrictPortUnavailableError,
} from "../src/utils/net";

// ── Helpers ────────────────────────────────────────────────────────
//
// Every test uses OS-assigned ephemeral HIGH ports (listen on :0, read the
// granted port). We NEVER touch 3117 / 3700 / 3701 — those are the real dev
// ports and binding them could collide with a developer's live server.

const HOST = "127.0.0.1";

/** Grab an ephemeral port the OS just confirmed is free, then release it. */
const grabFreePort = (): Promise<number> =>
	new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, HOST, () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr !== null ? addr.port : 0;
			server.close(() => resolvePort(port));
		});
	});

/** Hold a port open for the duration of a callback, then release it. */
const occupy = async <T>(port: number, fn: () => Promise<T>): Promise<T> => {
	const server = createServer();
	await new Promise<void>((res, rej) => {
		server.once("error", rej);
		server.listen(port, HOST, () => res());
	});
	try {
		return await fn();
	} finally {
		await new Promise<void>((res) => server.close(() => res()));
	}
};

const okServe = (port: number) => ({
	port,
	hostname: HOST,
	fetch: () => new Response("ok"),
});

// ── findFreePort ───────────────────────────────────────────────────

describe("findFreePort", () => {
	test("returns the preferred port when it is free", async () => {
		const port = await grabFreePort();
		const got = await findFreePort(port, { host: HOST });
		expect(got).toBe(port);
	});

	test("skips an occupied port and returns the next free one", async () => {
		const port = await grabFreePort();
		await occupy(port, async () => {
			const got = await findFreePort(port, { host: HOST });
			expect(got).toBeGreaterThan(port);
			expect(got).toBeLessThanOrEqual(port + 20);
		});
	});

	test("throws PortExhaustionError when the range is exhausted", async () => {
		const port = await grabFreePort();
		await occupy(port, async () => {
			// maxTries:1 with the only candidate occupied → immediate exhaustion.
			await expect(findFreePort(port, { host: HOST, maxTries: 1 })).rejects.toBeInstanceOf(
				PortExhaustionError,
			);
		});
	});
});

// ── serveOnFreePort ────────────────────────────────────────────────

describe("serveOnFreePort", () => {
	test("binds the preferred port and reports the actual bound port", async () => {
		const port = await grabFreePort();
		const { server, port: bound } = serveOnFreePort(okServe, port, { host: HOST });
		expect(bound).toBe(port);
		expect(server.port).toBe(port);
		server.stop(true);
	});

	test("bumps to the next free port when the preferred is occupied (sync throw on EADDRINUSE)", async () => {
		const port = await grabFreePort();
		await occupy(port, async () => {
			const { server, port: bound } = serveOnFreePort(okServe, port, { host: HOST });
			expect(bound).toBeGreaterThan(port);
			expect(server.port).toBe(bound);
			server.stop(true);
		});
	});

	test("strict mode throws StrictPortUnavailableError on conflict instead of bumping", async () => {
		const port = await grabFreePort();
		await occupy(port, async () => {
			expect(() => serveOnFreePort(okServe, port, { host: HOST, strict: true })).toThrow(
				StrictPortUnavailableError,
			);
		});
	});

	test("strict mode binds cleanly when the exact port is free", async () => {
		const port = await grabFreePort();
		const { server, port: bound } = serveOnFreePort(okServe, port, { host: HOST, strict: true });
		expect(bound).toBe(port);
		server.stop(true);
	});
});

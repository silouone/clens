import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { ServerHandle } from "../../src/server/index";
import { startServer } from "../../src/server/index";

// Port resilience for the production server (Track B). No vite / esbuild — this
// only exercises Bun.serve bind-and-retry, so it is safe to run this session.
// Uses OS-assigned ephemeral HIGH ports; never touches 3117 / 3700 / 3701.

const TEST_DIR = "/tmp/clens-server-port-test";
const HOST = "127.0.0.1";

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

const occupy = (port: number): Promise<{ close: () => Promise<void> }> =>
	new Promise((res, rej) => {
		const server = createServer();
		server.once("error", rej);
		server.listen(port, HOST, () =>
			res({
				close: () => new Promise<void>((done) => server.close(() => done())),
			}),
		);
	});

describe("Server port resilience (Track B)", () => {
	beforeAll(() => {
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
		// One trivial session so the live watcher has a directory to watch.
		writeFileSync(`${TEST_DIR}/.clens/sessions/.keep`, "");
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		delete process.env.CLENS_PORT_STRICT;
	});

	test("binds the requested port when it is free and reports it on the handle", async () => {
		const port = await grabFreePort();
		const handle: ServerHandle = startServer({ projectDir: TEST_DIR, port });
		expect(handle.port).toBe(port);
		expect(handle.url).toBe(`http://127.0.0.1:${port}`);
		handle.stop();
	});

	test("auto-bumps to the next free port when the requested one is occupied", async () => {
		const port = await grabFreePort();
		const blocker = await occupy(port);
		try {
			const handle: ServerHandle = startServer({ projectDir: TEST_DIR, port });
			expect(handle.port).toBeGreaterThan(port);
			expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
			handle.stop();
		} finally {
			await blocker.close();
		}
	});

	test("strict mode (option) fails loudly instead of bumping on conflict", async () => {
		const port = await grabFreePort();
		const blocker = await occupy(port);
		try {
			expect(() => startServer({ projectDir: TEST_DIR, port, strict: true })).toThrow();
		} finally {
			await blocker.close();
		}
	});

	test("strict mode (CLENS_PORT_STRICT=1 env) also fails loudly on conflict", async () => {
		const port = await grabFreePort();
		const blocker = await occupy(port);
		process.env.CLENS_PORT_STRICT = "1";
		try {
			expect(() => startServer({ projectDir: TEST_DIR, port })).toThrow();
		} finally {
			delete process.env.CLENS_PORT_STRICT;
			await blocker.close();
		}
	});
});

/**
 * Publish smoke test — exercises the COMPILED standalone binary (bin/clens) and
 * the packed-and-installed npm artifact, NOT the TypeScript source. This is what
 * `npm install`-ed users actually run, so the publish pipeline must prove it
 * boots, reports the right version, and serves an authenticated dashboard.
 *
 * Gated behind CLENS_PUBLISH_SMOKE so a normal `bun test` never pays the cost of
 * compiling a ~58MB standalone binary or packing/installing a tarball. The
 * `smoke:publish` script (wired into `prepublishOnly`) runs `bun run build &&
 * bun run build:bin` first — producing both `dist/` and `bin/clens` — then
 * invokes this file with the env flag set.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	COMPILED_BIN_PATH,
	cleanupTestProject,
	createTestProject,
	runCompiledCli,
	stripAnsi,
} from "./helpers";

const PUBLISH_SMOKE = process.env.CLENS_PUBLISH_SMOKE === "1";

// Package root (packages/cli) and the manifest version — the single source of
// truth the installed CLI must echo back.
const CLI_DIR = resolve(import.meta.dir, "../..");
const MANIFEST_VERSION = JSON.parse(readFileSync(resolve(CLI_DIR, "package.json"), "utf8"))
	.version as string;
const DIST_WEB_INDEX = resolve(CLI_DIR, "dist/web/index.html");

describe.skipIf(!PUBLISH_SMOKE)("Publish smoke (compiled bin/clens)", () => {
	let projectDir: string;

	beforeAll(() => {
		if (!existsSync(COMPILED_BIN_PATH)) {
			throw new Error(
				`Compiled binary not found at ${COMPILED_BIN_PATH}. Run \`bun run build:bin\` before the publish smoke test.`,
			);
		}
		projectDir = createTestProject({ sessionCount: 2, withLinks: true, withDistilled: true });
	});

	afterAll(() => {
		cleanupTestProject(projectDir);
	});

	test("--version exits 0 and outputs version string", async () => {
		const r = await runCompiledCli(["--version"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("--help exits 0 and shows usage", async () => {
		const r = await runCompiledCli(["--help"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(stripAnsi(r.stdout)).toContain("Usage:");
	});

	test("list --json exits 0 and produces a JSON array", async () => {
		const r = await runCompiledCli(["list", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(Array.isArray(r.json)).toBe(true);
	});

	test("report --last --json exits 0 and produces a JSON object", async () => {
		const r = await runCompiledCli(["report", "--last", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(typeof r.json).toBe("object");
	});
});

/**
 * Artifact stage — packs the real tarball, installs it into a temp project, and
 * exercises it exactly as an `npm install`-ed user would. This is the seam that
 * catches defects invisible at source: a bundler-folded dev mode (dashboard 404
 * + disabled auth) and a stale version string both live only in the published
 * artifact and passed every source-level gate before the 2026-07-11 audit.
 */
describe.skipIf(!PUBLISH_SMOKE)("Publish smoke (packed npm artifact)", () => {
	let installDir: string;
	let cliJs: string;
	let projectDir: string;

	beforeAll(() => {
		if (!existsSync(DIST_WEB_INDEX)) {
			throw new Error(
				`Web bundle not found at ${DIST_WEB_INDEX}. Run \`bun run build\` before the publish smoke test.`,
			);
		}

		// Pack the real tarball (runs `prepack`, so README/LICENSE are copied in).
		const packJson = execFileSync("npm", ["pack", "--json"], { cwd: CLI_DIR, encoding: "utf8" });
		const tarball = resolve(CLI_DIR, JSON.parse(packJson)[0].filename);

		// Install it into a throwaway project — no runtime deps, so this is fast
		// and proves the artifact is self-contained.
		installDir = mkdtempSync(resolve(tmpdir(), "clens-artifact-"));
		writeFileSync(
			resolve(installDir, "package.json"),
			JSON.stringify({ name: "clens-artifact-smoke", version: "0.0.0", private: true }),
		);
		execFileSync("npm", ["install", tarball], { cwd: installDir, stdio: "ignore" });
		rmSync(tarball, { force: true });

		cliJs = resolve(installDir, "node_modules/@silou/clens/dist/cli.js");
		if (!existsSync(cliJs)) {
			throw new Error(`installed CLI entry missing at ${cliJs}`);
		}

		// Seed a project with fixture sessions so the dashboard has data to serve.
		projectDir = createTestProject({ sessionCount: 2, withLinks: true, withDistilled: true });
	});

	afterAll(() => {
		if (installDir?.includes("clens-artifact-")) {
			rmSync(installDir, { recursive: true, force: true });
		}
		cleanupTestProject(projectDir);
	});

	test("--version equals the manifest version", async () => {
		const proc = Bun.spawn(["bun", cliJs, "--version"], {
			cwd: projectDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(proc.exitCode).toBe(0);
		expect(out.trim()).toBe(MANIFEST_VERSION);
	});

	test("clens web serves the dashboard 200-with-token and rejects the API 401-without", async () => {
		// --port 0 → OS-assigned ephemeral port (no collision); the actual port
		// and token are parsed from the CLI's own stdout.
		const proc = Bun.spawn(["bun", cliJs, "web", "--no-open", "--port", "0"], {
			cwd: projectDir,
			stdout: "pipe",
			stderr: "pipe",
		});

		// `clens web` blocks forever after printing, so pump stdout in the
		// background and poll the accumulated buffer for the "Open:" line.
		let buf = "";
		const decoder = new TextDecoder();
		const reader = proc.stdout.getReader();
		void (async () => {
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					if (value) buf += decoder.decode(value, { stream: true });
				}
			} catch {
				// stream closed on shutdown — expected
			}
		})();

		const urlRe = /http:\/\/127\.0\.0\.1:(\d+)\?token=([0-9a-f]+)/;
		const deadline = Date.now() + 20_000;
		let match: RegExpMatchArray | null = null;
		while (Date.now() < deadline) {
			match = stripAnsi(buf).match(urlRe);
			if (match) break;
			await Bun.sleep(100);
		}

		try {
			expect(match).not.toBeNull();
			const [, port, token] = match as RegExpMatchArray;
			const base = `http://127.0.0.1:${port}`;

			// Dashboard HTML served with the token.
			const withToken = await fetch(`${base}/?token=${token}`);
			expect(withToken.status).toBe(200);
			expect((await withToken.text()).toLowerCase()).toContain("<!doctype html");

			// API rejects requests without the token (README's security promise).
			const noToken = await fetch(`${base}/api/sessions`);
			expect(noToken.status).toBe(401);
		} finally {
			// SIGTERM triggers web.ts's clean shutdown (handle.stop + exit 0).
			proc.kill();
			await proc.exited;
		}
		expect(proc.exitCode).toBe(0);
	});
});

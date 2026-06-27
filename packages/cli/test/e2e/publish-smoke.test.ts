/**
 * Publish smoke test — exercises the COMPILED standalone binary (bin/clens),
 * NOT the TypeScript source. This is what `npm install`-ed users actually run,
 * so the publish pipeline must verify it boots and answers basic commands.
 *
 * Gated behind CLENS_PUBLISH_SMOKE so a normal `bun test` never pays the cost
 * of compiling a ~58MB standalone binary. The `smoke:publish` script
 * (wired into `prepublishOnly`) runs `bun run build:bin` first, then invokes
 * this file with the env flag set.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	cleanupTestProject,
	COMPILED_BIN_PATH,
	createTestProject,
	runCompiledCli,
	stripAnsi,
} from "./helpers";

const PUBLISH_SMOKE = process.env.CLENS_PUBLISH_SMOKE === "1";

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

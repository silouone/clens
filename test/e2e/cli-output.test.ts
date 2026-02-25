import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanupTestProject, createTestProject, runCli, stripAnsi } from "./helpers";

describe("CLI Text Output Format", () => {
	let projectDir: string;

	beforeAll(() => {
		projectDir = createTestProject({ sessionCount: 2, withLinks: true, withDistilled: true });
	});

	afterAll(() => {
		cleanupTestProject(projectDir);
	});

	// ── help output ─────────────────────────────────────

	test("help shows all 8 commands", async () => {
		const r = await runCli(["--help"], projectDir);
		const plain = stripAnsi(r.stdout);
		const expectedCommands = [
			"init",
			"list",
			"distill",
			"report",
			"agents",
			"explore",
			"clean",
			"export",
		];
		for (const cmd of expectedCommands) {
			expect(plain).toContain(cmd);
		}
	});

	test("help shows grouped sections", async () => {
		const r = await runCli(["--help"], projectDir);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("Setup:");
		expect(plain).toContain("Sessions:");
		expect(plain).toContain("Analysis:");
		expect(plain).toContain("Options:");
	});

	test("help shows all flags", async () => {
		const r = await runCli(["--help"], projectDir);
		const plain = stripAnsi(r.stdout);
		const expectedFlags = [
			"--last",
			"--force",
			"--deep",
			"--json",
			"--otel",
			"--comms",
			"--version",
			"--help",
		];
		for (const flag of expectedFlags) {
			expect(plain).toContain(flag);
		}
	});

	// ── list output ─────────────────────────────────────

	test("list shows table headers", async () => {
		const r = await runCli(["list"], projectDir);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("ID");
		expect(plain).toContain("Branch");
		expect(plain).toContain("Duration");
		expect(plain).toContain("Events");
		expect(plain).toContain("Status");
	});

	test("list shows session IDs (truncated to 8 chars)", async () => {
		const r = await runCli(["list"], projectDir);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("e2e-test");
	});

	test("list shows total size summary", async () => {
		const r = await runCli(["list"], projectDir);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("Total:");
		expect(plain).toContain("session(s)");
	});

	// ── report output ───────────────────────────────────

	test("report shows session summary", async () => {
		const r = await runCli(["report", "--last"], projectDir);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("Session");
	});

	// ── distill output ──────────────────────────────────

	test("distill shows narrative and metrics", async () => {
		const r = await runCli(["distill", "--last"], projectDir);
		expect(r.exitCode).toBe(0);
		const plain = stripAnsi(r.stdout);
		expect(plain.length).toBeGreaterThan(50);
	});

	// ── agents output ───────────────────────────────────

	test("agents shows agent info", async () => {
		const r = await runCli(["agents", "--last"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.length).toBeGreaterThan(10);
	});

	// ── ANSI coloring ───────────────────────────────────

	test("error messages go to stderr", async () => {
		const r = await runCli(["report", "nonexistent"], projectDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr.length).toBeGreaterThan(0);
	});
});

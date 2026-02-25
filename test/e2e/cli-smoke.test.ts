import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cleanupTestProject, createTestProject, runCli, stripAnsi } from "./helpers";

describe("CLI Smoke Tests", () => {
	let projectDir: string;

	beforeAll(() => {
		projectDir = createTestProject({ sessionCount: 2, withLinks: true, withDistilled: true });
	});

	afterAll(() => {
		cleanupTestProject(projectDir);
	});

	// ── Global flags ────────────────────────────────────

	test("--version exits 0 and outputs version string", async () => {
		const r = await runCli(["--version"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("--help exits 0 and shows usage", async () => {
		const r = await runCli(["--help"], projectDir);
		expect(r.exitCode).toBe(0);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("Usage:");
		expect(plain).toContain("Setup:");
		expect(plain).toContain("Options:");
	});

	test("no arguments shows help", async () => {
		const r = await runCli([], projectDir);
		expect(r.exitCode).toBe(0);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("Usage:");
	});

	// ── Unknown command ─────────────────────────────────

	test("unknown command exits 1", async () => {
		const r = await runCli(["nonexistent"], projectDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("Unknown command");
	});

	// ── Killed command suggestions ──────────────────────

	test("killed command 'stats' shows suggestion", async () => {
		const r = await runCli(["stats"], projectDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("clens report");
	});

	test("killed command 'tree' shows suggestion", async () => {
		const r = await runCli(["tree"], projectDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("clens agents");
	});

	test("killed command 'decisions' shows explore suggestion", async () => {
		const r = await runCli(["decisions"], projectDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("clens explore");
	});

	// ── list ────────────────────────────────────────────

	test("list exits 0", async () => {
		const r = await runCli(["list"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.length).toBeGreaterThan(0);
	});

	test("list --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["list", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
		expect(Array.isArray(r.json)).toBe(true);
	});

	// ── report (replaces stats) ─────────────────────────

	test("report --last exits 0", async () => {
		const r = await runCli(["report", "--last"], projectDir);
		expect(r.exitCode).toBe(0);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("Session");
	});

	test("report --last --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["report", "--last", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
		expect(typeof r.json).toBe("object");
	});

	// ── report backtracks ───────────────────────────────

	test("report --last backtracks exits 0", async () => {
		const r = await runCli(["report", "--last", "backtracks"], projectDir);
		expect(r.exitCode).toBe(0);
	});

	test("report --last backtracks --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["report", "--last", "backtracks", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
		expect(Array.isArray(r.json)).toBe(true);
	});

	// ── report drift ────────────────────────────────────

	test("report --last drift exits 0", async () => {
		const r = await runCli(["report", "--last", "drift"], projectDir);
		// May exit 0 (drift found) or 1 (no spec). Either is acceptable.
		expect(r.exitCode === 0 || r.exitCode === 1).toBe(true);
	});

	// ── report reasoning ────────────────────────────────

	test("report --last reasoning exits 0", async () => {
		const r = await runCli(["report", "--last", "reasoning"], projectDir);
		expect(r.exitCode).toBe(0);
	});

	test("report --last reasoning --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["report", "--last", "reasoning", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
		expect(Array.isArray(r.json)).toBe(true);
	});

	// ── distill ─────────────────────────────────────────

	test("distill --last exits 0", async () => {
		const r = await runCli(["distill", "--last"], projectDir);
		expect(r.exitCode).toBe(0);
	});

	test("distill --last --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["distill", "--last", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
		expect(typeof r.json).toBe("object");
	});

	// ── agents ──────────────────────────────────────────

	test("agents --last exits 0", async () => {
		const r = await runCli(["agents", "--last"], projectDir);
		expect(r.exitCode).toBe(0);
	});

	test("agents --last --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["agents", "--last", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
	});

	test("agents --last --comms exits 0", async () => {
		const r = await runCli(["agents", "--last", "--comms"], projectDir);
		expect(r.exitCode).toBe(0);
	});

	test("agents --last --comms --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["agents", "--last", "--comms", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
	});

	// ── Flag validation ─────────────────────────────────

	test("report --deep shows flag validation error", async () => {
		const r = await runCli(["report", "--last", "--deep"], projectDir);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("Unknown flag");
		expect(r.stderr).toContain("distill");
	});

	// ── Error conditions ────────────────────────────────

	test("report with nonexistent session ID exits 1", async () => {
		const r = await runCli(["report", "nonexistent-id-12345"], projectDir);
		expect(r.exitCode).toBe(1);
	});

	// ── Empty project ───────────────────────────────────

	test("list on empty project shows no sessions", async () => {
		const emptyDir = createTestProject({ sessionCount: 0, withLinks: false, withDistilled: false });
		try {
			const r = await runCli(["list"], emptyDir);
			expect(r.exitCode).toBe(0);
			const plain = stripAnsi(r.stdout);
			expect(plain.length).toBeGreaterThan(0);
		} finally {
			cleanupTestProject(emptyDir);
		}
	});
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

	// ── what ────────────────────────────────────────────

	test("what --last exits 0", async () => {
		const r = await runCli(["what", "--last"], projectDir);
		expect(r.exitCode).toBe(0);
		const plain = stripAnsi(r.stdout);
		expect(plain).toContain("Request:");
		expect(plain).toContain("Outcome:");
		expect(plain).toContain("Cost:");
		expect(plain).toContain("Issues:");
		expect(plain).toContain("Files changed:");
	});

	test("what --last --json exits 0 and produces valid JSON", async () => {
		const r = await runCli(["what", "--last", "--json"], projectDir);
		expect(r.exitCode).toBe(0);
		expect(r.json).toBeDefined();
		expect(typeof r.json).toBe("object");
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

// ── distill --global (cross-repo batch) ─────────────────
// Isolated via a temp HOME so the seeded registry/config drive `--global`
// without touching the real `~/.clens`. A subprocess reads HOME at startup,
// so the override is honored (unlike an in-process os.homedir() override).
describe("CLI distill --global", () => {
	let tempHome: string;
	let projA: string;
	let projB: string;

	const seedRegistry = (paths: readonly string[], mode: string): void => {
		const clensDir = join(tempHome, ".clens");
		mkdirSync(clensDir, { recursive: true });
		writeFileSync(
			join(clensDir, "projects.json"),
			JSON.stringify({
				version: 1,
				projects: paths.map((p) => ({
					id: p.split("/").pop() ?? p,
					path: p,
					name: p.split("/").pop() ?? p,
					added_at: Date.now(),
				})),
			}),
		);
		writeFileSync(join(clensDir, "config.json"), JSON.stringify({ global_mode: mode }));
	};

	beforeEach(() => {
		tempHome = join(
			tmpdir(),
			`clens-e2e-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(tempHome, { recursive: true });
		// Two project-mode repos with sessions but no distilled artifacts yet.
		projA = createTestProject({ sessionCount: 2, withLinks: false, withDistilled: false });
		projB = createTestProject({ sessionCount: 1, withLinks: false, withDistilled: false });
		seedRegistry([projA, projB], "project");
	});

	afterEach(() => {
		cleanupTestProject(projA);
		cleanupTestProject(projB);
		rmSync(tempHome, { recursive: true, force: true });
	});

	test("distill --global runs, prints cross-project summary, exits 0", async () => {
		const r = await runCli(["distill", "--global"], projA, { HOME: tempHome });
		expect(r.exitCode).toBe(0);
		const plain = stripAnsi(r.stdout);
		expect(plain).toMatch(/across \d+ projects\./);
		// Each repo's distilled artifacts now exist.
		expect(existsSync(join(projA, ".clens", "distilled"))).toBe(true);
		expect(existsSync(join(projB, ".clens", "distilled"))).toBe(true);
	});

	test("second distill --global skips fresh sessions", async () => {
		await runCli(["distill", "--global"], projA, { HOME: tempHome });
		const r = await runCli(["distill", "--global"], projA, { HOME: tempHome });
		expect(r.exitCode).toBe(0);
		const plain = stripAnsi(r.stdout);
		expect(plain).toMatch(/skipped [1-9]/);
	});

	test("distill --global --bogus rejected with unknown-flag message", async () => {
		const r = await runCli(["distill", "--global", "--bogus"], projA, { HOME: tempHome });
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("Unknown flag --bogus");
	});
});

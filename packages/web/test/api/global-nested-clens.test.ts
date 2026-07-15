import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectEntry } from "@silou/clens";
import { createApp } from "../../src/server/app";

// Regression for repo-mode-nested-clens-projects-dropped (web serving half).
//
// In global "repository" mode a registered project's `path` is the git root,
// but its capture dir (`.clens/sessions/`) can live in a nested package — e.g.
// gitRoot/packages/web/.clens/sessions. The CLI registry half already keeps such
// repos in /api/projects; these tests pin that the WEB routes also list, resolve,
// and distill their sessions instead of silently returning zero.

const SESSION_NESTED = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SESSION_DEEP = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const makeEvent = (event: string, t: number, sid: string, data: Record<string, unknown> = {}) =>
	JSON.stringify({ event, t, sid, data, context: { git_branch: "main" } });

const writeSession = (captureDir: string, sid: string, start: number, end: number): void => {
	mkdirSync(join(captureDir, ".clens", "sessions"), { recursive: true });
	mkdirSync(join(captureDir, ".clens", "distilled"), { recursive: true });
	writeFileSync(
		join(captureDir, ".clens", "sessions", `${sid}.jsonl`),
		`${[
			makeEvent("SessionStart", start, sid, { source: "cli" }),
			makeEvent("SessionEnd", end, sid, { reason: "done" }),
		].join("\n")}\n`,
	);
};

describe("web API — global mode with nested .clens capture dirs", () => {
	let tempDir: string;
	let gitRoot: string;
	let nestedCapture: string;
	let deepCapture: string;
	let projects: ProjectEntry[];
	let app: ReturnType<typeof createApp>;

	beforeAll(() => {
		tempDir = join(tmpdir(), `clens-test-web-nested-${Date.now()}`);

		// gitRoot itself has NO .clens — only nested packages do. This is exactly
		// the shape the registry fix (hasReachableClensDir) now keeps registered.
		gitRoot = join(tempDir, "monorepo");
		nestedCapture = join(gitRoot, "packages", "web");
		deepCapture = join(gitRoot, "apps", "api", "service");

		writeSession(nestedCapture, SESSION_NESTED, 1000, 2000);
		writeSession(deepCapture, SESSION_DEEP, 3000, 4000);

		// Registry resolution registers the git root as the project path.
		projects = [{ id: "monorepo", path: gitRoot, name: "monorepo", added_at: Date.now() }];

		app = createApp({
			token: "test-token",
			mode: "development",
			projectDir: gitRoot,
			projects,
		});
	});

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("GET /api/sessions lists sessions from nested capture dirs", async () => {
		const res = await app.request("/api/sessions");
		expect(res.status).toBe(200);
		const body = await res.json();

		const ids = body.data.map((s: Record<string, unknown>) => s.session_id);
		expect(ids).toContain(SESSION_NESTED);
		expect(ids).toContain(SESSION_DEEP);

		// All tagged with the owning git-root project identity.
		const projectIds = body.data.map((s: Record<string, unknown>) => s.project_id);
		expect(projectIds).toContain("monorepo");
	});

	test("GET /api/sessions/:id resolves a nested session (not 404)", async () => {
		const res = await app.request(`/api/sessions/${SESSION_NESTED}`);
		// 202 = found the session file but not distilled yet. A 404 would mean
		// the route resolved the bare git root and missed the nested capture dir.
		expect([200, 202]).toContain(res.status);
	});

	test("GET /api/sessions/:id resolves a deeply-nested session (not 404)", async () => {
		const res = await app.request(`/api/sessions/${SESSION_DEEP}`);
		expect([200, 202]).toContain(res.status);
	});

	test("still 404s for a genuinely unknown session", async () => {
		const res = await app.request("/api/sessions/99999999-9999-9999-9999-999999999999");
		expect(res.status).toBe(404);
	});

	test("POST distill resolves the nested session (starts, not 404)", async () => {
		const res = await app.request(`/api/commands/sessions/${SESSION_NESTED}/distill`, {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("started");
	});

	test("POST distill still 404s for an unknown session", async () => {
		const res = await app.request(
			"/api/commands/sessions/99999999-9999-9999-9999-999999999999/distill",
			{
				method: "POST",
			},
		);
		expect(res.status).toBe(404);
	});
});

describe("web API — global analytics with nested .clens capture dirs", () => {
	let tempDir: string;
	let gitRoot: string;
	let nestedCapture: string;
	let projects: ProjectEntry[];
	let app: ReturnType<typeof createApp>;

	const ANALYTICS_SESSION = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

	const writeDistilled = (
		captureDir: string,
		sid: string,
		startMs: number,
		costUsd: number,
	): void => {
		mkdirSync(join(captureDir, ".clens", "distilled"), { recursive: true });
		writeFileSync(
			join(captureDir, ".clens", "distilled", `${sid}.json`),
			JSON.stringify({
				session_id: sid,
				start_time: startMs,
				stats: {
					total_events: 10,
					duration_ms: 5000,
					events_by_type: {},
					tools_by_name: { Bash: 3 },
					tool_call_count: 3,
					failure_count: 0,
					failure_rate: 0,
					unique_files: [],
					failures_by_tool: {},
					cost_estimate: {
						model: "claude-fable-5",
						estimated_input_tokens: 100,
						estimated_output_tokens: 50,
						estimated_cost_usd: costUsd,
						is_estimated: false,
					},
				},
				backtracks: [],
				decisions: [],
				file_map: { files: [] },
				git_diff: { commits: [], hunks: [] },
				edit_chains: { chains: [] },
				reasoning: [],
				user_messages: [],
				complete: true,
			}),
		);
	};

	beforeAll(() => {
		tempDir = join(tmpdir(), `clens-test-web-nested-analytics-${Date.now()}`);
		gitRoot = join(tempDir, "monorepo");
		nestedCapture = join(gitRoot, "packages", "web");

		// Nested capture dir only — no .clens at the git root.
		const startMs = Date.now() - 24 * 60 * 60 * 1000; // ~1 day ago, inside default window
		writeSession(nestedCapture, ANALYTICS_SESSION, startMs, startMs + 5000);
		writeDistilled(nestedCapture, ANALYTICS_SESSION, startMs, 4.2);

		projects = [{ id: "monorepo", path: gitRoot, name: "monorepo", added_at: Date.now() }];

		app = createApp({
			token: "test-token",
			mode: "development",
			projectDir: gitRoot,
			projects,
		});
	});

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("POST /rebuild discovers the nested distilled session", async () => {
		const res = await app.request("/api/analytics/rebuild", { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json();
		// A git-root-only scan would rebuild 0; the nested capture dir yields 1.
		expect(body.data.rebuilt).toBeGreaterThanOrEqual(1);
	});

	test("GET /usage reflects the nested session's cost", async () => {
		await app.request("/api/analytics/rebuild", { method: "POST" });
		const res = await app.request("/api/analytics/usage?range=30d");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.totals.cost_usd).toBeGreaterThan(0);
	});
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	registerProject,
	unregisterProject,
} from "../src/session/registry";
import {
	listGlobalSessions,
	listGlobalWorkUnits,
	resolveProjectForSession,
} from "../src/session/global-read";

const SESSION_A1 = "aaaaaaaa-1111-1111-1111-111111111111";
const SESSION_A2 = "aaaaaaaa-2222-2222-2222-222222222222";
const SESSION_B1 = "bbbbbbbb-1111-1111-1111-111111111111";

const makeEvent = (event: string, t: number, data: Record<string, unknown> = {}, sid: string = SESSION_A1) =>
	JSON.stringify({ event, t, sid, data, context: { git_branch: "main" } });

describe("global-read", () => {
	let tempDir: string;
	let projectA: string;
	let projectB: string;

	beforeEach(() => {
		tempDir = join(
			tmpdir(),
			`clens-test-global-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);

		projectA = join(tempDir, "project-alpha");
		projectB = join(tempDir, "project-beta");

		mkdirSync(join(projectA, ".clens", "sessions"), { recursive: true });
		mkdirSync(join(projectA, ".clens", "distilled"), { recursive: true });
		mkdirSync(join(projectB, ".clens", "sessions"), { recursive: true });
		mkdirSync(join(projectB, ".clens", "distilled"), { recursive: true });

		// Project A: two sessions
		writeFileSync(
			join(projectA, ".clens", "sessions", `${SESSION_A1}.jsonl`),
			[
				makeEvent("SessionStart", 1000, { source: "cli" }, SESSION_A1),
				makeEvent("SessionEnd", 2000, { reason: "done" }, SESSION_A1),
			].join("\n") + "\n",
		);
		writeFileSync(
			join(projectA, ".clens", "sessions", `${SESSION_A2}.jsonl`),
			[
				makeEvent("SessionStart", 3000, { source: "cli" }, SESSION_A2),
				makeEvent("SessionEnd", 5000, { reason: "done" }, SESSION_A2),
			].join("\n") + "\n",
		);

		// Project B: one session (most recent)
		writeFileSync(
			join(projectB, ".clens", "sessions", `${SESSION_B1}.jsonl`),
			[
				makeEvent("SessionStart", 6000, { source: "cli" }, SESSION_B1),
				makeEvent("SessionEnd", 8000, { reason: "done" }, SESSION_B1),
			].join("\n") + "\n",
		);

		registerProject(projectA);
		registerProject(projectB);
	});

	afterEach(() => {
		unregisterProject(projectA);
		unregisterProject(projectB);
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("listGlobalSessions", () => {
		test("returns sessions from all registered projects", () => {
			const sessions = listGlobalSessions();

			const testSessions = sessions.filter(
				(s) => s.project_name === "project-alpha" || s.project_name === "project-beta",
			);
			expect(testSessions.length).toBe(3);
		});

		test("tags sessions with project_id and project_name", () => {
			const sessions = listGlobalSessions();

			const alphaSession = sessions.find((s) => s.session_id === SESSION_A1);
			expect(alphaSession).toBeDefined();
			expect(alphaSession?.project_id).toBe("project-alpha");
			expect(alphaSession?.project_name).toBe("project-alpha");

			const betaSession = sessions.find((s) => s.session_id === SESSION_B1);
			expect(betaSession).toBeDefined();
			expect(betaSession?.project_id).toBe("project-beta");
			expect(betaSession?.project_name).toBe("project-beta");
		});

		test("sorts by start_time descending", () => {
			const sessions = listGlobalSessions();

			const testSessions = sessions.filter(
				(s) => s.project_name === "project-alpha" || s.project_name === "project-beta",
			);

			// Most recent first (project-beta t=6000 > project-alpha t=3000 > t=1000)
			expect(testSessions.length).toBeGreaterThanOrEqual(2);
			expect(testSessions[0].start_time).toBeGreaterThanOrEqual(testSessions[1].start_time);

			if (testSessions.length >= 3) {
				expect(testSessions[1].start_time).toBeGreaterThanOrEqual(testSessions[2].start_time);
			}
		});

		test("includes session metadata from JSONL", () => {
			const sessions = listGlobalSessions();
			const session = sessions.find((s) => s.session_id === SESSION_A1);

			expect(session).toBeDefined();
			expect(session?.start_time).toBe(1000);
			expect(session?.status).toBe("complete");
		});
	});

	describe("listGlobalWorkUnits", () => {
		test("returns empty when no work unit indices exist", () => {
			const units = listGlobalWorkUnits();
			// Filter to our test projects only
			const testUnits = units.filter(
				(u) => u.project_name === "project-alpha" || u.project_name === "project-beta",
			);
			expect(testUnits.length).toBe(0);
		});

		test("returns units tagged with project info when index exists", () => {
			const index = {
				version: 1,
				updated_at: Date.now(),
				units: [
					{
						id: "unit-alpha-1",
						link_type: "spec",
						spec_path: "specs/plan.md",
						sessions: [
							{
								session_id: SESSION_A1,
								phase: "plan",
								role: "creator",
								start_time: 1000,
								duration_ms: 1000,
							},
						],
						lifecycle: "plan",
						total_duration_ms: 1000,
						date_range: { start: 1000, end: 2000 },
					},
				],
			};
			writeFileSync(
				join(projectA, ".clens", "_work_units.json"),
				JSON.stringify(index),
			);

			const units = listGlobalWorkUnits();
			const alphaUnits = units.filter((u) => u.project_id === "project-alpha");
			expect(alphaUnits.length).toBe(1);
			expect(alphaUnits[0].project_name).toBe("project-alpha");
			expect(alphaUnits[0].id).toBe("unit-alpha-1");
		});
	});

	describe("resolveProjectForSession", () => {
		test("finds the correct project for a session ID", () => {
			const projectForA = resolveProjectForSession(SESSION_A1);
			expect(projectForA).toBeDefined();
			expect(projectForA?.name).toBe("project-alpha");

			const projectForB = resolveProjectForSession(SESSION_B1);
			expect(projectForB).toBeDefined();
			expect(projectForB?.name).toBe("project-beta");
		});

		test("returns undefined for unknown session ID", () => {
			const result = resolveProjectForSession("nonexistent-session-id-12345");
			expect(result).toBeUndefined();
		});
	});
});

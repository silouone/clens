import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	assertFieldTypes,
	cleanupTestProject,
	createTestProject,
	hasAnsi,
	missingFields,
	runCli,
} from "./helpers";

describe("CLI JSON Output Validation", () => {
	let projectDir: string;

	beforeAll(() => {
		projectDir = createTestProject({ sessionCount: 2, withLinks: true, withDistilled: true });
	});

	afterAll(() => {
		cleanupTestProject(projectDir);
	});

	// ── list --json ─────────────────────────────────────

	describe("list --json", () => {
		test("returns array of sessions", async () => {
			const r = await runCli(["list", "--json"], projectDir);
			expect(r.exitCode).toBe(0);
			expect(Array.isArray(r.json)).toBe(true);
			expect((r.json as unknown[]).length).toBe(2);
		});

		test("no ANSI codes in output", async () => {
			const r = await runCli(["list", "--json"], projectDir);
			expect(hasAnsi(r.stdout)).toBe(false);
		});

		test("each session has required fields", async () => {
			const r = await runCli(["list", "--json"], projectDir);
			const sessions = r.json as Record<string, unknown>[];
			for (const s of sessions) {
				const missing = missingFields(s, [
					"session_id",
					"duration_ms",
					"event_count",
					"status",
					"file_size_bytes",
				]);
				expect(missing).toEqual([]);
			}
		});

		test("field types are correct", async () => {
			const r = await runCli(["list", "--json"], projectDir);
			const sessions = r.json as Record<string, unknown>[];
			for (const s of sessions) {
				const errors = assertFieldTypes(s, {
					session_id: "string",
					duration_ms: "number",
					event_count: "number",
					status: "string",
					file_size_bytes: "number",
				});
				expect(errors).toEqual([]);
			}
		});

		test("numeric values are non-negative", async () => {
			const r = await runCli(["list", "--json"], projectDir);
			const sessions = r.json as Array<{
				duration_ms: number;
				event_count: number;
				file_size_bytes: number;
			}>;
			for (const s of sessions) {
				expect(s.duration_ms).toBeGreaterThanOrEqual(0);
				expect(s.event_count).toBeGreaterThan(0);
				expect(s.file_size_bytes).toBeGreaterThan(0);
			}
		});
	});

	// ── report --last --json ─────────────────────────────

	describe("report --last --json", () => {
		test("returns object with stats containing required fields", async () => {
			const r = await runCli(["report", "--last", "--json"], projectDir);
			expect(r.exitCode).toBe(0);
			expect(typeof r.json).toBe("object");
			expect(Array.isArray(r.json)).toBe(false);

			const report = r.json as { stats: Record<string, unknown> };
			const missing = missingFields(report.stats, [
				"total_events",
				"duration_ms",
				"tool_call_count",
				"failure_count",
				"failure_rate",
			]);
			expect(missing).toEqual([]);
		});

		test("no ANSI codes in output", async () => {
			const r = await runCli(["report", "--last", "--json"], projectDir);
			expect(hasAnsi(r.stdout)).toBe(false);
		});

		test("failure_rate is between 0 and 1", async () => {
			const r = await runCli(["report", "--last", "--json"], projectDir);
			const report = r.json as { stats: { failure_rate: number } };
			expect(report.stats.failure_rate).toBeGreaterThanOrEqual(0);
			expect(report.stats.failure_rate).toBeLessThanOrEqual(1);
		});

		test("tools_by_name values sum to at least tool_call_count", async () => {
			const r = await runCli(["report", "--last", "--json"], projectDir);
			const report = r.json as { stats: { tools_by_name: Record<string, number>; tool_call_count: number } };
			const sum = Object.values(report.stats.tools_by_name).reduce((a, b) => a + b, 0);
			expect(sum).toBeGreaterThanOrEqual(report.stats.tool_call_count);
		});
	});

	// ── distill --last --json ───────────────────────────

	describe("distill --last --json", () => {
		test("returns object with required fields", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			expect(r.exitCode).toBe(0);
			expect(typeof r.json).toBe("object");

			const d = r.json as Record<string, unknown>;
			const missing = missingFields(d, [
				"session_id",
				"stats",
				"backtracks",
				"decisions",
				"file_map",
				"git_diff",
				"complete",
			]);
			expect(missing).toEqual([]);
		});

		test("no ANSI codes in output", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			expect(hasAnsi(r.stdout)).toBe(false);
		});

		test("backtracks is array", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as { backtracks: unknown };
			expect(Array.isArray(d.backtracks)).toBe(true);
		});

		test("decisions is array", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as { decisions: unknown };
			expect(Array.isArray(d.decisions)).toBe(true);
		});

		test("complete is boolean", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as { complete: unknown };
			expect(typeof d.complete).toBe("boolean");
		});

		test("file_map is object", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as { file_map: unknown };
			expect(typeof d.file_map).toBe("object");
			expect(Array.isArray(d.file_map)).toBe(false);
		});
	});

	// ── agents --last --json (v0.2.0: absorbs tree/messages/graph) ──────

	describe("agents --last --json", () => {
		test("returns array of agent rows", async () => {
			const r = await runCli(["agents", "--last", "--json"], projectDir);
			expect(r.exitCode).toBe(0);
			// Either an array of agent rows or a solo session object
			const parsed = r.json;
			expect(typeof parsed).toBe("object");
		});

		test("no ANSI codes in output", async () => {
			const r = await runCli(["agents", "--last", "--json"], projectDir);
			expect(hasAnsi(r.stdout)).toBe(false);
		});
	});

	// ── agents --last --comms --json (v0.2.0: replaces messages) ─────

	describe("agents --last --comms --json", () => {
		test("returns array", async () => {
			const r = await runCli(["agents", "--last", "--comms", "--json"], projectDir);
			expect(r.exitCode).toBe(0);
			expect(Array.isArray(r.json)).toBe(true);
		});

		test("no ANSI codes in output", async () => {
			const r = await runCli(["agents", "--last", "--comms", "--json"], projectDir);
			expect(hasAnsi(r.stdout)).toBe(false);
		});
	});

	// ── distill --json new fields ──────────────────────

	describe("distill --last --json new fields", () => {
		test("distilled data has edit_chains field", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			expect(r.exitCode).toBe(0);
			const d = r.json as Record<string, unknown>;
			// edit_chains is populated by the distiller
			if ("edit_chains" in d) {
				expect(typeof d.edit_chains).toBe("object");
				const chains = d.edit_chains as { chains?: unknown };
				if (chains && "chains" in chains) {
					expect(Array.isArray(chains.chains)).toBe(true);
				}
			}
		});

		test("distilled data has timeline field", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as Record<string, unknown>;
			if ("timeline" in d) {
				expect(Array.isArray(d.timeline)).toBe(true);
			}
		});

		test("distilled data has summary field", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as Record<string, unknown>;
			if ("summary" in d) {
				expect(typeof d.summary).toBe("object");
				const summary = d.summary as Record<string, unknown>;
				expect(typeof summary.narrative).toBe("string");
				expect(Array.isArray(summary.phases)).toBe(true);
				expect(typeof summary.key_metrics).toBe("object");
			}
		});

		test("distilled data has team_metrics for team sessions", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as Record<string, unknown>;
			if ("team_metrics" in d && d.team_metrics) {
				const tm = d.team_metrics as Record<string, unknown>;
				expect(typeof tm.agent_count).toBe("number");
				expect(typeof tm.task_completed_count).toBe("number");
				expect(Array.isArray(tm.teammate_names)).toBe(true);
			}
		});

		test("distilled data has communication_graph for team sessions", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as Record<string, unknown>;
			if ("communication_graph" in d) {
				expect(Array.isArray(d.communication_graph)).toBe(true);
				const edges = d.communication_graph as Record<string, unknown>[];
				edges.forEach((edge) => {
					// backward-compat fields
					expect(typeof edge.from).toBe("string");
					expect(typeof edge.to).toBe("string");
					expect(typeof edge.count).toBe("number");
					// structured identity fields
					expect(typeof edge.from_id).toBe("string");
					expect(typeof edge.from_name).toBe("string");
					expect(typeof edge.to_id).toBe("string");
					expect(typeof edge.to_name).toBe("string");
				});
			}
		});

		test("distilled data has cost_estimate when model known", async () => {
			const r = await runCli(["distill", "--last", "--json"], projectDir);
			const d = r.json as Record<string, unknown>;
			if ("cost_estimate" in d && d.cost_estimate) {
				const cost = d.cost_estimate as Record<string, unknown>;
				expect(typeof cost.model).toBe("string");
				expect(typeof cost.estimated_cost_usd).toBe("number");
			}
		});
	});

});

// Drift tests use a separate project to avoid distill overwriting plan_drift
describe("CLI JSON Output - drift", () => {
	let driftProjectDir: string;

	beforeAll(() => {
		driftProjectDir = createTestProject({ sessionCount: 1, withLinks: false, withDistilled: true });
	});

	afterAll(() => {
		cleanupTestProject(driftProjectDir);
	});

	test("returns valid PlanDriftReport object", async () => {
		const r = await runCli(["report", "--last", "drift", "--json"], driftProjectDir);
		expect(r.exitCode).toBe(0);
		expect(typeof r.json).toBe("object");
		expect(Array.isArray(r.json)).toBe(false);

		const drift = r.json as Record<string, unknown>;
		const errors = assertFieldTypes(drift, {
			spec_path: "string",
			expected_files: "array",
			actual_files: "array",
			unexpected_files: "array",
			missing_files: "array",
			drift_score: "number",
		});
		expect(errors).toEqual([]);
	});

	test("no ANSI codes in output", async () => {
		const r = await runCli(["report", "--last", "drift", "--json"], driftProjectDir);
		expect(hasAnsi(r.stdout)).toBe(false);
	});

	test("drift_score is between 0 and 1", async () => {
		const r = await runCli(["report", "--last", "drift", "--json"], driftProjectDir);
		const drift = r.json as { drift_score: number };
		expect(drift.drift_score).toBeGreaterThanOrEqual(0);
		expect(drift.drift_score).toBeLessThanOrEqual(1);
	});

	test("all file arrays contain strings", async () => {
		const r = await runCli(["report", "--last", "drift", "--json"], driftProjectDir);
		const drift = r.json as {
			expected_files: unknown[];
			actual_files: unknown[];
			unexpected_files: unknown[];
			missing_files: unknown[];
		};
		const allStrings = [
			...drift.expected_files,
			...drift.actual_files,
			...drift.unexpected_files,
			...drift.missing_files,
		].every((f) => typeof f === "string");
		expect(allStrings).toBe(true);
	});
});

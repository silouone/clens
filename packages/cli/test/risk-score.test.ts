import { describe, test, expect } from "bun:test";
import { computeFileRiskScores } from "../src/distill/risk-score";
import type { DistilledSession } from "../src/types";

const makeDistilled = (overrides: Partial<DistilledSession> = {}): DistilledSession => ({
	session_id: "test-session",
	stats: {
		total_events: 10,
		duration_ms: 5000,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 5,
		failure_count: 0,
		failure_rate: 0,
		unique_files: [],
	},
	backtracks: [],
	decisions: [],
	file_map: { files: [] },
	git_diff: { commits: [], hunks: [] },
	reasoning: [],
	user_messages: [],
	complete: true,
	...overrides,
});

describe("computeFileRiskScores", () => {
	test("returns empty array for empty file_map", () => {
		const result = computeFileRiskScores(makeDistilled());
		expect(result).toEqual([]);
	});

	test("returns low risk for clean files", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/clean.ts", reads: 2, edits: 1, writes: 0, errors: 0, tool_use_ids: ["t1"] },
					],
				},
			}),
		);

		expect(result.length).toBe(1);
		expect(result[0].file_path).toBe("src/clean.ts");
		expect(result[0].risk_level).toBe("low");
		expect(result[0].backtrack_count).toBe(0);
		expect(result[0].abandoned_edit_count).toBe(0);
	});

	test("returns medium risk for 1-2 backtracks", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/risky.ts", reads: 3, edits: 4, writes: 0, errors: 1, tool_use_ids: ["t1"] },
					],
				},
				backtracks: [
					{ type: "failure_retry", tool_name: "Edit", file_path: "src/risky.ts", attempts: 2, start_t: 100, end_t: 200, tool_use_ids: ["t1", "t2"] },
				],
			}),
		);

		expect(result.length).toBe(1);
		expect(result[0].risk_level).toBe("medium");
		expect(result[0].backtrack_count).toBe(1);
	});

	test("returns medium risk for some abandoned edits", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/abandoned.ts", reads: 1, edits: 3, writes: 0, errors: 0, tool_use_ids: ["t1"] },
					],
				},
				edit_chains: {
					chains: [
						{
							file_path: "src/abandoned.ts",
							steps: [],
							total_edits: 4,
							total_failures: 0,
							total_reads: 1,
							effort_ms: 1000,
							has_backtrack: false,
							surviving_edit_ids: ["e1", "e2", "e3"],
							abandoned_edit_ids: ["e4"],
						},
					],
				},
			}),
		);

		expect(result.length).toBe(1);
		expect(result[0].risk_level).toBe("medium");
		expect(result[0].abandoned_edit_count).toBe(1);
		expect(result[0].total_edit_count).toBe(4);
	});

	test("returns high risk for 3+ backtracks", () => {
		const backtracks = Array.from({ length: 3 }, (_, i) => ({
			type: "failure_retry" as const,
			tool_name: "Edit",
			file_path: "src/bad.ts",
			attempts: 2,
			start_t: i * 100,
			end_t: i * 100 + 50,
			tool_use_ids: [`t${i}`],
		}));

		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/bad.ts", reads: 5, edits: 8, writes: 0, errors: 3, tool_use_ids: ["t1"] },
					],
				},
				backtracks,
			}),
		);

		expect(result.length).toBe(1);
		expect(result[0].risk_level).toBe("high");
		expect(result[0].backtrack_count).toBe(3);
	});

	test("returns high risk for >50% abandoned edits", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/messy.ts", reads: 1, edits: 6, writes: 0, errors: 0, tool_use_ids: ["t1"] },
					],
				},
				edit_chains: {
					chains: [
						{
							file_path: "src/messy.ts",
							steps: [],
							total_edits: 6,
							total_failures: 0,
							total_reads: 1,
							effort_ms: 2000,
							has_backtrack: false,
							surviving_edit_ids: ["e1", "e2"],
							abandoned_edit_ids: ["e3", "e4", "e5", "e6"],
						},
					],
				},
			}),
		);

		expect(result.length).toBe(1);
		expect(result[0].risk_level).toBe("high");
		expect(result[0].abandoned_edit_count).toBe(4);
	});

	test("returns high risk for failure rate >30%", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/failing.ts", reads: 1, edits: 5, writes: 0, errors: 2, tool_use_ids: ["t1"] },
					],
				},
				edit_chains: {
					chains: [
						{
							file_path: "src/failing.ts",
							steps: [],
							total_edits: 5,
							total_failures: 2,
							total_reads: 1,
							effort_ms: 1500,
							has_backtrack: false,
							surviving_edit_ids: ["e1", "e2", "e3"],
							abandoned_edit_ids: [],
						},
					],
				},
			}),
		);

		expect(result.length).toBe(1);
		expect(result[0].risk_level).toBe("high");
		expect(result[0].failure_rate).toBeCloseTo(0.4);
	});

	test("handles multiple files with different risk levels", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/clean.ts", reads: 1, edits: 1, writes: 0, errors: 0, tool_use_ids: ["t1"] },
						{ file_path: "src/risky.ts", reads: 3, edits: 4, writes: 0, errors: 1, tool_use_ids: ["t2"] },
					],
				},
				backtracks: [
					{ type: "debugging_loop", tool_name: "Edit", file_path: "src/risky.ts", attempts: 3, start_t: 100, end_t: 200, tool_use_ids: ["t2"] },
				],
			}),
		);

		expect(result.length).toBe(2);

		const clean = result.find((r) => r.file_path === "src/clean.ts");
		const risky = result.find((r) => r.file_path === "src/risky.ts");

		expect(clean?.risk_level).toBe("low");
		expect(risky?.risk_level).toBe("medium");
	});

	test("counts backtracks only for matching file_path", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/a.ts", reads: 1, edits: 1, writes: 0, errors: 0, tool_use_ids: ["t1"] },
						{ file_path: "src/b.ts", reads: 1, edits: 1, writes: 0, errors: 0, tool_use_ids: ["t2"] },
					],
				},
				backtracks: [
					{ type: "failure_retry", tool_name: "Edit", file_path: "src/b.ts", attempts: 2, start_t: 100, end_t: 200, tool_use_ids: ["t2"] },
				],
			}),
		);

		const a = result.find((r) => r.file_path === "src/a.ts");
		const b = result.find((r) => r.file_path === "src/b.ts");

		expect(a?.backtrack_count).toBe(0);
		expect(a?.risk_level).toBe("low");
		expect(b?.backtrack_count).toBe(1);
		expect(b?.risk_level).toBe("medium");
	});

	test("file with no edit chains has 0 edit metrics", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/readonly.ts", reads: 5, edits: 0, writes: 0, errors: 0, tool_use_ids: ["t1"] },
					],
				},
			}),
		);

		expect(result[0].total_edit_count).toBe(0);
		expect(result[0].abandoned_edit_count).toBe(0);
		expect(result[0].failure_rate).toBe(0);
		expect(result[0].edit_chain_length).toBe(0);
		expect(result[0].risk_level).toBe("low");
	});

	test("edit_chain_length counts chains per file", () => {
		const result = computeFileRiskScores(
			makeDistilled({
				file_map: {
					files: [
						{ file_path: "src/multi.ts", reads: 1, edits: 4, writes: 0, errors: 0, tool_use_ids: ["t1"] },
					],
				},
				edit_chains: {
					chains: [
						{ file_path: "src/multi.ts", steps: [], total_edits: 2, total_failures: 0, total_reads: 1, effort_ms: 500, has_backtrack: false, surviving_edit_ids: ["e1", "e2"], abandoned_edit_ids: [] },
						{ file_path: "src/multi.ts", steps: [], total_edits: 2, total_failures: 0, total_reads: 0, effort_ms: 300, has_backtrack: false, surviving_edit_ids: ["e3", "e4"], abandoned_edit_ids: [] },
					],
				},
			}),
		);

		expect(result[0].edit_chain_length).toBe(2);
		expect(result[0].total_edit_count).toBe(4);
	});
});

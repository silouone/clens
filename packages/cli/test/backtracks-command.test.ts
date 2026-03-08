import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderBacktracksSummary, renderBacktracksDetail } from "../src/commands/backtracks";
import type { BacktrackResult, DistilledSession } from "../src/types";

// -- ANSI stripping helper --

const stripAnsi = (s: string): string =>
	s.replace(/\x1b\[[0-9;]*m/g, "");

// -- Fixture factories --

const makeBacktrack = (
	overrides: Partial<BacktrackResult> = {},
): BacktrackResult => ({
	type: "failure_retry",
	tool_name: "Edit",
	file_path: "src/foo.ts",
	attempts: 3,
	start_t: 1000000,
	end_t: 1010000,
	tool_use_ids: ["id1", "id2", "id3"],
	error_message: "Old string not found in file",
	...overrides,
});

const makeDistilled = (
	overrides: Partial<DistilledSession> = {},
): DistilledSession => ({
	session_id: "test1234-5678-uuid",
	stats: {
		duration_ms: 60000,
		total_events: 100,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 50,
		failure_count: 5,
		failure_rate: 0.1,
		unique_files: [],
	},
	backtracks: [],
	decisions: [],
	file_map: { files: [] },
	git_diff: { commits: [], hunks: [] },
	complete: true,
	reasoning: [],
	user_messages: [],
	...overrides,
});

// =============================================================================
// renderBacktracksSummary
// =============================================================================

describe("renderBacktracksSummary", () => {
	test("0 backtracks shows '0 backtracks' in severity line", () => {
		const distilled = makeDistilled({ backtracks: [] });
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("0 backtracks");
	});

	test("mixed types (failure_retry + debugging_loop) shows both type labels", () => {
		const backtracks = [
			makeBacktrack({ type: "failure_retry" }),
			makeBacktrack({ type: "debugging_loop" }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("Failure Retry");
		expect(output).toContain("Debugging Loop");
	});

	test("severity classification: 1 backtrack yields LOW", () => {
		const backtracks = [makeBacktrack({ start_t: 1000, end_t: 2000 })];
		const distilled = makeDistilled({
			backtracks,
			stats: {
				duration_ms: 60000,
				total_events: 100,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 50,
				failure_count: 1,
				failure_rate: 0.02,
				unique_files: [],
			},
		});
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("LOW");
	});

	test("severity classification: 3 backtracks yields MEDIUM", () => {
		const backtracks = [
			makeBacktrack({ start_t: 1000, end_t: 2000 }),
			makeBacktrack({ start_t: 3000, end_t: 4000 }),
			makeBacktrack({ start_t: 5000, end_t: 6000 }),
		];
		const distilled = makeDistilled({
			backtracks,
			stats: {
				duration_ms: 60000,
				total_events: 100,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 50,
				failure_count: 3,
				failure_rate: 0.06,
				unique_files: [],
			},
		});
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("MEDIUM");
	});

	test("severity classification: 5+ backtracks yields HIGH", () => {
		const backtracks = [
			makeBacktrack({ start_t: 1000, end_t: 2000 }),
			makeBacktrack({ start_t: 3000, end_t: 4000 }),
			makeBacktrack({ start_t: 5000, end_t: 6000 }),
			makeBacktrack({ start_t: 7000, end_t: 8000 }),
			makeBacktrack({ start_t: 9000, end_t: 10000 }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("HIGH");
	});

	test("hot files: two backtracks on same file appear in hot files section", () => {
		const backtracks = [
			makeBacktrack({ file_path: "src/hot.ts" }),
			makeBacktrack({ file_path: "src/hot.ts" }),
			makeBacktrack({ file_path: "src/other.ts" }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("Hot files");
		expect(output).toContain("src/hot.ts");
		expect(output).toContain("2x");
	});

	test("costliest backtrack appears in summary", () => {
		const backtracks = [
			makeBacktrack({ attempts: 2, error_message: "minor issue" }),
			makeBacktrack({ attempts: 7, error_message: "big costly failure" }),
			makeBacktrack({ attempts: 3, error_message: "medium issue" }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("Costliest backtrack");
		expect(output).toContain("7 attempts");
	});

	test("time summary shows backtracking duration and percentage", () => {
		const backtracks = [
			makeBacktrack({ start_t: 0, end_t: 15000 }),
		];
		const distilled = makeDistilled({
			backtracks,
			stats: {
				duration_ms: 60000,
				total_events: 100,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 50,
				failure_count: 1,
				failure_rate: 0.02,
				unique_files: [],
			},
		});
		const output = stripAnsi(renderBacktracksSummary(distilled));
		expect(output).toContain("15s");
		expect(output).toContain("25.0%");
	});
});

// =============================================================================
// renderBacktracksDetail
// =============================================================================

describe("renderBacktracksDetail", () => {
	test("renders numbered headers for 2 backtracks", () => {
		const backtracks = [
			makeBacktrack({ tool_name: "Edit" }),
			makeBacktrack({ tool_name: "Bash" }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksDetail(distilled));
		expect(output).toContain("#1");
		expect(output).toContain("#2");
	});

	test("detail view shows tool name and attempts", () => {
		const backtracks = [
			makeBacktrack({ tool_name: "Edit", attempts: 5 }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksDetail(distilled));
		expect(output).toContain("Tool:       Edit");
		expect(output).toContain("Attempts:   5");
	});

	test("detail view shows file path when present", () => {
		const backtracks = [
			makeBacktrack({ file_path: "src/index.ts" }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksDetail(distilled));
		expect(output).toContain("File:       src/index.ts");
	});

	test("detail view omits file path when absent", () => {
		const backtracks = [
			makeBacktrack({ file_path: undefined }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksDetail(distilled));
		expect(output).not.toContain("File:");
	});

	test("detail header shows correct backtrack count", () => {
		const backtracks = [
			makeBacktrack({}),
			makeBacktrack({}),
			makeBacktrack({}),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksDetail(distilled));
		expect(output).toContain("3 Backtracks (Detail)");
	});

	test("detail view shows error message when present", () => {
		const backtracks = [
			makeBacktrack({ error_message: "Permission denied" }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksDetail(distilled));
		expect(output).toContain("Error:      Permission denied");
	});

	test("detail view shows command when present", () => {
		const backtracks = [
			makeBacktrack({ command: "bun test" }),
		];
		const distilled = makeDistilled({ backtracks });
		const output = stripAnsi(renderBacktracksDetail(distilled));
		expect(output).toContain("Command:    bun test");
	});
});


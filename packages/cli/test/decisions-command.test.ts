import { describe, expect, test } from "bun:test";
import { renderDecisionsSummary } from "../src/commands/decisions";
import type { DecisionPoint, DistilledSession } from "../src/types";

// -- ANSI stripping helper --

const stripAnsi = (s: string): string =>
	s.replace(/\x1b\[[0-9;]*m/g, "");

// -- Fixture factories --

const makeTimingGap = (
	overrides: Partial<Extract<DecisionPoint, { type: "timing_gap" }>> = {},
): Extract<DecisionPoint, { type: "timing_gap" }> => ({
	type: "timing_gap",
	t: 1000000,
	gap_ms: 30000,
	classification: "user_idle",
	...overrides,
});

const makeToolPivot = (
	overrides: Partial<Extract<DecisionPoint, { type: "tool_pivot" }>> = {},
): Extract<DecisionPoint, { type: "tool_pivot" }> => ({
	type: "tool_pivot",
	t: 1001000,
	from_tool: "Read",
	to_tool: "Edit",
	after_failure: true,
	...overrides,
});

const makePhaseBoundary = (
	overrides: Partial<Extract<DecisionPoint, { type: "phase_boundary" }>> = {},
): Extract<DecisionPoint, { type: "phase_boundary" }> => ({
	type: "phase_boundary",
	t: 1002000,
	phase_name: "Implementation",
	phase_index: 1,
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
// renderDecisionsSummary
// =============================================================================

describe("renderDecisionsSummary", () => {
	test("all three decision types render their respective sections", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTimingGap({}),
			makeToolPivot({}),
			makePhaseBoundary({}),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("Timing Gaps");
		expect(output).toContain("Tool Pivots");
		expect(output).toContain("Phase Boundaries");
	});

	test("header shows total decision point count", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTimingGap({}),
			makeToolPivot({}),
			makePhaseBoundary({}),
			makeTimingGap({ t: 2000000 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("4 decision points");
	});

	test("active time with summary fields shows utilization percentage", () => {
		const distilled = makeDistilled({
			decisions: [makeTimingGap({})],
			stats: {
				duration_ms: 100000,
				total_events: 50,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 25,
				failure_count: 0,
				failure_rate: 0,
				unique_files: [],
			},
			summary: {
				narrative: "Test session",
				phases: [],
				key_metrics: {
					duration_human: "1m40s",
					tool_calls: 25,
					failures: 0,
					files_modified: 3,
					backtrack_count: 0,
					active_duration_human: "1m",
					active_duration_ms: 60000,
				},
			},
		});
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("Utilization:");
		expect(output).toContain("60.0%");
		expect(output).toContain("Active time:");
		expect(output).toContain("1m");
	});

	test("timing gap shows classification and duration", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTimingGap({ gap_ms: 30000, classification: "user_idle" }),
			makeTimingGap({ gap_ms: 120000, classification: "session_pause", t: 2000000 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("user_idle");
		expect(output).toContain("30s");
		expect(output).toContain("session_pause");
		expect(output).toContain("2m");
	});

	test("tool pivot shows from -> to tools", () => {
		const decisions: readonly DecisionPoint[] = [
			makeToolPivot({ from_tool: "Read", to_tool: "Edit" }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("Read");
		expect(output).toContain("->");
		expect(output).toContain("Edit");
	});

	test("tool pivot after failure shows 'after failure' marker", () => {
		const decisions: readonly DecisionPoint[] = [
			makeToolPivot({ after_failure: true }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("after failure");
	});

	test("tool pivot without failure does not show 'after failure' on the pivot line", () => {
		const decisions: readonly DecisionPoint[] = [
			makeToolPivot({ after_failure: false }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		// The pivot line itself should not have "after failure"
		// but the summary line "0 after failure" is always present.
		// Split and check the pivot line specifically.
		const lines = output.split("\n");
		const pivotLine = lines.find((l) => l.includes("->"));
		expect(pivotLine).toBeDefined();
		expect(pivotLine).not.toContain("after failure");
		// Summary line still shows "0 after failure"
		expect(output).toContain("0 after failure");
	});

	test("phase boundary shows phase name and index", () => {
		const decisions: readonly DecisionPoint[] = [
			makePhaseBoundary({ phase_name: "Testing", phase_index: 2 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("Testing");
		expect(output).toContain("[2]");
	});

	test("empty decisions shows (none) for each section", () => {
		const distilled = makeDistilled({ decisions: [] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("0 decision points");
		// Each section should show (none)
		expect(output.match(/\(none\)/g)?.length).toBe(3);
	});

	test("timing gap summary shows classification counts", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTimingGap({ classification: "user_idle", t: 1000000 }),
			makeTimingGap({ classification: "user_idle", t: 2000000 }),
			makeTimingGap({ classification: "session_pause", t: 3000000 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("user_idle: 2");
		expect(output).toContain("session_pause: 1");
	});

	test("tool pivot summary shows total count and after-failure count", () => {
		const decisions: readonly DecisionPoint[] = [
			makeToolPivot({ after_failure: true, t: 1000000 }),
			makeToolPivot({ after_failure: false, t: 2000000 }),
			makeToolPivot({ after_failure: true, t: 3000000 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("3 pivots");
		expect(output).toContain("2 after failure");
	});

	test("wall clock is shown from summary or stats", () => {
		const distilled = makeDistilled({
			decisions: [makeTimingGap({})],
			stats: {
				duration_ms: 90000,
				total_events: 50,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 25,
				failure_count: 0,
				failure_rate: 0,
				unique_files: [],
			},
		});
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("Wall clock:");
		expect(output).toContain("1m");
	});
});

// =============================================================================
// renderDecisionsSummary -- agent decision sections
// =============================================================================

describe("renderDecisionsSummary with agent decisions", () => {
	const makeAgentSpawn = (
		overrides: Partial<Extract<DecisionPoint, { type: "agent_spawn" }>> = {},
	): Extract<DecisionPoint, { type: "agent_spawn" }> => ({
		type: "agent_spawn",
		t: 1000000,
		agent_id: "agent-001",
		agent_name: "builder-types",
		agent_type: "builder",
		parent_session: "parent-session",
		...overrides,
	});

	const makeTaskDelegation = (
		overrides: Partial<Extract<DecisionPoint, { type: "task_delegation" }>> = {},
	): Extract<DecisionPoint, { type: "task_delegation" }> => ({
		type: "task_delegation",
		t: 1001000,
		task_id: "task-001",
		agent_name: "builder-types",
		subject: "Implement types",
		...overrides,
	});

	const makeTaskCompletion = (
		overrides: Partial<Extract<DecisionPoint, { type: "task_completion" }>> = {},
	): Extract<DecisionPoint, { type: "task_completion" }> => ({
		type: "task_completion",
		t: 1005000,
		task_id: "task-001",
		agent_name: "builder-types",
		subject: "Implement types",
		...overrides,
	});

	test("agent sections appear when agent decisions are present", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTimingGap({}),
			makeAgentSpawn({}),
			makeTaskDelegation({}),
			makeTaskCompletion({}),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));

		expect(output).toContain("Agent Spawns");
		expect(output).toContain("Task Delegations");
		expect(output).toContain("Task Completions");
		expect(output).toContain("builder-types");
	});

	test("agent sections are hidden when no agent decisions present", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTimingGap({}),
			makeToolPivot({}),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));

		expect(output).not.toContain("Agent Spawns");
		expect(output).not.toContain("Task Delegations");
		expect(output).not.toContain("Task Completions");
	});

	test("agent spawn shows agent name, type, and truncated id", () => {
		const decisions: readonly DecisionPoint[] = [
			makeAgentSpawn({ agent_name: "my-builder", agent_type: "builder", agent_id: "abcdef12-3456-7890" }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));

		expect(output).toContain("my-builder");
		expect(output).toContain("(builder)");
		expect(output).toContain("abcdef12");
	});

	test("task delegation shows agent name and subject", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTaskDelegation({ agent_name: "builder-types", subject: "Fix the bug" }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));

		expect(output).toContain("builder-types");
		expect(output).toContain("Fix the bug");
	});

	test("task completion shows agent name and subject", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTaskCompletion({ agent_name: "validator-lint", subject: "Run linting" }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));

		expect(output).toContain("validator-lint");
		expect(output).toContain("Run linting");
	});

	test("header count includes agent decisions in total", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTimingGap({}),
			makeAgentSpawn({}),
			makeTaskDelegation({}),
			makeTaskCompletion({}),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("4 decision points");
	});

	test("agent spawns summary shows count", () => {
		const decisions: readonly DecisionPoint[] = [
			makeAgentSpawn({ agent_id: "a1", t: 100 }),
			makeAgentSpawn({ agent_id: "a2", t: 200 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("2 agents spawned");
	});

	test("task delegations summary shows delegation and agent counts", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTaskDelegation({ agent_name: "builder-a", t: 100 }),
			makeTaskDelegation({ agent_name: "builder-b", t: 200 }),
			makeTaskDelegation({ agent_name: "builder-a", t: 300 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("3 delegations");
		expect(output).toContain("2 agents");
	});

	test("task completions summary shows count", () => {
		const decisions: readonly DecisionPoint[] = [
			makeTaskCompletion({ t: 100 }),
			makeTaskCompletion({ t: 200 }),
			makeTaskCompletion({ t: 300 }),
		];
		const distilled = makeDistilled({ decisions: [...decisions] });
		const output = stripAnsi(renderDecisionsSummary(distilled));
		expect(output).toContain("3 tasks completed");
	});
});


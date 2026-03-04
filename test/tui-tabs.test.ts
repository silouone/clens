import { describe, expect, test } from "bun:test";
import {
	collapseConsecutive,
	formatBacktracksTab,
	formatCollapsedEntry,
	formatCollapsedSwimLaneEntry,
	formatCommsTab,
	formatDecisionDetail,
	formatDecisionsTabFull,
	formatDriftTab,
	formatGraphTab,
	formatOverviewTab,
	formatReasoningTab,
	formatSwimLaneEntry,
	formatTimelineEntry,
	formatTimelineTab,
	type CollapsedEntry,
} from "../src/commands/tui-tabs";
import { stripAnsi } from "../src/commands/tui-formatters";
import type {
	AgentNode,
	BacktrackResult,
	DecisionPoint,
	DistilledSession,
	SessionSummary,
	TimelineEntry,
} from "../src/types";

// --- Test factories ---

const makeSummary = (overrides?: Partial<SessionSummary>): SessionSummary => ({
	session_id: "aaaa1111-2222-3333-4444-555566667777",
	start_time: 1000,
	duration_ms: 60000,
	event_count: 50,
	git_branch: "main",
	status: "complete",
	file_size_bytes: 1024,
	...overrides,
});

const makeAgent = (overrides?: Partial<AgentNode>): AgentNode => ({
	session_id: "agent-001",
	agent_type: "builder",
	agent_name: "builder-types",
	duration_ms: 120000,
	tool_call_count: 40,
	children: [],
	...overrides,
});

const makeTimelineEntry = (overrides?: Partial<TimelineEntry>): TimelineEntry => ({
	t: Date.now(),
	type: "tool_call",
	...overrides,
});

const makeDistilled = (overrides?: Partial<DistilledSession>): DistilledSession => ({
	session_id: "aaaa1111",
	stats: {
		total_events: 100,
		duration_ms: 60000,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 50,
		failure_count: 0,
		failure_rate: 0,
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

const makeBacktrack = (overrides?: Partial<BacktrackResult>): BacktrackResult => ({
	type: "failure_retry",
	tool_name: "Edit",
	attempts: 3,
	start_t: 1000,
	end_t: 5000,
	tool_use_ids: ["tu-1", "tu-2", "tu-3"],
	...overrides,
});

// --- collapseConsecutive ---

describe("collapseConsecutive", () => {
	test("returns empty for empty input", () => {
		expect(collapseConsecutive([])).toEqual([]);
	});

	test("returns single entry with count 1", () => {
		const entries = [makeTimelineEntry({ t: 1000, type: "failure" })];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(1);
		expect(result[0].count).toBe(1);
		expect(result[0].entry.type).toBe("failure");
	});

	test("does not collapse entries with different types", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "failure" }),
			makeTimelineEntry({ t: 2000, type: "thinking" }),
			makeTimelineEntry({ t: 3000, type: "tool_call", tool_name: "Read" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(3);
		expect(result[0].count).toBe(1);
		expect(result[1].count).toBe(1);
		expect(result[2].count).toBe(1);
	});

	test("collapses consecutive tool_calls with same tool_name", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 3000, type: "tool_call", tool_name: "Read" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(1);
		expect(result[0].count).toBe(3);
		expect(result[0].entry.tool_name).toBe("Read");
	});

	test("does not collapse tool_calls with different tool_name", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Edit" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(2);
		expect(result[0].count).toBe(1);
		expect(result[1].count).toBe(1);
	});

	test("does not collapse non-tool_call types even if identical", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "failure" }),
			makeTimelineEntry({ t: 2000, type: "failure" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(2);
	});

	test("does not collapse same tool_name with different agent_name", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "builder-a" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Read", agent_name: "builder-b" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(2);
	});

	test("collapses mixed sequence correctly", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 3000, type: "failure" }),
			makeTimelineEntry({ t: 4000, type: "tool_call", tool_name: "Read" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(3);
		expect(result[0].count).toBe(2);
		expect(result[1].count).toBe(1);
		expect(result[1].entry.type).toBe("failure");
		expect(result[2].count).toBe(1);
	});
});

// --- formatOverviewTab ---

describe("formatOverviewTab", () => {
	test("shows basic info when no distilled data", () => {
		const session = makeSummary();
		const lines = formatOverviewTab(session, undefined);
		expect(lines.some((l) => l.includes("aaaa1111"))).toBe(true);
		expect(lines.some((l) => l.includes("No distilled data"))).toBe(true);
		expect(lines.some((l) => l.includes("Duration:"))).toBe(true);
		expect(lines.some((l) => l.includes("Events:"))).toBe(true);
		expect(lines.some((l) => l.includes("Branch:"))).toBe(true);
	});

	test("shows structured metrics grid when distilled", () => {
		const session = makeSummary();
		const distilled = makeDistilled({
			stats: {
				total_events: 100,
				duration_ms: 60000,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 50,
				failure_count: 2,
				failure_rate: 0.04,
				unique_files: [],
				model: "claude-opus-4",
			},
			summary: {
				narrative: "Test narrative",
				phases: [],
				key_metrics: {
					duration_human: "1m",
					tool_calls: 50,
					failures: 2,
					files_modified: 5,
					backtrack_count: 1,
				},
			},
		});
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Duration:") && l.includes("Model:"))).toBe(true);
		expect(lines.some((l) => l.includes("Tool calls:") && l.includes("Failures:"))).toBe(true);
		expect(lines.some((l) => l.includes("Files:") && l.includes("Backtracks:"))).toBe(true);
		expect(lines.some((l) => l.includes("Agents:") && l.includes("Tasks:"))).toBe(true);
		expect(lines.some((l) => l.includes("claude-opus-4"))).toBe(true);
	});

	test("shows quality section with backtracks", () => {
		const session = makeSummary();
		const distilled = makeDistilled({
			backtracks: [makeBacktrack()],
			summary: {
				narrative: "Test",
				phases: [],
				key_metrics: {
					duration_human: "1m",
					tool_calls: 50,
					failures: 3,
					files_modified: 5,
					backtrack_count: 1,
				},
			},
		});
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Quality:"))).toBe(true);
		expect(lines.some((l) => l.includes("1 backtrack"))).toBe(true);
		expect(lines.some((l) => l.includes("Failure rate:"))).toBe(true);
	});

	test("shows team section with team metrics", () => {
		const session = makeSummary();
		const distilled = makeDistilled({
			team_metrics: {
				agent_count: 3,
				task_completed_count: 5,
				idle_event_count: 2,
				teammate_names: ["builder-a", "builder-b", "validator"],
				tasks: [],
				idle_transitions: [],
				utilization_ratio: 0.85,
			},
			summary: {
				narrative: "Test",
				phases: [],
				key_metrics: {
					duration_human: "30m",
					tool_calls: 200,
					failures: 0,
					files_modified: 20,
					backtrack_count: 0,
				},
				agent_workload: [
					{ name: "builder-a", id: "abc12345", tool_calls: 100, files_modified: 10, duration_ms: 300000 },
				],
			},
		});
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Team:"))).toBe(true);
		expect(lines.some((l) => l.includes("3 agents"))).toBe(true);
		expect(lines.some((l) => l.includes("5 tasks"))).toBe(true);
		expect(lines.some((l) => l.includes("85%"))).toBe(true);
	});

	test("shows decisions section when decisions present", () => {
		const session = makeSummary();
		const distilled = makeDistilled({
			decisions: [
				{ type: "timing_gap" as const, t: 1000, gap_ms: 5000, classification: "user_idle" as const },
			],
			summary: {
				narrative: "Test",
				phases: [],
				key_metrics: {
					duration_human: "1m",
					tool_calls: 50,
					failures: 0,
					files_modified: 5,
					backtrack_count: 0,
				},
			},
		});
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Decision Points:"))).toBe(true);
	});

	test("shows plan drift section when present", () => {
		const session = makeSummary();
		const distilled = makeDistilled({
			plan_drift: {
				spec_path: "specs/my-plan.md",
				expected_files: ["src/a.ts", "src/b.ts", "src/c.ts"],
				actual_files: ["src/a.ts", "src/b.ts", "src/d.ts"],
				unexpected_files: ["src/d.ts"],
				missing_files: ["src/c.ts"],
				drift_score: 0.67,
			},
			summary: {
				narrative: "Test",
				phases: [],
				key_metrics: {
					duration_human: "1m",
					tool_calls: 50,
					failures: 0,
					files_modified: 5,
					backtrack_count: 0,
				},
			},
		});
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Plan Drift:"))).toBe(true);
		expect(lines.some((l) => l.includes("0.67"))).toBe(true);
		expect(lines.some((l) => l.includes("specs/my-plan.md"))).toBe(true);
	});

	test("shows lifecycle section when journey present", () => {
		const session = makeSummary();
		const distilled = makeDistilled({
			summary: {
				narrative: "Test",
				phases: [],
				key_metrics: {
					duration_human: "1m",
					tool_calls: 50,
					failures: 0,
					files_modified: 5,
					backtrack_count: 0,
				},
			},
		});
		const journey = {
			id: "j1",
			phases: [
				{
					session_id: "aaaa1111",
					phase_type: "build" as const,
					source: "startup" as const,
					duration_ms: 60000,
					event_count: 50,
				},
			],
			transitions: [],
			lifecycle_type: "single-session" as const,
			cumulative_stats: {
				total_duration_ms: 60000,
				total_events: 50,
				total_tool_calls: 50,
				total_failures: 0,
				phase_count: 1,
				retry_count: 0,
			},
			spec_ref: "specs/my-plan.md",
		};
		const lines = formatOverviewTab(session, distilled, journey);
		expect(lines.some((l) => l.includes("Lifecycle:"))).toBe(true);
		expect(lines.some((l) => l.includes("single-session"))).toBe(true);
		expect(lines.some((l) => l.includes("specs/my-plan.md"))).toBe(true);
	});

	test("shows phases with duration and tools", () => {
		const session = makeSummary();
		const distilled = makeDistilled({
			summary: {
				narrative: "Test",
				phases: [
					{
						name: "Planning",
						start_t: 0,
						end_t: 120,
						tool_types: ["TaskCreate", "Read", "Grep"],
						description: "Planning phase",
					},
					{
						name: "Implementation",
						start_t: 120,
						end_t: 1800,
						tool_types: ["Edit", "Write", "Read", "Bash"],
						description: "Impl phase",
					},
				],
				key_metrics: {
					duration_human: "30m",
					tool_calls: 50,
					failures: 0,
					files_modified: 5,
					backtrack_count: 0,
				},
			},
		});
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Phases:"))).toBe(true);
		expect(lines.some((l) => l.includes("Planning") && l.includes("TaskCreate"))).toBe(true);
		expect(lines.some((l) => l.includes("Implementation") && l.includes("Edit"))).toBe(true);
	});
});

// --- formatBacktracksTab ---

describe("formatBacktracksTab", () => {
	test("shows clean session message when no backtracks", () => {
		const distilled = makeDistilled();
		const lines = formatBacktracksTab(distilled);
		expect(lines.some((l) => l.includes("Backtracks:"))).toBe(true);
		expect(lines.some((l) => l.includes("None detected"))).toBe(true);
	});

	test("shows backtrack count and details", () => {
		const distilled = makeDistilled({
			backtracks: [
				makeBacktrack({ type: "failure_retry", file_path: "src/a.ts", attempts: 3, start_t: 1000, end_t: 5000 }),
				makeBacktrack({ type: "debugging_loop", file_path: "src/b.ts", attempts: 5, start_t: 6000, end_t: 12000, error_message: "Type error" }),
			],
		});
		const lines = formatBacktracksTab(distilled);
		expect(lines.some((l) => l.includes("Backtracks: 2"))).toBe(true);
		expect(lines.some((l) => l.includes("src/a.ts"))).toBe(true);
		expect(lines.some((l) => l.includes("failure retry"))).toBe(true);
		expect(lines.some((l) => l.includes("3 attempts"))).toBe(true);
		expect(lines.some((l) => l.includes("src/b.ts"))).toBe(true);
		expect(lines.some((l) => l.includes("debugging loop"))).toBe(true);
		expect(lines.some((l) => l.includes("Type error"))).toBe(true);
	});

	test("shows time percentage of session", () => {
		const distilled = makeDistilled({
			stats: {
				total_events: 100,
				duration_ms: 10000,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 50,
				failure_count: 3,
				failure_rate: 0.06,
				unique_files: [],
			},
			backtracks: [
				makeBacktrack({ start_t: 0, end_t: 5000 }),
			],
		});
		const lines = formatBacktracksTab(distilled);
		expect(lines.some((l) => l.includes("50.0%"))).toBe(true);
	});
});

// --- formatReasoningTab ---

describe("formatReasoningTab", () => {
	test("shows empty message when no reasoning", () => {
		const distilled = makeDistilled();
		const lines = formatReasoningTab(distilled);
		expect(lines.some((l) => l.includes("Reasoning:"))).toBe(true);
		expect(lines.some((l) => l.includes("No reasoning data"))).toBe(true);
	});

	test("shows reasoning blocks grouped by intent", () => {
		const distilled = makeDistilled({
			reasoning: [
				{ t: 1000, thinking: "Planning the architecture", intent_hint: "planning" },
				{ t: 2000, thinking: "Debugging the type error", intent_hint: "debugging" },
				{ t: 3000, thinking: "More planning for the module", intent_hint: "planning" },
			],
		});
		const lines = formatReasoningTab(distilled);
		expect(lines.some((l) => l.includes("Reasoning: 3 blocks"))).toBe(true);
		expect(lines.some((l) => l.includes("By intent:"))).toBe(true);
		expect(lines.some((l) => l.includes("planning") && l.includes("2"))).toBe(true);
		expect(lines.some((l) => l.includes("debugging") && l.includes("1"))).toBe(true);
		expect(lines.some((l) => l.includes("All entries:"))).toBe(true);
		expect(lines.some((l) => l.includes("[planning]") && l.includes("Planning the architecture"))).toBe(true);
	});

	test("uses 'general' for entries without intent_hint", () => {
		const distilled = makeDistilled({
			reasoning: [{ t: 1000, thinking: "Some general thinking" }],
		});
		const lines = formatReasoningTab(distilled);
		expect(lines.some((l) => l.includes("general"))).toBe(true);
	});
});

// --- formatDriftTab ---

describe("formatDriftTab", () => {
	test("shows empty message when no drift data", () => {
		const distilled = makeDistilled();
		const lines = formatDriftTab(distilled);
		expect(lines.some((l) => l.includes("Plan Drift:"))).toBe(true);
		expect(lines.some((l) => l.includes("No drift data"))).toBe(true);
	});

	test("shows drift details when present", () => {
		const distilled = makeDistilled({
			plan_drift: {
				spec_path: "specs/my-plan.md",
				expected_files: ["src/a.ts", "src/b.ts"],
				actual_files: ["src/a.ts", "src/c.ts"],
				unexpected_files: ["src/c.ts"],
				missing_files: ["src/b.ts"],
				drift_score: 0.45,
			},
		});
		const lines = formatDriftTab(distilled);
		expect(lines.some((l) => l.includes("specs/my-plan.md"))).toBe(true);
		expect(lines.some((l) => l.includes("0.45"))).toBe(true);
		expect(lines.some((l) => l.includes("Expected:") && l.includes("2 files"))).toBe(true);
		expect(lines.some((l) => l.includes("Actual:") && l.includes("2 files"))).toBe(true);
		expect(lines.some((l) => l.includes("Unexpected files:"))).toBe(true);
		expect(lines.some((l) => l.includes("src/c.ts"))).toBe(true);
		expect(lines.some((l) => l.includes("Missing files:"))).toBe(true);
		expect(lines.some((l) => l.includes("src/b.ts"))).toBe(true);
	});

	test("uses green color for low drift score", () => {
		const distilled = makeDistilled({
			plan_drift: {
				spec_path: "specs/plan.md",
				expected_files: ["a.ts"],
				actual_files: ["a.ts"],
				unexpected_files: [],
				missing_files: [],
				drift_score: 0.1,
			},
		});
		const lines = formatDriftTab(distilled);
		expect(lines.some((l) => l.includes("\x1b[32m"))).toBe(true);
	});

	test("uses red color for high drift score", () => {
		const distilled = makeDistilled({
			plan_drift: {
				spec_path: "specs/plan.md",
				expected_files: ["a.ts"],
				actual_files: ["b.ts"],
				unexpected_files: ["b.ts"],
				missing_files: ["a.ts"],
				drift_score: 0.85,
			},
		});
		const lines = formatDriftTab(distilled);
		expect(lines.some((l) => l.includes("\x1b[31m"))).toBe(true);
	});
});

// --- formatGraphTab ---

describe("formatGraphTab", () => {
	test("shows empty message when no graph data", () => {
		const distilled = makeDistilled();
		const lines = formatGraphTab(distilled);
		expect(lines.some((l) => l.includes("Communication Graph:"))).toBe(true);
		expect(lines.some((l) => l.includes("No graph data available"))).toBe(true);
	});

	test("shows empty message when graph is empty array", () => {
		const distilled = makeDistilled({ communication_graph: [] });
		const lines = formatGraphTab(distilled);
		expect(lines.some((l) => l.includes("No graph data available"))).toBe(true);
	});

	test("shows graph edges when present", () => {
		const distilled = makeDistilled({
			communication_graph: [
				{
					from_id: "a1",
					from_name: "lead",
					to_id: "b1",
					to_name: "builder",
					from: "lead",
					to: "builder",
					count: 5,
					msg_types: ["message"],
				},
			],
		});
		const lines = formatGraphTab(distilled);
		expect(lines.some((l) => l.includes("Communication Summary"))).toBe(true);
		expect(lines.some((l) => l.includes("lead"))).toBe(true);
		expect(lines.some((l) => l.includes("builder"))).toBe(true);
	});

	test("shows agent lifetimes alongside graph", () => {
		const distilled = makeDistilled({
			communication_graph: [
				{
					from_id: "a1",
					from_name: "lead",
					to_id: "b1",
					to_name: "builder",
					from: "lead",
					to: "builder",
					count: 3,
					msg_types: ["message"],
				},
			],
			agent_lifetimes: [
				{
					agent_id: "a1",
					agent_name: "lead",
					start_t: 0,
					end_t: 10000,
					agent_type: "leader",
				},
				{
					agent_id: "b1",
					agent_name: "builder",
					start_t: 1000,
					end_t: 8000,
					agent_type: "builder",
				},
			],
		});
		const lines = formatGraphTab(distilled);
		expect(lines.some((l) => l.includes("Agent Lifetimes:"))).toBe(true);
	});
});

// --- formatDecisionDetail ---

describe("formatDecisionDetail", () => {
	test("formats timing_gap", () => {
		const d: DecisionPoint = { type: "timing_gap", t: 1000, gap_ms: 5000, classification: "user_idle" };
		const result = formatDecisionDetail(d);
		expect(result).toContain("gap");
		expect(result).toContain("user_idle");
	});

	test("formats tool_pivot", () => {
		const d: DecisionPoint = { type: "tool_pivot", t: 1000, from_tool: "Read", to_tool: "Edit", after_failure: true };
		const result = formatDecisionDetail(d);
		expect(result).toContain("Read -> Edit");
		expect(result).toContain("after failure");
	});

	test("formats tool_pivot without failure", () => {
		const d: DecisionPoint = { type: "tool_pivot", t: 1000, from_tool: "Bash", to_tool: "Read", after_failure: false };
		const result = formatDecisionDetail(d);
		expect(result).toContain("Bash -> Read");
		expect(result).not.toContain("after failure");
	});

	test("formats phase_boundary", () => {
		const d: DecisionPoint = { type: "phase_boundary", t: 1000, phase_name: "Implementation", phase_index: 1 };
		const result = formatDecisionDetail(d);
		expect(result).toContain("phase 2");
		expect(result).toContain("Implementation");
	});

	test("formats agent_spawn", () => {
		const d: DecisionPoint = { type: "agent_spawn", t: 1000, agent_id: "a1", agent_name: "builder-a", agent_type: "builder", parent_session: "root" };
		const result = formatDecisionDetail(d);
		expect(result).toContain("spawned builder-a");
		expect(result).toContain("builder");
	});

	test("formats task_delegation", () => {
		const d: DecisionPoint = { type: "task_delegation", t: 1000, task_id: "t1", agent_name: "builder-a", subject: "Build types" };
		const result = formatDecisionDetail(d);
		expect(result).toContain("delegated to builder-a");
		expect(result).toContain("Build types");
	});

	test("formats task_delegation without subject", () => {
		const d: DecisionPoint = { type: "task_delegation", t: 1000, task_id: "t1", agent_name: "builder-a" };
		const result = formatDecisionDetail(d);
		expect(result).toContain("delegated to builder-a");
		expect(result).not.toContain(":");
	});

	test("formats task_completion", () => {
		const d: DecisionPoint = { type: "task_completion", t: 1000, task_id: "t1", agent_name: "builder-a", subject: "Done" };
		const result = formatDecisionDetail(d);
		expect(result).toContain("completed by builder-a");
		expect(result).toContain("Done");
	});
});

// --- formatDecisionsTabFull ---

describe("formatDecisionsTabFull", () => {
	test("shows empty message when no decisions", () => {
		const lines = formatDecisionsTabFull([]);
		expect(lines.some((l) => l.includes("Decisions:"))).toBe(true);
		expect(lines.some((l) => l.includes("No decision points detected"))).toBe(true);
	});

	test("shows summary counts and all decisions", () => {
		const decisions: readonly DecisionPoint[] = [
			{ type: "timing_gap", t: 1000, gap_ms: 5000, classification: "user_idle" },
			{ type: "timing_gap", t: 2000, gap_ms: 3000, classification: "session_pause" },
			{ type: "tool_pivot", t: 3000, from_tool: "Read", to_tool: "Edit", after_failure: false },
		];
		const lines = formatDecisionsTabFull(decisions);
		expect(lines.some((l) => l.includes("Decision Points:"))).toBe(true);
		expect(lines.some((l) => l.includes("2 timing gaps"))).toBe(true);
		expect(lines.some((l) => l.includes("1 tool pivot"))).toBe(true);
	});

	test("sorts decisions by time descending", () => {
		const decisions: readonly DecisionPoint[] = [
			{ type: "timing_gap", t: 1000, gap_ms: 5000, classification: "user_idle" },
			{ type: "tool_pivot", t: 5000, from_tool: "Read", to_tool: "Edit", after_failure: false },
			{ type: "phase_boundary", t: 3000, phase_name: "Impl", phase_index: 1 },
		];
		const lines = formatDecisionsTabFull(decisions);
		const stripped = lines.map(stripAnsi);
		// Skip the header lines (Decision Points, scroll hint, blank) — content starts at index 3
		const contentLines = stripped.slice(3);
		// First decision entry should be t=5000 (tool_pivot: Read -> Edit)
		expect(contentLines[0]).toContain("Read -> Edit");
		// Second should be t=3000 (phase_boundary: Impl)
		expect(contentLines[1]).toContain("Impl");
		// Third should be t=1000 (timing_gap)
		expect(contentLines[2]).toContain("gap");
	});

	test("shows various decision types correctly", () => {
		const decisions: readonly DecisionPoint[] = [
			{ type: "timing_gap", t: 1000, gap_ms: 60000, classification: "session_pause" },
			{ type: "tool_pivot", t: 2000, from_tool: "Bash", to_tool: "Edit", after_failure: true },
			{ type: "phase_boundary", t: 3000, phase_name: "Review", phase_index: 2 },
			{ type: "task_delegation", t: 4000, task_id: "t1", agent_name: "validator", subject: "Run tests" },
		];
		const lines = formatDecisionsTabFull(decisions);
		const joined = lines.join("\n");
		expect(joined).toContain("session_pause");
		expect(joined).toContain("after failure");
		expect(joined).toContain("Review");
		expect(joined).toContain("delegated to validator");
	});
});

// --- formatTimelineTab ---

describe("formatTimelineTab", () => {
	test("shows all entries when no filter", () => {
		const timeline = [
			makeTimelineEntry({ t: 1000, type: "failure" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 3000, type: "thinking" }),
		];
		const lines = formatTimelineTab(timeline, 0);
		expect(lines.some((l) => l.includes("3 of 3"))).toBe(true);
	});

	test("filters entries by type", () => {
		const timeline = [
			makeTimelineEntry({ t: 1000, type: "failure" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 3000, type: "failure" }),
		];
		const lines = formatTimelineTab(timeline, 0, "failure");
		expect(lines.some((l) => l.includes("2 of 2"))).toBe(true);
		expect(lines.some((l) => l.includes("filter: failure"))).toBe(true);
	});

	test("respects scroll offset", () => {
		const timeline = Array.from({ length: 50 }, (_, i) =>
			makeTimelineEntry({ t: 1000 + i * 1000, tool_name: `Tool${i}` }),
		);
		const lines = formatTimelineTab(timeline, 10);
		expect(lines.some((l) => l.includes("11-40 of 50"))).toBe(true);
	});

	test("uses swim lanes for multi-agent timelines", () => {
		const timeline = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "builder-a" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Edit", agent_name: "builder-b" }),
		];
		const lines = formatTimelineTab(timeline, 0);
		// Multi-agent should produce swim lane format with cyan agent labels
		expect(lines.some((l) => l.includes("\x1b[36m"))).toBe(true); // cyan
	});

	test("does not use swim lanes for single-agent timelines", () => {
		const timeline = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "builder-a" }),
			makeTimelineEntry({ t: 2000, type: "failure", agent_name: "builder-a" }),
		];
		const lines = formatTimelineTab(timeline, 0);
		// Single agent: no swim lane cyan labels
		const contentLines = lines.slice(3); // skip header
		const hasCyanAgentLabel = contentLines.some((l) => {
			const stripped = stripAnsi(l);
			return stripped.includes("builder-a") && !stripped.includes("agent_spawn");
		});
		expect(hasCyanAgentLabel).toBe(false);
	});
});

// --- formatTimelineEntry ---

describe("formatTimelineEntry", () => {
	test("formats entry with time and type", () => {
		const entry = makeTimelineEntry({ t: 1700000000000, type: "failure" });
		const result = formatTimelineEntry(entry);
		expect(result).toContain("failure");
	});

	test("includes content_preview when present", () => {
		const entry = makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", content_preview: "Reading file.ts" });
		const result = formatTimelineEntry(entry);
		expect(result).toContain("Reading file.ts");
	});

	test("truncates long content_preview", () => {
		const longPreview = "A".repeat(80);
		const entry = makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", content_preview: longPreview });
		const result = formatTimelineEntry(entry);
		expect(stripAnsi(result)).not.toContain("A".repeat(80));
	});
});

// --- formatCollapsedEntry ---

describe("formatCollapsedEntry", () => {
	test("shows no suffix for count 1", () => {
		const collapsed: CollapsedEntry = {
			entry: makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read" }),
			count: 1,
		};
		const result = formatCollapsedEntry(collapsed);
		expect(result).not.toContain("(x");
	});

	test("shows count suffix for collapsed entries", () => {
		const collapsed: CollapsedEntry = {
			entry: makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read" }),
			count: 5,
		};
		const result = formatCollapsedEntry(collapsed);
		expect(result).toContain("(x5)");
	});
});

// --- formatSwimLaneEntry ---

describe("formatSwimLaneEntry", () => {
	test("formats entry with agent label", () => {
		const entry = makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "builder-a" });
		const result = formatSwimLaneEntry(entry, 16);
		expect(result).toContain("builder-a");
		expect(result).toContain("\x1b[36m"); // cyan agent label
	});

	test("pads agent label to lane width", () => {
		const entry = makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "abc" });
		const result = formatSwimLaneEntry(entry, 10);
		const stripped = stripAnsi(result);
		// Agent label "abc" should be padded to 10 chars
		expect(stripped).toContain("abc");
	});

	test("falls back to agent_id when no agent_name", () => {
		const entry = makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_id: "abcd1234-long-id" });
		const result = formatSwimLaneEntry(entry, 10);
		expect(result).toContain("abcd1234");
	});
});

// --- formatCollapsedSwimLaneEntry ---

describe("formatCollapsedSwimLaneEntry", () => {
	test("shows count suffix for collapsed swim lane entries", () => {
		const collapsed: CollapsedEntry = {
			entry: makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "builder-a" }),
			count: 3,
		};
		const result = formatCollapsedSwimLaneEntry(collapsed, 16);
		expect(result).toContain("(x3)");
		expect(result).toContain("builder-a");
	});

	test("shows no suffix for count 1", () => {
		const collapsed: CollapsedEntry = {
			entry: makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "builder-a" }),
			count: 1,
		};
		const result = formatCollapsedSwimLaneEntry(collapsed, 16);
		expect(result).not.toContain("(x");
	});
});

// --- formatCommsTab ---

describe("formatCommsTab", () => {
	test("shows empty message when no comms data", () => {
		const distilled = makeDistilled();
		const lines = formatCommsTab(distilled, 0);
		expect(lines.some((l) => l.includes("No communication data available"))).toBe(true);
	});

	test("shows lifetime bars when present", () => {
		const distilled = makeDistilled({
			agent_lifetimes: [
				{ agent_id: "a1", agent_name: "lead", start_t: 0, end_t: 10000, agent_type: "leader" },
				{ agent_id: "b1", agent_name: "builder", start_t: 1000, end_t: 8000, agent_type: "builder" },
			],
		});
		const lines = formatCommsTab(distilled, 0);
		expect(lines.some((l) => l.includes("Agent Lifetimes:"))).toBe(true);
	});

	test("shows message sequence when present", () => {
		const distilled = makeDistilled({
			comm_sequence: [
				{
					t: 1000,
					from_id: "a1",
					from_name: "lead",
					to_id: "b1",
					to_name: "builder",
					from: "lead",
					to: "builder",
					msg_type: "message",
					summary: "Start task",
				},
				{
					t: 2000,
					from_id: "b1",
					from_name: "builder",
					to_id: "a1",
					to_name: "lead",
					from: "builder",
					to: "lead",
					msg_type: "message",
					summary: "Done",
				},
			],
		});
		const lines = formatCommsTab(distilled, 0);
		expect(lines.some((l) => l.includes("Messages:"))).toBe(true);
		expect(lines.some((l) => l.includes("1-2 of 2"))).toBe(true);
	});

	test("shows graph summary when present", () => {
		const distilled = makeDistilled({
			communication_graph: [
				{
					from_id: "a1",
					from_name: "lead",
					to_id: "b1",
					to_name: "builder",
					from: "lead",
					to: "builder",
					count: 5,
					msg_types: ["message"],
				},
			],
		});
		const lines = formatCommsTab(distilled, 0);
		expect(lines.some((l) => l.includes("Communication Summary"))).toBe(true);
	});

	test("respects commsOffset for scrolling", () => {
		const sequence = Array.from({ length: 40 }, (_, i) => ({
			t: 1000 + i * 100,
			from_id: "a1",
			from_name: "lead",
			to_id: "b1",
			to_name: "builder",
			from: "lead",
			to: "builder",
			msg_type: "message" as const,
		}));
		const distilled = makeDistilled({ comm_sequence: sequence });
		const lines = formatCommsTab(distilled, 5);
		expect(lines.some((l) => l.includes("6-35 of 40"))).toBe(true);
	});
});

import { describe, expect, test } from "bun:test";
import { extractSummary } from "../src/distill/summary";
import type {
	AgentNode,
	BacktrackResult,
	FileMapEntry,
	PhaseInfo,
	StatsResult,
	StoredEvent,
	TeamMetrics,
	TranscriptReasoning,
} from "../src/types";

// --- Factories ---

const makeStats = (overrides: Partial<StatsResult> = {}): StatsResult => ({
	total_events: 100,
	duration_ms: 2_730_000, // 45m 30s
	events_by_type: { PreToolUse: 50, PostToolUse: 40, PostToolUseFailure: 5 },
	tools_by_name: { Read: 20, Edit: 15, Bash: 10, Grep: 5 },
	tool_call_count: 50,
	failure_count: 5,
	failure_rate: 0.1,
	unique_files: ["src/index.ts", "src/utils.ts"],
	model: "claude-sonnet-4-20250514",
	...overrides,
});

const makeBacktrack = (overrides: Partial<BacktrackResult> = {}): BacktrackResult => ({
	type: "failure_retry",
	tool_name: "Bash",
	attempts: 2,
	start_t: 1000,
	end_t: 2000,
	tool_use_ids: ["t1", "t2"],
	...overrides,
});

const makePhase = (name: string, start_t: number, end_t: number): PhaseInfo => ({
	name,
	start_t,
	end_t,
	tool_types: ["Read", "Edit"],
	description: `${name} phase`,
});

const makeFileMapEntry = (overrides: Partial<FileMapEntry> = {}): FileMapEntry => ({
	file_path: "src/index.ts",
	reads: 3,
	edits: 2,
	writes: 0,
	errors: 0,
	tool_use_ids: ["t1"],
	...overrides,
});

const makeReasoning = (overrides: Partial<TranscriptReasoning> = {}): TranscriptReasoning => ({
	t: 1000,
	thinking: "Let me analyze this code",
	intent_hint: "planning",
	...overrides,
});

const makeTeamMetrics = (overrides: Partial<TeamMetrics> = {}): TeamMetrics => ({
	agent_count: 3,
	task_completed_count: 5,
	idle_event_count: 8,
	teammate_names: ["builder-a", "builder-b", "researcher"],
	tasks: [
		{ task_id: "1", agent: "builder-a", subject: "Implement feature", t: 1000 },
		{ task_id: "2", agent: "builder-b", subject: "Write tests", t: 2000 },
	],
	idle_transitions: [
		{ teammate: "builder-a", t: 1500 },
		{ teammate: "builder-b", t: 2500 },
	],
	...overrides,
});

// --- Tests ---

describe("extractSummary", () => {
	test("generates narrative with all sentences for typical session", () => {
		const stats = makeStats();
		const backtracks = [makeBacktrack()];
		const phases = [
			makePhase("File Exploration", 0, 1000),
			makePhase("Code Modification", 1001, 2000),
		];
		const file_map = [makeFileMapEntry()];
		const reasoning = [makeReasoning()];

		const result = extractSummary({ stats, backtracks, phases, file_map, reasoning });

		// Sentence 1: duration + tool calls + model
		expect(result.narrative).toContain("45m 30s");
		expect(result.narrative).toContain("claude-sonnet-4-20250514");
		expect(result.narrative).toContain("50 tool calls");

		// Sentence 2: phases
		expect(result.narrative).toContain("2 phases");
		expect(result.narrative).toContain("File Exploration");
		expect(result.narrative).toContain("Code Modification");

		// Sentence 3: top tools + files modified
		expect(result.narrative).toContain("Read");
		expect(result.narrative).toContain("1 file modified");

		// Sentence 4: backtracks
		expect(result.narrative).toContain("1 backtrack");
		expect(result.narrative).toContain("failure retry");
		expect(result.narrative).toContain("10.0%");

		// Sentence 5: reasoning
		expect(result.narrative).toContain("1 thinking block");
		expect(result.narrative).toContain("planning");
	});

	test("returns correct key_metrics", () => {
		const stats = makeStats();
		const file_map = [
			makeFileMapEntry(),
			makeFileMapEntry({ file_path: "src/other.ts", edits: 0, writes: 1 }),
		];
		const backtracks = [makeBacktrack(), makeBacktrack({ type: "debugging_loop" })];

		const result = extractSummary({ stats, backtracks, phases: [], file_map, reasoning: [] });

		expect(result.key_metrics).toEqual({
			duration_human: "45m 30s",
			tool_calls: 50,
			failures: 5,
			files_modified: 2,
			backtrack_count: 2,
		});
	});

	test("returns phases array", () => {
		const phases = [makePhase("Research", 0, 500), makePhase("Code Modification", 501, 1000)];

		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases,
			file_map: [],
			reasoning: [],
		});

		expect(result.phases).toHaveLength(2);
		expect(result.phases[0].name).toBe("Research");
		expect(result.phases[1].name).toBe("Code Modification");
	});

	test("handles empty session (zero everything)", () => {
		const emptyStats = makeStats({
			total_events: 0,
			duration_ms: 0,
			events_by_type: {},
			tools_by_name: {},
			tool_call_count: 0,
			failure_count: 0,
			failure_rate: 0,
			unique_files: [],
			model: undefined,
		});

		const result = extractSummary({
			stats: emptyStats,
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
		});

		expect(result.narrative).toContain("0ms");
		expect(result.narrative).toContain("unknown model");
		expect(result.narrative).toContain("0 tool calls");
		expect(result.narrative).toContain("0 files modified");
		// Should NOT contain backtrack or reasoning sentences
		expect(result.narrative).not.toContain("backtrack");
		expect(result.narrative).not.toContain("thinking block");
		expect(result.key_metrics.tool_calls).toBe(0);
		expect(result.key_metrics.failures).toBe(0);
		expect(result.key_metrics.files_modified).toBe(0);
		expect(result.key_metrics.backtrack_count).toBe(0);
	});

	test("omits backtrack sentence when zero backtracks", () => {
		const result = extractSummary({
			stats: makeStats({ failure_count: 0, failure_rate: 0 }),
			backtracks: [],
			phases: [makePhase("General", 0, 1000)],
			file_map: [makeFileMapEntry()],
			reasoning: [makeReasoning()],
		});

		expect(result.narrative).not.toContain("backtrack");
		expect(result.narrative).not.toContain("Failure rate");
		// Reasoning should still be present
		expect(result.narrative).toContain("thinking block");
	});

	test("omits reasoning sentence when zero reasoning blocks", () => {
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [makeBacktrack()],
			phases: [makePhase("General", 0, 1000)],
			file_map: [makeFileMapEntry()],
			reasoning: [],
		});

		expect(result.narrative).not.toContain("thinking block");
		// Backtracks should still be present
		expect(result.narrative).toContain("backtrack");
	});

	test("formats hours correctly", () => {
		const stats = makeStats({ duration_ms: 7_261_000 }); // 2h 1m 1s
		const result = extractSummary({
			stats,
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
		});
		expect(result.key_metrics.duration_human).toBe("2h 1m 1s");
		expect(result.narrative).toContain("2h 1m 1s");
	});

	test("formats seconds-only correctly", () => {
		const stats = makeStats({ duration_ms: 15_000 }); // 15s
		const result = extractSummary({
			stats,
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
		});
		expect(result.key_metrics.duration_human).toBe("15s");
	});

	test("counts only files with edits or writes as modified", () => {
		const file_map = [
			makeFileMapEntry({ file_path: "a.ts", reads: 5, edits: 0, writes: 0 }),
			makeFileMapEntry({ file_path: "b.ts", reads: 1, edits: 2, writes: 0 }),
			makeFileMapEntry({ file_path: "c.ts", reads: 0, edits: 0, writes: 1 }),
		];

		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map,
			reasoning: [],
		});
		expect(result.key_metrics.files_modified).toBe(2);
		expect(result.narrative).toContain("2 files modified");
	});

	test("summarizes multiple backtrack types", () => {
		const backtracks = [
			makeBacktrack({ type: "failure_retry" }),
			makeBacktrack({ type: "failure_retry" }),
			makeBacktrack({ type: "debugging_loop" }),
		];

		const result = extractSummary({
			stats: makeStats(),
			backtracks,
			phases: [],
			file_map: [],
			reasoning: [],
		});
		expect(result.narrative).toContain("3 backtracks");
		expect(result.narrative).toContain("2 failure retry");
		expect(result.narrative).toContain("1 debugging loop");
	});

	test("singular phase wording", () => {
		const phases = [makePhase("General", 0, 1000)];
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases,
			file_map: [],
			reasoning: [],
		});
		expect(result.narrative).toContain("1 phase:");
	});

	test("uses dominant intent for reasoning summary", () => {
		const reasoning = [
			makeReasoning({ intent_hint: "debugging" }),
			makeReasoning({ intent_hint: "debugging" }),
			makeReasoning({ intent_hint: "planning" }),
		];

		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning,
		});
		expect(result.narrative).toContain("primarily debugging");
	});

	test("narrative unchanged when no team_metrics provided", () => {
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [makeFileMapEntry()],
			reasoning: [],
		});

		expect(result.narrative).not.toContain("Team session");
		expect(result.narrative).not.toContain("agents");
		expect(result.narrative).not.toContain("idle transitions");
	});

	test("appends team sentence when team_metrics has agents", () => {
		const team = makeTeamMetrics();
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [makeFileMapEntry()],
			reasoning: [],
			team_metrics: team,
		});

		expect(result.narrative).toContain("Team session with 3 agents.");
		expect(result.narrative).toContain("5 tasks completed across 8 idle transitions.");
	});

	test("appends utilization when utilization_ratio is available", () => {
		const team = makeTeamMetrics({ utilization_ratio: 0.72 });
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			team_metrics: team,
		});

		expect(result.narrative).toContain("Average utilization: 72%.");
	});

	test("omits utilization when utilization_ratio is undefined", () => {
		const team = makeTeamMetrics({ utilization_ratio: undefined });
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			team_metrics: team,
		});

		expect(result.narrative).toContain("Team session with 3 agents.");
		expect(result.narrative).not.toContain("utilization");
	});

	test("omits team sentence when agent_count is 0", () => {
		const team = makeTeamMetrics({
			agent_count: 0,
			task_completed_count: 0,
			idle_event_count: 0,
			teammate_names: [],
			tasks: [],
			idle_transitions: [],
		});
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			team_metrics: team,
		});

		expect(result.narrative).not.toContain("Team session");
	});

	test("team sentence with 0 tasks completed", () => {
		const team = makeTeamMetrics({
			agent_count: 2,
			task_completed_count: 0,
			idle_event_count: 3,
		});
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			team_metrics: team,
		});

		expect(result.narrative).toContain("Team session with 2 agents.");
		expect(result.narrative).toContain("0 tasks completed across 3 idle transitions.");
	});

	// --- New enrichment tests ---

	test("populates top_errors from failures_by_tool with sample messages", () => {
		const stats = makeStats({
			failures_by_tool: { Edit: 3, Bash: 1 },
		});
		const events: StoredEvent[] = [
			{
				t: 1000,
				event: "PostToolUseFailure",
				sid: "test",
				data: { tool_name: "Edit", error: "old_string not found in file" },
			},
			{
				t: 2000,
				event: "PostToolUseFailure",
				sid: "test",
				data: { tool_name: "Bash", error: "command not found: tsc" },
			},
		];

		const result = extractSummary({
			stats,
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			events,
		});

		expect(result.top_errors).toBeDefined();
		expect(result.top_errors).toHaveLength(2);
		expect(result.top_errors?.[0].tool_name).toBe("Edit");
		expect(result.top_errors?.[0].count).toBe(3);
		expect(result.top_errors?.[0].sample_message).toBe("old_string not found in file");
		expect(result.top_errors?.[1].tool_name).toBe("Bash");
		expect(result.top_errors?.[1].count).toBe(1);
		expect(result.top_errors?.[1].sample_message).toBe("command not found: tsc");
	});

	test("omits top_errors when no failures_by_tool", () => {
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
		});
		expect(result.top_errors).toBeUndefined();
	});

	test("populates task_summary from team_metrics.tasks", () => {
		const team = makeTeamMetrics();
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			team_metrics: team,
		});

		expect(result.task_summary).toBeDefined();
		expect(result.task_summary).toHaveLength(2);
		expect(result.task_summary?.[0].task_id).toBe("1");
		expect(result.task_summary?.[0].agent).toBe("builder-a");
		expect(result.task_summary?.[0].subject).toBe("Implement feature");
	});

	test("omits task_summary when no team_metrics", () => {
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
		});
		expect(result.task_summary).toBeUndefined();
	});

	test("populates agent_workload from agents array", () => {
		const agents: AgentNode[] = [
			{
				session_id: "abc12345-long-id",
				agent_type: "builder",
				agent_name: "builder-a",
				duration_ms: 10000,
				tool_call_count: 25,
				children: [],
				file_map: {
					files: [
						{ file_path: "a.ts", reads: 1, edits: 2, writes: 0, errors: 0, tool_use_ids: [] },
						{ file_path: "b.ts", reads: 3, edits: 0, writes: 1, errors: 0, tool_use_ids: [] },
					],
				},
			},
			{
				session_id: "def67890-long-id",
				agent_type: "researcher",
				duration_ms: 5000,
				tool_call_count: 10,
				children: [],
			},
		];

		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			agents,
		});

		expect(result.agent_workload).toBeDefined();
		expect(result.agent_workload).toHaveLength(2);
		expect(result.agent_workload?.[0].name).toBe("builder-a");
		expect(result.agent_workload?.[0].id).toBe("abc12345");
		expect(result.agent_workload?.[0].tool_calls).toBe(25);
		expect(result.agent_workload?.[0].files_modified).toBe(2);
		expect(result.agent_workload?.[0].duration_ms).toBe(10000);
		// Second agent: no agent_name, falls back to agent_type
		expect(result.agent_workload?.[1].name).toBe("researcher");
		expect(result.agent_workload?.[1].id).toBe("def67890");
		expect(result.agent_workload?.[1].files_modified).toBe(0);
	});

	test("omits agent_workload when no agents", () => {
		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
		});
		expect(result.agent_workload).toBeUndefined();
	});

	test("enhanced team narrative with agents includes type breakdown and top contributors", () => {
		const team = makeTeamMetrics({ agent_count: 3, task_completed_count: 5 });
		const agents: AgentNode[] = [
			{
				session_id: "a1",
				agent_type: "builder",
				agent_name: "builder-a",
				duration_ms: 10000,
				tool_call_count: 50,
				children: [],
			},
			{
				session_id: "a2",
				agent_type: "builder",
				agent_name: "builder-b",
				duration_ms: 8000,
				tool_call_count: 30,
				children: [],
			},
			{
				session_id: "a3",
				agent_type: "researcher",
				agent_name: "researcher-1",
				duration_ms: 5000,
				tool_call_count: 15,
				children: [],
			},
		];

		const result = extractSummary({
			stats: makeStats(),
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			team_metrics: team,
			agents,
		});

		expect(result.narrative).toContain("Team session coordinating 3 agents");
		expect(result.narrative).toContain("2 builder");
		expect(result.narrative).toContain("1 researcher");
		expect(result.narrative).toContain("5 tasks");
		expect(result.narrative).toContain("Top contributors: builder-a (a1), builder-b (a2), researcher-1 (a3)");
	});

	test("enhanced team narrative includes failure breakdown when failures_by_tool exists", () => {
		const stats = makeStats({
			failure_count: 4,
			failures_by_tool: { Edit: 3, Bash: 1 },
		});
		const team = makeTeamMetrics({ agent_count: 2, task_completed_count: 3 });
		const agents: AgentNode[] = [
			{
				session_id: "a1",
				agent_type: "builder",
				agent_name: "builder-a",
				duration_ms: 10000,
				tool_call_count: 20,
				children: [],
			},
			{
				session_id: "a2",
				agent_type: "builder",
				agent_name: "builder-b",
				duration_ms: 8000,
				tool_call_count: 15,
				children: [],
			},
		];

		const result = extractSummary({
			stats,
			backtracks: [],
			phases: [],
			file_map: [],
			reasoning: [],
			team_metrics: team,
			agents,
		});

		expect(result.narrative).toContain("4 failures concentrated in");
		expect(result.narrative).toContain("Edit (3)");
		expect(result.narrative).toContain("Bash (1)");
	});
});

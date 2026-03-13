import { describe, expect, test } from "bun:test";
import {
	formatAgentDetail,
	formatAgentRow,
	formatSessionRow,
	render,
} from "../src/commands/tui-renderers";
import { stripAnsi } from "../src/commands/tui-formatters";
import type { TuiState } from "../src/commands/tui-state";
import type {
	AgentNode,
	DistilledSession,
	SessionSummary,
} from "../src/types";

// --- Test helpers ---

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

const makeState = (overrides?: Partial<TuiState>): TuiState => ({
	view: "session_list",
	sessions: [makeSummary(), makeSummary({ session_id: "bbbb2222-3333-4444-5555-666677778888" })],
	journeys: [],
	selectedIndex: 0,
	detailTab: "overview",
	visibleTabs: ["overview"],
	agentIndex: 0,
	projectDir: "/tmp/test",
	timelineOffset: 0,
	commsOffset: 0,
	contentOffset: 0,
	editFileIndex: 0,
	editGrouping: "directory",
	agentDetailOffset: 0,
	...overrides,
});

// --- formatSessionRow ---

describe("formatSessionRow", () => {
	test("formats session row with all fields", () => {
		const session = makeSummary();
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("aaaa1111");
		expect(row).toContain("main");
		expect(row).toContain("solo");
		expect(row).toContain("complete");
	});

	test("selected row uses inverse ANSI", () => {
		const session = makeSummary();
		const row = formatSessionRow(session, true, 120);
		expect(row).toContain("\x1b[7m"); // inverse
	});

	test("shows session name when present", () => {
		const session = makeSummary({ session_name: "my-feature" });
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("my-feature");
		expect(row).toContain("aaaa1111");
	});

	test("shows only short ID when no session name", () => {
		const session = makeSummary();
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("aaaa1111");
	});

	test("truncates to width", () => {
		const session = makeSummary();
		const row = formatSessionRow(session, false, 40);
		expect(stripAnsi(row).length).toBeLessThanOrEqual(40);
	});

	test("shows team name when present", () => {
		const session = makeSummary({ team_name: "my-team" });
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("my-team");
	});

	test("shows multi(N) type for multi-agent sessions", () => {
		const session = makeSummary({ agent_count: 3 });
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("multi(3)");
	});

	test("shows distill check mark when is_distilled is true", () => {
		const session = makeSummary({ is_distilled: true });
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("\u2713");
	});

	test("selected row pads to full width", () => {
		const session = makeSummary();
		const row = formatSessionRow(session, true, 120);
		expect(stripAnsi(row).length).toBe(120);
	});
});

// --- formatAgentRow ---

describe("formatAgentRow", () => {
	test("formats agent row with name and basic stats", () => {
		const agent = makeAgent();
		const row = formatAgentRow(agent, false, 80);
		expect(row).toContain("builder-types");
		expect(row).toContain("2m");
	});

	test("selected agent uses inverse ANSI", () => {
		const agent = makeAgent();
		const row = formatAgentRow(agent, true, 100);
		expect(row).toContain("\x1b[7m");
	});

	test("shows cost when available", () => {
		const agent = makeAgent({
			cost_estimate: {
				model: "claude-sonnet-4-6",
				estimated_input_tokens: 10000,
				estimated_output_tokens: 5000,
				estimated_cost_usd: 0.45,
				is_estimated: false,
			},
		});
		const row = formatAgentRow(agent, false, 80);
		expect(row).toContain("$0.45");
	});

	test("shows dash for cost when no estimate", () => {
		const agent = makeAgent();
		const row = formatAgentRow(agent, false, 80);
		expect(row).toContain("-");
	});

	test("respects custom labelWidth", () => {
		const agent = makeAgent();
		const row = formatAgentRow(agent, false, 120, 30);
		// Label should be padded to 30 + 2
		expect(stripAnsi(row).length).toBeGreaterThan(30);
	});

	test("selected row pads to full width", () => {
		const agent = makeAgent();
		const row = formatAgentRow(agent, true, 120);
		expect(stripAnsi(row).length).toBe(120);
	});
});

// --- formatAgentDetail ---

describe("formatAgentDetail", () => {
	test("shows agent name, type, and duration", () => {
		const agent = makeAgent();
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("builder-types"))).toBe(true);
		expect(lines.some((l) => l.includes("builder"))).toBe(true);
		expect(lines.some((l) => l.includes("2m"))).toBe(true);
	});

	test("shows tool usage when stats available", () => {
		const agent = makeAgent({
			stats: {
				tool_call_count: 30,
				failure_count: 1,
				tools_by_name: { Read: 15, Edit: 10, Bash: 5 },
				unique_files: [],
			},
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Tool Usage:"))).toBe(true);
		expect(lines.some((l) => l.includes("Read"))).toBe(true);
		expect(lines.some((l) => l.includes("Edit"))).toBe(true);
		expect(lines.some((l) => l.includes("Bash"))).toBe(true);
	});

	test("shows file map when present", () => {
		const agent = makeAgent({
			file_map: {
				files: [
					{ file_path: "src/a.ts", reads: 5, edits: 3, writes: 0, errors: 0, tool_use_ids: [] },
					{ file_path: "src/b.ts", reads: 2, edits: 0, writes: 1, errors: 0, tool_use_ids: [] },
				],
			},
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Files:"))).toBe(true);
		expect(lines.some((l) => l.includes("src/a.ts"))).toBe(true);
		expect(lines.some((l) => l.includes("5R"))).toBe(true);
		expect(lines.some((l) => l.includes("3E"))).toBe(true);
	});

	test("shows token usage when present", () => {
		const agent = makeAgent({
			stats: {
				tool_call_count: 30,
				failure_count: 1,
				tools_by_name: { Read: 15 },
				unique_files: [],
				token_usage: {
					input_tokens: 50000,
					output_tokens: 12000,
					cache_read_tokens: 30000,
					cache_creation_tokens: 5000,
				},
			},
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Token Usage:"))).toBe(true);
		expect(lines.some((l) => l.includes("80,000"))).toBe(true); // 50000 + 30000
		expect(lines.some((l) => l.includes("12,000"))).toBe(true);
		expect(lines.some((l) => l.includes("5,000"))).toBe(true);
	});

	test("hides token usage when absent", () => {
		const agent = makeAgent({
			stats: {
				tool_call_count: 10,
				failure_count: 0,
				tools_by_name: { Read: 10 },
				unique_files: [],
			},
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Token Usage:"))).toBe(false);
	});

	test("shows communication partners when present", () => {
		const agent = makeAgent({
			communication_partners: [
				{
					name: "team-lead",
					sent_count: 3,
					received_count: 2,
					total_count: 5,
					msg_types: ["message"],
				},
			],
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Communication Partners:"))).toBe(true);
		expect(lines.some((l) => l.includes("team-lead"))).toBe(true);
		expect(lines.some((l) => l.includes("sent:"))).toBe(true);
		expect(lines.some((l) => l.includes("recv:"))).toBe(true);
	});

	test("hides communication partners when absent", () => {
		const agent = makeAgent();
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Communication Partners:"))).toBe(false);
	});

	test("shows recent messages when present", () => {
		const agent = makeAgent({
			messages: [
				{ t: 1000, direction: "sent", partner: "team-lead", msg_type: "message", summary: "Done" },
				{ t: 2000, direction: "received", partner: "team-lead", msg_type: "message" },
			],
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Recent Messages:"))).toBe(true);
		expect(lines.some((l) => l.includes("->"))).toBe(true);
		expect(lines.some((l) => l.includes("<-"))).toBe(true);
		expect(lines.some((l) => l.includes("Done"))).toBe(true);
	});

	test("hides messages when absent", () => {
		const agent = makeAgent();
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Recent Messages:"))).toBe(false);
	});

	test("shows task events when present", () => {
		const agent = makeAgent({
			task_events: [
				{ t: 1000, action: "assign", task_id: "t-1", subject: "Build types" },
				{ t: 5000, action: "complete", task_id: "t-1" },
			],
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Task Activity:"))).toBe(true);
		expect(lines.some((l) => l.includes("assign"))).toBe(true);
		expect(lines.some((l) => l.includes("Build types"))).toBe(true);
	});

	test("hides task events when absent", () => {
		const agent = makeAgent();
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Task Activity:"))).toBe(false);
	});

	test("shows idle periods when present", () => {
		const agent = makeAgent({
			idle_periods: [
				{ t: 1000, teammate: "builder-a" },
				{ t: 2000, teammate: "builder-a" },
				{ t: 3000, teammate: "builder-a" },
			],
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Idle Periods: 3"))).toBe(true);
		expect(lines.some((l) => l.includes("builder-a"))).toBe(true);
	});

	test("hides idle periods when absent", () => {
		const agent = makeAgent();
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Idle Periods:"))).toBe(false);
	});

	test("shows cost when present", () => {
		const agent = makeAgent({
			cost_estimate: {
				model: "claude-sonnet-4-6",
				estimated_input_tokens: 10000,
				estimated_output_tokens: 5000,
				estimated_cost_usd: 1.23,
				is_estimated: false,
			},
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Cost:"))).toBe(true);
		expect(lines.some((l) => l.includes("$1.23"))).toBe(true);
	});

	test("hides cost when absent", () => {
		const agent = makeAgent();
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Cost:"))).toBe(false);
	});

	test("shows task prompt when present", () => {
		const agent = makeAgent({
			task_prompt: "Fix the linting errors\nin src/types.ts",
		});
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Task Prompt:"))).toBe(true);
		expect(lines.some((l) => l.includes("Fix the linting errors"))).toBe(true);
		expect(lines.some((l) => l.includes("in src/types.ts"))).toBe(true);
	});

	test("shows model when present", () => {
		const agent = makeAgent({ model: "claude-opus-4" });
		const lines = formatAgentDetail(agent);
		expect(lines.some((l) => l.includes("Model: claude-opus-4"))).toBe(true);
	});
});

// --- render ---

describe("render", () => {
	test("dispatches to session_list view", () => {
		const state = makeState();
		const output = render(state, 24, 80);
		expect(output).toContain("clens explorer");
		expect(output).toContain("aaaa1111");
	});

	test("dispatches to session_detail view", () => {
		const state = makeState({ view: "session_detail" });
		const output = render(state, 24, 80);
		expect(output).toContain("Session Detail");
		expect(output).toContain("overview");
	});

	test("dispatches to agent_detail view", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
		});
		const output = render(state, 24, 80);
		expect(output).toContain("builder-types");
	});

	test("session_list shows column headers", () => {
		const state = makeState();
		const output = render(state, 24, 120);
		expect(output).toContain("Name / ID");
		expect(output).toContain("Started");
		expect(output).toContain("Branch");
		expect(output).toContain("Status");
	});

	test("session_detail shows Single-agent session for solo sessions", () => {
		const state = makeState({
			view: "session_detail",
			sessions: [makeSummary({ agent_count: 0 })],
		});
		const output = render(state, 24, 120);
		expect(output).toContain("Single-agent session");
	});

	test("session_detail shows Multi-agent session with count", () => {
		const state = makeState({
			view: "session_detail",
			sessions: [makeSummary({ agent_count: 4 })],
		});
		const output = render(state, 24, 120);
		expect(output).toContain("Multi-agent session (4 agents)");
	});

	test("agent_detail shows scroll controls", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
		});
		const output = render(state, 24, 80);
		expect(output).toContain("[Esc] back");
		expect(output).toContain("[q] quit");
	});

	test("session_list fits within terminal rows", () => {
		const state = makeState({
			sessions: Array.from({ length: 30 }, (_, i) => makeSummary({ session_id: `sess-${i}` })),
			selectedIndex: 0,
		});
		const output = render(state, 24, 80);
		const lineCount = output.split("\n").length;
		expect(lineCount).toBeLessThanOrEqual(24);
	});

	test("agent_detail shows 'No agent selected' when no agent", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: undefined,
		});
		const output = render(state, 24, 80);
		expect(output).toContain("No agent selected.");
	});

	test("session_detail shows 'No session selected' when empty sessions", () => {
		const state = makeState({
			view: "session_detail",
			sessions: [],
			selectedIndex: 0,
		});
		const output = render(state, 24, 80);
		expect(output).toContain("No session selected.");
	});
});

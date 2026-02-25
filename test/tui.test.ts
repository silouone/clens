import { describe, expect, test } from "bun:test";
import {
	collapseConsecutive,
	colorizeTimelineType,
	formatAgentDetail,
	formatAgentRow,
	formatDecisionsSection,
	formatGitDiffSection,
	formatOverviewTab,
	formatSessionRow,
	formatTimelineTab,
	handleKey,
	nextTab,
	DETAIL_TABS,
	nextTimelineFilter,
	parseKey,
	render,
	type TuiState,
} from "../src/commands/tui";
import {
	colorizeAgent,
	formatAgentLifetimeBar,
	formatCommGraphSummary,
	formatSequenceEntry,
	stripAnsi,
} from "../src/commands/tui-formatters";
import type {
	AgentLifetime,
	AgentNode,
	CommunicationSequenceEntry,
	DistilledSession,
	SessionSummary,
	TimelineEntry,
} from "../src/types";

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
	visibleTabs: ["overview", "backtracks", "decisions", "reasoning", "edits", "timeline", "drift", "agents", "messages", "graph"],
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

const makeTimelineEntry = (overrides?: Partial<TimelineEntry>): TimelineEntry => ({
	t: Date.now(),
	type: "tool_call",
	...overrides,
});

describe("parseKey", () => {
	test("parses escape sequences", () => {
		expect(parseKey(Buffer.from("\x1b[A"))).toBe("up");
		expect(parseKey(Buffer.from("\x1b[B"))).toBe("down");
		expect(parseKey(Buffer.from("\r"))).toBe("enter");
		expect(parseKey(Buffer.from("\t"))).toBe("tab");
		expect(parseKey(Buffer.from("q"))).toBe("q");
		expect(parseKey(Buffer.from("\x1b"))).toBe("escape");
		expect(parseKey(Buffer.from("\x7f"))).toBe("backspace");
	});

	test("returns undefined for unknown keys", () => {
		expect(parseKey(Buffer.from("x"))).toBeUndefined();
		expect(parseKey(Buffer.from("z"))).toBeUndefined();
	});

	test("parses f and a keys", () => {
		expect(parseKey(Buffer.from("f"))).toBe("f");
		expect(parseKey(Buffer.from("a"))).toBe("a");
	});
});

describe("nextTab", () => {
	test("cycles through all tabs", () => {
		const allTabs = [...DETAIL_TABS];
		expect(nextTab("overview", allTabs)).toBe("backtracks");
		expect(nextTab("backtracks", allTabs)).toBe("decisions");
		expect(nextTab("decisions", allTabs)).toBe("reasoning");
		expect(nextTab("reasoning", allTabs)).toBe("edits");
		expect(nextTab("edits", allTabs)).toBe("timeline");
		expect(nextTab("timeline", allTabs)).toBe("drift");
		expect(nextTab("drift", allTabs)).toBe("agents");
		expect(nextTab("agents", allTabs)).toBe("messages");
		expect(nextTab("messages", allTabs)).toBe("graph");
		expect(nextTab("graph", allTabs)).toBe("overview");
	});

	test("cycles through visible tabs only", () => {
		const visible = ["overview", "edits", "timeline"] as const;
		expect(nextTab("overview", visible)).toBe("edits");
		expect(nextTab("edits", visible)).toBe("timeline");
		expect(nextTab("timeline", visible)).toBe("overview");
	});
});

describe("handleKey", () => {
	test("q returns quit from any view", () => {
		expect(handleKey(makeState(), "q")).toBe("quit");
		expect(handleKey(makeState({ view: "session_detail" }), "q")).toBe("quit");
		expect(handleKey(makeState({ view: "agent_detail" }), "q")).toBe("quit");
	});

	test("up/down navigates session list", () => {
		const state = makeState({ selectedIndex: 0 });
		const down = handleKey(state, "down");
		expect(down).not.toBe("quit");
		if (down !== "quit") {
			expect(down.selectedIndex).toBe(1);
		}

		const stateAt1 = makeState({ selectedIndex: 1 });
		const up = handleKey(stateAt1, "up");
		if (up !== "quit") {
			expect(up.selectedIndex).toBe(0);
		}
	});

	test("up does not go below 0", () => {
		const state = makeState({ selectedIndex: 0 });
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.selectedIndex).toBe(0);
		}
	});

	test("down does not exceed session count", () => {
		const state = makeState({ selectedIndex: 1 });
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.selectedIndex).toBe(1);
		}
	});

	test("enter in session_list transitions to session_detail", () => {
		const state = makeState();
		const result = handleKey(state, "enter");
		if (result !== "quit") {
			expect(result.view).toBe("session_detail");
		}
	});

	test("escape in session_detail returns to session_list", () => {
		const state = makeState({ view: "session_detail" });
		const result = handleKey(state, "escape");
		if (result !== "quit") {
			expect(result.view).toBe("session_list");
		}
	});

	test("tab in session_detail cycles tabs", () => {
		const state = makeState({ view: "session_detail", detailTab: "overview" });
		const result = handleKey(state, "tab");
		if (result !== "quit") {
			expect(result.detailTab).toBe("backtracks");
		}
	});

	test("tab resets timelineOffset", () => {
		const state = makeState({ view: "session_detail", detailTab: "overview", timelineOffset: 5 });
		const result = handleKey(state, "tab");
		if (result !== "quit") {
			expect(result.timelineOffset).toBe(0);
		}
	});

	test("escape in agent_detail returns to session_detail", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
		});
		const result = handleKey(state, "escape");
		if (result !== "quit") {
			expect(result.view).toBe("session_detail");
			expect(result.selectedAgent).toBeUndefined();
		}
	});

	test("up/down scrolls timeline", () => {
		// Use alternating tool names to prevent collapsing
		const timeline = Array.from({ length: 50 }, (_, i) => makeTimelineEntry({ t: 1000 + i, tool_name: `Tool${i}` }));
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
			timeline,
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: distilled,
			timelineOffset: 0,
		});

		const downResult = handleKey(state, "down");
		if (downResult !== "quit") {
			expect(downResult.timelineOffset).toBe(1);
		}

		const atOffset5 = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: distilled,
			timelineOffset: 5,
		});
		const upResult = handleKey(atOffset5, "up");
		if (upResult !== "quit") {
			expect(upResult.timelineOffset).toBe(4);
		}
	});

	test("timeline down does not exceed max offset", () => {
		// Use alternating tool names to prevent collapsing
		const timeline = Array.from({ length: 35 }, (_, i) => makeTimelineEntry({ t: 1000 + i, tool_name: `Tool${i}` }));
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 35,
				duration_ms: 60000,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 35,
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
			timeline,
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: distilled,
			timelineOffset: 5, // max is 35 - 30 = 5
		});

		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.timelineOffset).toBe(5);
		}
	});

	test("timeline up does not go below 0", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			timelineOffset: 0,
		});

		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.timelineOffset).toBe(0);
		}
	});
});

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
});

describe("formatSessionRow with enrichment columns", () => {
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

	test("shows solo type and dash for non-enriched sessions", () => {
		const session = makeSummary({ agent_count: 0, is_distilled: false });
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("solo");
		expect(row).not.toContain("\u2713");
	});

	test("shows team name when present", () => {
		const session = makeSummary({ team_name: "my-team" });
		const row = formatSessionRow(session, false, 120);
		expect(row).toContain("my-team");
	});
});

describe("render session_detail with session type header", () => {
	test("shows Single-agent session for solo sessions", () => {
		const state = makeState({
			view: "session_detail",
			sessions: [makeSummary({ agent_count: 0 })],
		});
		const output = render(state, 24, 120);
		expect(output).toContain("Single-agent session");
	});

	test("shows Multi-agent session with count for multi sessions", () => {
		const state = makeState({
			view: "session_detail",
			sessions: [makeSummary({ agent_count: 4 })],
		});
		const output = render(state, 24, 120);
		expect(output).toContain("Multi-agent session (4 agents)");
	});

	test("hides agents tab for single-agent sessions", () => {
		const state = makeState({
			view: "session_detail",
			sessions: [makeSummary({ agent_count: 0 })],
			visibleTabs: ["overview", "edits"],
		});
		const output = render(state, 24, 120);
		expect(output).not.toContain(" agents ");
	});
});

describe("formatOverviewTab", () => {
	test("shows basic info when no distilled data", () => {
		const session = makeSummary();
		const lines = formatOverviewTab(session, undefined);
		expect(lines.some((l) => l.includes("aaaa1111"))).toBe(true);
		expect(lines.some((l) => l.includes("No distilled data"))).toBe(true);
	});

	test("shows structured metrics grid when distilled", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
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
			backtracks: [],
			decisions: [],
			file_map: { files: [] },
			git_diff: { commits: [], hunks: [] },
			complete: true,
			reasoning: [],
			user_messages: [],
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
		};
		const lines = formatOverviewTab(session, distilled);
		// Metrics grid: two-column layout
		expect(lines.some((l) => l.includes("Duration:") && l.includes("Model:"))).toBe(true);
		expect(lines.some((l) => l.includes("Tool calls:") && l.includes("Failures:"))).toBe(true);
		expect(lines.some((l) => l.includes("Files:") && l.includes("Backtracks:"))).toBe(true);
		expect(lines.some((l) => l.includes("Agents:") && l.includes("Tasks:"))).toBe(true);
		expect(lines.some((l) => l.includes("claude-opus-4"))).toBe(true);
	});

	test("shows structured overview description instead of raw narrative", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
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
			summary: {
				narrative: "The session focused on implementing a new auth module.",
				phases: [],
				key_metrics: {
					duration_human: "1m",
					tool_calls: 50,
					failures: 0,
					files_modified: 3,
					backtrack_count: 0,
				},
			},
		};
		const lines = formatOverviewTab(session, distilled);
		// Structured overview replaces narrative wall-of-text
		expect(lines.some((l) => l.includes("Session Overview"))).toBe(true);
		expect(lines.some((l) => l.includes("1m session"))).toBe(true);
		expect(lines.some((l) => l.includes("50 tool calls across 3 files"))).toBe(true);
		// Raw narrative string is no longer displayed
		expect(lines.some((l) => l.includes("implementing a new auth module"))).toBe(false);
	});

	test("shows phases with duration and top tools", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
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
						description: "Implementation phase",
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
		};
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Phases:"))).toBe(true);
		expect(lines.some((l) => l.includes("Planning") && l.includes("TaskCreate"))).toBe(true);
		expect(lines.some((l) => l.includes("Implementation") && l.includes("Edit"))).toBe(true);
	});

	test("shows top errors when present", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
			stats: {
				total_events: 100,
				duration_ms: 60000,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 50,
				failure_count: 4,
				failure_rate: 0.08,
				unique_files: [],
			},
			backtracks: [],
			decisions: [],
			file_map: { files: [] },
			git_diff: { commits: [], hunks: [] },
			complete: true,
			reasoning: [],
			user_messages: [],
			summary: {
				narrative: "Test",
				phases: [],
				key_metrics: {
					duration_human: "1m",
					tool_calls: 50,
					failures: 4,
					files_modified: 5,
					backtrack_count: 0,
				},
				top_errors: [
					{ tool_name: "Bash", count: 3, sample_message: "exit code 1" },
					{ tool_name: "Edit", count: 1, sample_message: "old_string not found" },
				],
			},
		};
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Top Errors:"))).toBe(true);
		expect(lines.some((l) => l.includes("Bash") && l.includes("3") && l.includes("failures"))).toBe(
			true,
		);
		expect(lines.some((l) => l.includes("Edit") && l.includes("1") && l.includes("failure"))).toBe(
			true,
		);
	});

	test("shows plan drift when present", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
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
			plan_drift: {
				spec_path: "specs/my-plan.md",
				expected_files: ["src/a.ts", "src/b.ts", "src/c.ts"],
				actual_files: ["src/a.ts", "src/b.ts", "src/d.ts"],
				unexpected_files: ["src/d.ts"],
				missing_files: ["src/c.ts"],
				drift_score: 0.67,
			},
		};
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Plan Drift:"))).toBe(true);
		expect(lines.some((l) => l.includes("0.67"))).toBe(true);
		expect(lines.some((l) => l.includes("Expected: 3"))).toBe(true);
		expect(lines.some((l) => l.includes("Actual: 3"))).toBe(true);
		expect(lines.some((l) => l.includes("specs/my-plan.md"))).toBe(true);
	});

	test("resolves grandchild agent names via flattenAgents", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
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
				task_summary: [
					{ task_id: "t1", agent: "grandchild-id", subject: "Deep task", t: 1000 },
				],
			},
			agents: [
				makeAgent({
					session_id: "parent-id",
					agent_name: "parent",
					children: [
						makeAgent({
							session_id: "child-id",
							agent_name: "child",
							children: [
								makeAgent({
									session_id: "grandchild-id",
									agent_name: "grandchild-builder",
									children: [],
								}),
							],
						}),
					],
				}),
			],
		};
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("grandchild-builder"))).toBe(true);
	});

	test("shows agent workload when present", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
			stats: {
				total_events: 100,
				duration_ms: 60000,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 200,
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
					{ name: "builder-lintfix", id: "abc12345", tool_calls: 132, files_modified: 12, duration_ms: 300000 },
					{ name: "builder-types", id: "def67890", tool_calls: 80, files_modified: 8, duration_ms: 480000 },
				],
			},
		};
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Agent Workload"))).toBe(true);
		expect(lines.some((l) => l.includes("builder-lintfix") && l.includes("132"))).toBe(true);
		expect(lines.some((l) => l.includes("builder-types") && l.includes("80"))).toBe(true);
	});
});

describe("formatAgentRow", () => {
	test("formats agent row with name, type, duration, tools", () => {
		const agent = makeAgent();
		const row = formatAgentRow(agent, false, 80);
		expect(row).toContain("builder-types");
		expect(row).toContain("builder");
		expect(row).toContain("2m");
	});

	test("shows Files column with count of edited/written files", () => {
		const agent = makeAgent({
			file_map: {
				files: [
					{ file_path: "a.ts", reads: 5, edits: 3, writes: 0, errors: 0, tool_use_ids: [] },
					{ file_path: "b.ts", reads: 2, edits: 0, writes: 1, errors: 0, tool_use_ids: [] },
					{ file_path: "c.ts", reads: 10, edits: 0, writes: 0, errors: 0, tool_use_ids: [] },
				],
			},
		});
		const row = formatAgentRow(agent, false, 100);
		// 2 files have edits or writes (a.ts and b.ts), c.ts is read-only
		expect(row).toContain("2");
		expect(row).toContain("builder-types");
	});

	test("shows cost when available", () => {
		const agent = makeAgent({
			cost_estimate: {
				model: "claude-sonnet-4-6",
				estimated_input_tokens: 10000,
				estimated_output_tokens: 5000,
				estimated_cost_usd: 0.45,
			},
		});
		const row = formatAgentRow(agent, false, 80);
		expect(row).toContain("$0.45");
	});

	test("wider width produces longer rows", () => {
		const agent = makeAgent();
		const row80 = formatAgentRow(agent, false, 80);
		const row120 = formatAgentRow(agent, false, 120);
		// Wider format should not be shorter than narrow format
		expect(row120.length).toBeGreaterThanOrEqual(row80.length);
	});

	test("selected row with width=120 is padded to full width", () => {
		const agent = makeAgent();
		const row = formatAgentRow(agent, true, 120);
		// When selected, padEnd fills to width, so stripped length should be 120
		expect(stripAnsi(row).length).toBe(120);
	});

	test("displays agent_name prominently", () => {
		const agent = makeAgent({ agent_name: "builder-lintfix" });
		const row = formatAgentRow(agent, false, 80);
		expect(row).toContain("builder-lintfix");
	});
});

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
	});
});

describe("colorizeTimelineType", () => {
	test("colors agent_spawn/agent_stop cyan", () => {
		const spawn = colorizeTimelineType(makeTimelineEntry({ type: "agent_spawn" }));
		expect(spawn).toContain("\x1b[36m"); // cyan
		expect(spawn).toContain("agent_spawn");

		const stop = colorizeTimelineType(makeTimelineEntry({ type: "agent_stop" }));
		expect(stop).toContain("\x1b[36m");
	});

	test("colors task events green", () => {
		const create = colorizeTimelineType(makeTimelineEntry({ type: "task_create" }));
		expect(create).toContain("\x1b[32m"); // green

		const assign = colorizeTimelineType(makeTimelineEntry({ type: "task_assign" }));
		expect(assign).toContain("\x1b[32m");

		const complete = colorizeTimelineType(makeTimelineEntry({ type: "task_complete" }));
		expect(complete).toContain("\x1b[32m");
	});

	test("colors failure red", () => {
		const failure = colorizeTimelineType(makeTimelineEntry({ type: "failure" }));
		expect(failure).toContain("\x1b[31m"); // red
	});

	test("colors thinking yellow", () => {
		const thinking = colorizeTimelineType(makeTimelineEntry({ type: "thinking" }));
		expect(thinking).toContain("\x1b[33m"); // yellow
	});

	test("dims tool_call", () => {
		const toolCall = colorizeTimelineType(makeTimelineEntry({ type: "tool_call" }));
		expect(toolCall).toContain("\x1b[2m"); // dim
	});

	test("bolds phase_boundary", () => {
		const phase = colorizeTimelineType(makeTimelineEntry({ type: "phase_boundary" }));
		expect(phase).toContain("\x1b[1m"); // bold
	});

	test("includes tool_name in label when present", () => {
		const entry = colorizeTimelineType(makeTimelineEntry({ type: "tool_call", tool_name: "Read" }));
		expect(entry).toContain("[Read]");
	});

	test("returns plain label for default types", () => {
		const backtrack = colorizeTimelineType(makeTimelineEntry({ type: "backtrack" }));
		expect(backtrack).toBe("backtrack");
	});
});

describe("render", () => {
	test("renders session_list view", () => {
		const state = makeState();
		const output = render(state, 24, 80);
		expect(output).toContain("clens explorer");
		expect(output).toContain("aaaa1111");
	});

	test("renders session_detail view", () => {
		const state = makeState({ view: "session_detail" });
		const output = render(state, 24, 80);
		expect(output).toContain("Session Detail");
		expect(output).toContain("overview");
	});

	test("renders agent_detail view", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
		});
		const output = render(state, 24, 80);
		expect(output).toContain("builder-types");
	});

	test("renders files tab with relative paths grouped by directory", () => {
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
			file_map: {
				files: [
					{
						file_path: "/tmp/test/src/commands/tui.ts",
						reads: 10,
						edits: 6,
						writes: 2,
						errors: 0,
						tool_use_ids: [],
					},
					{
						file_path: "/tmp/test/src/commands/graph.ts",
						reads: 3,
						edits: 2,
						writes: 0,
						errors: 0,
						tool_use_ids: [],
					},
					{
						file_path: "/tmp/test/src/distill/timeline.ts",
						reads: 8,
						edits: 4,
						writes: 1,
						errors: 0,
						tool_use_ids: [],
					},
				],
			},
			git_diff: { commits: [], hunks: [] },
			complete: true,
			reasoning: [],
			user_messages: [],
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			selectedSession: distilled,
			projectDir: "/tmp/test",
		});
		const output = render(state, 40, 100);
		expect(output).toContain("src/commands/");
		expect(output).toContain("tui.ts");
		expect(output).toContain("graph.ts");
		expect(output).toContain("src/distill/");
		expect(output).toContain("timeline.ts");
		// Should NOT contain absolute paths
		expect(output).not.toContain("/tmp/test/src");
	});

	test("renders timeline with scroll indicator and colorized types", () => {
		// Use different tool names to prevent collapsing so we get predictable counts
		const timeline = Array.from({ length: 50 }, (_, i) =>
			makeTimelineEntry({
				t: 1000000 + i * 1000,
				type: i % 5 === 0 ? "failure" : "tool_call",
				tool_name: `Tool${i}`,
			}),
		);
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
			timeline,
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: distilled,
			timelineOffset: 0,
		});
		const output = render(state, 40, 100);
		expect(output).toContain("Timeline:");
		expect(output).toContain("1-30 of 50");
		// Should have red for failures and dim for tool_calls
		expect(output).toContain("\x1b[31m"); // red (failure)
		expect(output).toContain("\x1b[2m"); // dim (tool_call)
	});

	test("agents tab says 'No agent data available.' without --deep", () => {
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "agents",
			selectedSession: distilled,
		});
		const output = render(state, 24, 80);
		expect(output).toContain("No agent data available.");
		expect(output).not.toContain("--deep");
	});

	test("agents tab header includes Files column", () => {
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
			agents: [makeAgent()],
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "agents",
			selectedSession: distilled,
		});
		const output = render(state, 24, 100);
		expect(output).toContain("Files");
		expect(output).toContain("Agent");
		expect(output).toContain("Cost");
	});
});

// --- Communication sequence formatters ---

describe("formatSequenceEntry", () => {
	test("formats entry with from, to, arrow, and msg_type", () => {
		const entry: CommunicationSequenceEntry = {
			t: 1700000000000,
			from_id: "uuid-lead",
			from_name: "team-lead",
			to_id: "uuid-builder-a",
			to_name: "builder-a",
			from: "team-lead",
			to: "builder-a",
			msg_type: "message",
		};
		const agentNames = ["team-lead", "builder-a"];
		const result = formatSequenceEntry(entry, agentNames);
		expect(result).toContain("team-lead");
		expect(result).toContain("builder-a");
		expect(result).toContain("\u2192"); // arrow
		expect(result).toContain("[message]");
	});

	test("includes summary when present", () => {
		const entry: CommunicationSequenceEntry = {
			t: 1700000000000,
			from_id: "uuid-lead",
			from_name: "lead",
			to_id: "uuid-builder",
			to_name: "builder",
			from: "lead",
			to: "builder",
			msg_type: "message",
			summary: "Task completed",
		};
		const result = formatSequenceEntry(entry, ["lead", "builder"]);
		expect(result).toContain('"Task completed"');
	});

	test("omits summary when not present", () => {
		const entry: CommunicationSequenceEntry = {
			t: 1700000000000,
			from_id: "uuid-lead",
			from_name: "lead",
			to_id: "uuid-builder",
			to_name: "builder",
			from: "lead",
			to: "builder",
			msg_type: "message",
		};
		const result = formatSequenceEntry(entry, ["lead", "builder"]);
		expect(result).not.toContain('"');
	});

	test("colorizes agent names", () => {
		const entry: CommunicationSequenceEntry = {
			t: 1700000000000,
			from_id: "uuid-lead",
			from_name: "lead",
			to_id: "uuid-builder",
			to_name: "builder",
			from: "lead",
			to: "builder",
			msg_type: "message",
		};
		const result = formatSequenceEntry(entry, ["lead", "builder"]);
		expect(result).toContain("\x1b[");
	});
});

describe("formatAgentLifetimeBar", () => {
	test("renders bar with name and timeline", () => {
		const lifetime: AgentLifetime = {
			agent_id: "a1",
			agent_name: "builder-1",
			start_t: 1000,
			end_t: 5000,
			agent_type: "builder",
		};
		const result = formatAgentLifetimeBar(lifetime, 0, 10000, 40, ["builder-1"]);
		expect(result).toContain("builder-1");
		expect(result).toContain("\u2588");
	});

	test("handles zero-span gracefully", () => {
		const lifetime: AgentLifetime = {
			agent_id: "a1",
			agent_name: "builder-1",
			start_t: 1000,
			end_t: 1000,
			agent_type: "builder",
		};
		const result = formatAgentLifetimeBar(lifetime, 1000, 1000, 40, ["builder-1"]);
		expect(result).toContain("builder-1");
	});

	test("falls back to truncated agent_id when no name", () => {
		const lifetime: AgentLifetime = {
			agent_id: "abcdefgh-long-uuid",
			start_t: 0,
			end_t: 5000,
			agent_type: "builder",
		};
		const result = formatAgentLifetimeBar(lifetime, 0, 10000, 40, []);
		expect(result).toContain("abcdefgh");
	});

	test("ANSI colors do not misalign bar padding", () => {
		const lt1: AgentLifetime = {
			agent_id: "a1",
			agent_name: "builder-1",
			start_t: 0,
			end_t: 5000,
			agent_type: "builder",
		};
		const lt2: AgentLifetime = {
			agent_id: "a2",
			agent_name: "lead",
			start_t: 0,
			end_t: 10000,
			agent_type: "leader",
		};
		const agentNames = ["builder-1", "lead"];
		const bar1 = formatAgentLifetimeBar(lt1, 0, 10000, 30, agentNames);
		const bar2 = formatAgentLifetimeBar(lt2, 0, 10000, 30, agentNames);
		// Both bars should start at the same column after stripping ANSI
		const stripped1 = stripAnsi(bar1);
		const stripped2 = stripAnsi(bar2);
		// The bar character position should be consistent
		const barStart1 = stripped1.indexOf("\u2588") >= 0 ? stripped1.indexOf("\u2588") : stripped1.indexOf("\u2500");
		const barStart2 = stripped2.indexOf("\u2588") >= 0 ? stripped2.indexOf("\u2588") : stripped2.indexOf("\u2500");
		expect(barStart1).toBe(barStart2);
	});

	test("renders full bar when agent spans entire range", () => {
		const lifetime: AgentLifetime = {
			agent_id: "a1",
			agent_name: "builder-1",
			start_t: 0,
			end_t: 10000,
			agent_type: "builder",
		};
		const result = formatAgentLifetimeBar(lifetime, 0, 10000, 20, ["builder-1"]);
		expect(result).toContain("\u2588");
	});
});

describe("colorizeAgent", () => {
	test("assigns consistent colors by index", () => {
		const agents = ["lead", "builder", "validator"];
		const colored1 = colorizeAgent("lead", agents);
		const colored2 = colorizeAgent("builder", agents);
		expect(colored1).toContain("lead");
		expect(colored2).toContain("builder");
		expect(colored1).not.toBe(colored2);
	});

	test("wraps around colors for many agents", () => {
		const agents = Array.from({ length: 10 }, (_, i) => `agent-${i}`);
		const result = colorizeAgent("agent-7", agents);
		expect(result).toContain("agent-7");
		expect(result).toContain("\x1b[");
	});
});

describe("formatDecisionsSection", () => {
	test("returns empty for no decisions", () => {
		expect(formatDecisionsSection([])).toEqual([]);
	});

	test("groups decisions by type and shows counts", () => {
		const decisions = [
			{ type: "timing_gap" as const, t: 1000, gap_ms: 5000, classification: "user_idle" as const },
			{ type: "timing_gap" as const, t: 2000, gap_ms: 3000, classification: "session_pause" as const },
			{ type: "tool_pivot" as const, t: 3000, from_tool: "Read", to_tool: "Edit", after_failure: false },
			{ type: "phase_boundary" as const, t: 4000, phase_name: "Implementation", phase_index: 1 },
		];
		const lines = formatDecisionsSection(decisions);
		expect(lines.some((l) => l.includes("2 timing gaps"))).toBe(true);
		expect(lines.some((l) => l.includes("1 tool pivot"))).toBe(true);
		expect(lines.some((l) => l.includes("1 phase boundary"))).toBe(true);
	});

	test("shows 3 most recent decisions", () => {
		const decisions = [
			{ type: "timing_gap" as const, t: 1000, gap_ms: 5000, classification: "user_idle" as const },
			{ type: "tool_pivot" as const, t: 5000, from_tool: "Read", to_tool: "Edit", after_failure: true },
			{ type: "tool_pivot" as const, t: 4000, from_tool: "Bash", to_tool: "Read", after_failure: false },
			{ type: "phase_boundary" as const, t: 3000, phase_name: "Review", phase_index: 2 },
			{ type: "timing_gap" as const, t: 2000, gap_ms: 3000, classification: "session_pause" as const },
		];
		const lines = formatDecisionsSection(decisions);
		// Most recent first: t=5000, t=4000, t=3000
		expect(lines.some((l) => l.includes("Read -> Edit"))).toBe(true);
		expect(lines.some((l) => l.includes("Bash -> Read"))).toBe(true);
		expect(lines.some((l) => l.includes("Review"))).toBe(true);
	});

	test("shows in overview tab when decisions present", () => {
		const session = makeSummary();
		const distilled: DistilledSession = {
			session_id: session.session_id,
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
			decisions: [
				{ type: "timing_gap", t: 1000, gap_ms: 5000, classification: "user_idle" },
			],
			file_map: { files: [] },
			git_diff: { commits: [], hunks: [] },
			complete: true,
			reasoning: [],
			user_messages: [],
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
		};
		const lines = formatOverviewTab(session, distilled);
		expect(lines.some((l) => l.includes("Decision Points:"))).toBe(true);
	});
});

describe("nextTimelineFilter", () => {
	test("cycles through filter types", () => {
		expect(nextTimelineFilter(undefined)).toBe("failure");
		expect(nextTimelineFilter("failure")).toBe("thinking");
		expect(nextTimelineFilter("thinking")).toBe("tool_call");
		expect(nextTimelineFilter("tool_call")).toBe("agent_spawn");
		expect(nextTimelineFilter("agent_spawn")).toBe("msg_send");
		expect(nextTimelineFilter("msg_send")).toBe(undefined);
	});
});

describe("formatTimelineTab with filter", () => {
	test("shows all entries when no filter", () => {
		const timeline = [
			makeTimelineEntry({ t: 1000, type: "failure" }),
			makeTimelineEntry({ t: 2000, type: "tool_call" }),
			makeTimelineEntry({ t: 3000, type: "thinking" }),
		];
		const lines = formatTimelineTab(timeline, 0);
		expect(lines.some((l) => l.includes("3 of 3"))).toBe(true);
	});

	test("filters entries by type", () => {
		const timeline = [
			makeTimelineEntry({ t: 1000, type: "failure" }),
			makeTimelineEntry({ t: 2000, type: "tool_call" }),
			makeTimelineEntry({ t: 3000, type: "failure" }),
		];
		const lines = formatTimelineTab(timeline, 0, "failure");
		expect(lines.some((l) => l.includes("2 of 2"))).toBe(true);
		expect(lines.some((l) => l.includes("filter: failure"))).toBe(true);
	});

	test("'f' key in timeline tab cycles filter", () => {
		const timeline = Array.from({ length: 10 }, (_, i) => makeTimelineEntry({ t: 1000 + i }));
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 10,
				duration_ms: 60000,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 10,
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
			timeline,
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: distilled,
			timelineOffset: 5,
		});
		const result = handleKey(state, "f");
		if (result !== "quit") {
			expect(result.timelineTypeFilter).toBe("failure");
			expect(result.timelineOffset).toBe(0);
		}
	});
});

describe("formatGitDiffSection", () => {
	test("returns empty for no hunks and no working tree changes", () => {
		expect(formatGitDiffSection({ commits: [], hunks: [] })).toEqual([]);
	});

	test("shows commit count and line totals", () => {
		const gitDiff = {
			commits: ["abc123", "def456"],
			hunks: [
				{ commit_hash: "abc123", file_path: "src/a.ts", additions: 20, deletions: 5 },
				{ commit_hash: "def456", file_path: "src/b.ts", additions: 10, deletions: 3 },
			],
		};
		const lines = formatGitDiffSection(gitDiff);
		expect(lines.some((l) => l.includes("2 commits"))).toBe(true);
		expect(lines.some((l) => l.includes("+30"))).toBe(true);
		expect(lines.some((l) => l.includes("-8"))).toBe(true);
	});

	test("omits working tree section in TUI (compact mode)", () => {
		const gitDiff = {
			commits: [],
			hunks: [
				{ commit_hash: "abc", file_path: "x.ts", additions: 1, deletions: 0 },
			],
			working_tree_changes: [
				{ file_path: "src/new.ts", status: "added" as const, additions: 50 },
			],
		};
		const lines = formatGitDiffSection(gitDiff);
		expect(lines.some((l) => l.includes("Working tree"))).toBe(false);
		expect(lines.some((l) => l.includes("x.ts"))).toBe(true);
	});
});

describe("agent filter on files tab", () => {
	test("'a' key cycles through agent names", () => {
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
			agents: [
				makeAgent({ session_id: "a1", agent_name: "builder-a", children: [] }),
				makeAgent({ session_id: "a2", agent_name: "builder-b", children: [] }),
			],
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			selectedSession: distilled,
		});
		const result = handleKey(state, "a");
		if (result !== "quit") {
			expect(result.agentFilter).toBe("builder-a");
		}
	});

	test("'a' key cycles back to undefined after last agent", () => {
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
			agents: [
				makeAgent({ session_id: "a1", agent_name: "builder-a", children: [] }),
			],
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			selectedSession: distilled,
			agentFilter: "builder-a",
		});
		const result = handleKey(state, "a");
		if (result !== "quit") {
			expect(result.agentFilter).toBeUndefined();
		}
	});

	test("files tab shows filter indicator", () => {
		const distilled: DistilledSession = {
			session_id: "aaaa1111",
			stats: {
				total_events: 50,
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
			file_map: {
				files: [
					{ file_path: "/tmp/test/a.ts", reads: 1, edits: 1, writes: 0, errors: 0, tool_use_ids: [] },
				],
			},
			git_diff: { commits: [], hunks: [] },
			complete: true,
			reasoning: [],
			user_messages: [],
			agents: [makeAgent({ session_id: "a1", agent_name: "builder-a", children: [] })],
			edit_chains: {
				chains: [
					{
						file_path: "/tmp/test/a.ts",
						steps: [],
						total_edits: 1,
						total_failures: 0,
						total_reads: 0,
						effort_ms: 0,
						has_backtrack: false,
						surviving_edit_ids: [],
						abandoned_edit_ids: [],
						agent_name: "builder-a",
					},
				],
			},
		};
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			selectedSession: distilled,
			projectDir: "/tmp/test",
			agentFilter: "builder-a",
		});
		const output = render(state, 24, 100);
		expect(output).toContain("(agent: builder-a)");
	});
});

describe("formatCommGraphSummary", () => {
	test("returns empty for no edges", () => {
		expect(formatCommGraphSummary([])).toEqual([]);
	});

	test("shows edge count in header", () => {
		const edges = [
			{
				from_id: "a", from_name: "lead", to_id: "b", to_name: "builder",
				from: "lead", to: "builder", count: 5, msg_types: ["message"],
			},
		];
		const lines = formatCommGraphSummary(edges);
		expect(lines.some((l) => l.includes("1 edge"))).toBe(true);
	});

	test("sorts by count and shows top 5", () => {
		const edges = Array.from({ length: 7 }, (_, i) => ({
			from_id: `a${i}`, from_name: `agent-${i}`, to_id: `b${i}`, to_name: `partner-${i}`,
			from: `agent-${i}`, to: `partner-${i}`, count: (i + 1) * 10, msg_types: ["message"],
		}));
		const lines = formatCommGraphSummary(edges);
		// Top edge should be agent-6 (count=70)
		expect(lines.some((l) => l.includes("agent-6"))).toBe(true);
		// agent-0 (count=10) should not appear in top 5
		expect(lines.some((l) => l.includes("agent-0"))).toBe(false);
	});

	test("shows msg types in brackets", () => {
		const edges = [
			{
				from_id: "a", from_name: "lead", to_id: "b", to_name: "builder",
				from: "lead", to: "builder", count: 3, msg_types: ["message", "broadcast"],
			},
		];
		const lines = formatCommGraphSummary(edges);
		expect(lines.some((l) => l.includes("[message, broadcast]"))).toBe(true);
	});
});

describe("formatAgentDetail - enriched fields", () => {
	test("shows token usage when present", () => {
		const agent = makeAgent({
			stats: {
				tool_call_count: 30,
				failure_count: 1,
				tools_by_name: { Read: 15, Edit: 10, Bash: 5 },
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
		expect(lines.some((l) => l.includes("50,000"))).toBe(true);
		expect(lines.some((l) => l.includes("12,000"))).toBe(true);
	});

	test("hides token usage when not present", () => {
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

	test("shows messages when present", () => {
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
});

describe("renderSessionList line count", () => {
	test("renderSessionList output fits within terminal rows", () => {
		const rows = 24;
		const state = makeState({
			sessions: Array.from({ length: 30 }, (_, i) => makeSummary({ session_id: `sess-${i}` })),
			selectedIndex: 0,
			projectDir: "/tmp",
		});
		const output = render(state, rows, 80);
		const lineCount = output.split("\n").length;
		expect(lineCount).toBeLessThanOrEqual(rows);
	});

	test("renderSessionList output fits within terminal rows with selection at end", () => {
		const rows = 24;
		const state = makeState({
			sessions: Array.from({ length: 30 }, (_, i) => makeSummary({ session_id: `sess-${i}` })),
			selectedIndex: 29,
			projectDir: "/tmp",
		});
		const output = render(state, rows, 80);
		const lineCount = output.split("\n").length;
		expect(lineCount).toBeLessThanOrEqual(rows);
	});
});

describe("collapseConsecutive", () => {
	test("returns empty for empty input", () => {
		expect(collapseConsecutive([])).toEqual([]);
	});

	test("does not collapse different tool_call types", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Edit" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(2);
		expect(result[0].count).toBe(1);
		expect(result[1].count).toBe(1);
	});

	test("collapses consecutive same tool_call entries", () => {
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

	test("does not collapse non-tool_call types", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "failure" }),
			makeTimelineEntry({ t: 2000, type: "failure" }),
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
		expect(result[2].count).toBe(1);
	});

	test("respects agent_name boundary", () => {
		const entries = [
			makeTimelineEntry({ t: 1000, type: "tool_call", tool_name: "Read", agent_name: "builder-a" }),
			makeTimelineEntry({ t: 2000, type: "tool_call", tool_name: "Read", agent_name: "builder-b" }),
		];
		const result = collapseConsecutive(entries);
		expect(result.length).toBe(2);
	});
});

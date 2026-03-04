import { describe, expect, test } from "bun:test";
import {
	CONTENT_SCROLL_TABS,
	createInitialState,
	DETAIL_TABS,
	filterFilesByAgent,
	getEditsFileList,
	getVisibleTabs,
	handleKey,
	nextTab,
	nextTimelineFilter,
	prevTab,
	type DetailTab,
	type TuiState,
} from "../src/commands/tui-state";
import type {
	AgentNode,
	DistilledSession,
	FileMapEntry,
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

const makeFileMapEntry = (overrides?: Partial<FileMapEntry>): FileMapEntry => ({
	file_path: "/tmp/test/src/foo.ts",
	reads: 3,
	edits: 2,
	writes: 1,
	errors: 0,
	tool_use_ids: [],
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
	...overrides,
});

const makeState = (overrides?: Partial<TuiState>): TuiState => ({
	view: "session_list",
	sessions: [makeSummary(), makeSummary({ session_id: "bbbb2222-3333-4444-5555-666677778888" })],
	journeys: [],
	selectedIndex: 0,
	detailTab: "overview",
	visibleTabs: [
		"overview", "backtracks", "decisions", "reasoning",
		"edits", "timeline", "drift", "agents", "messages", "graph",
	],
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

// --- createInitialState ---

describe("createInitialState", () => {
	test("produces valid TuiState shape with required fields", () => {
		// createInitialState calls I/O (listSessions/enrichSessionSummaries),
		// so we verify the shape by checking a state built from a non-existent project dir.
		const state = createInitialState("/tmp/nonexistent-clens-test-dir");
		expect(state.view).toBe("session_list");
		expect(state.selectedIndex).toBe(0);
		expect(state.detailTab).toBe("overview");
		expect(state.visibleTabs).toEqual(["overview"]);
		expect(state.agentIndex).toBe(0);
		expect(state.projectDir).toBe("/tmp/nonexistent-clens-test-dir");
		expect(state.timelineOffset).toBe(0);
		expect(state.commsOffset).toBe(0);
		expect(state.contentOffset).toBe(0);
		expect(state.editFileIndex).toBe(0);
		expect(state.editGrouping).toBe("directory");
		expect(state.agentDetailOffset).toBe(0);
		expect(Array.isArray(state.sessions)).toBe(true);
		expect(Array.isArray(state.journeys)).toBe(true);
	});
});

// --- nextTimelineFilter ---

describe("nextTimelineFilter", () => {
	test("cycles through all filter values and back to undefined", () => {
		expect(nextTimelineFilter(undefined)).toBe("failure");
		expect(nextTimelineFilter("failure")).toBe("thinking");
		expect(nextTimelineFilter("thinking")).toBe("tool_call");
		expect(nextTimelineFilter("tool_call")).toBe("agent_spawn");
		expect(nextTimelineFilter("agent_spawn")).toBe("msg_send");
		expect(nextTimelineFilter("msg_send")).toBe(undefined);
	});

	test("full cycle returns to the original value", () => {
		const start: TimelineEntry["type"] | undefined = undefined;
		const one = nextTimelineFilter(start);
		const two = nextTimelineFilter(one);
		const three = nextTimelineFilter(two);
		const four = nextTimelineFilter(three);
		const five = nextTimelineFilter(four);
		const six = nextTimelineFilter(five);
		expect(six).toBe(start);
	});
});

// --- getVisibleTabs ---

describe("getVisibleTabs", () => {
	test("returns only overview when distilled is undefined", () => {
		expect(getVisibleTabs(undefined)).toEqual(["overview"]);
	});

	test("returns only overview for empty distilled data", () => {
		const distilled = makeDistilled();
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toEqual(["overview"]);
	});

	test("includes backtracks tab when backtracks exist", () => {
		const distilled = makeDistilled({
			backtracks: [
				{
					type: "failure_retry",
					start_t: 1000,
					end_t: 2000,
					attempts: 2,
					tool_name: "Edit",
					file_path: "a.ts",
				},
			],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("backtracks");
	});

	test("includes decisions tab when decisions exist", () => {
		const distilled = makeDistilled({
			decisions: [
				{ type: "timing_gap", t: 1000, gap_ms: 5000, classification: "user_idle" },
			],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("decisions");
	});

	test("includes reasoning tab when reasoning exists", () => {
		const distilled = makeDistilled({
			reasoning: [{ thinking: "some reasoning", intent_hint: "planning", t: 1000 }],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("reasoning");
	});

	test("includes edits tab when files exist", () => {
		const distilled = makeDistilled({
			file_map: { files: [makeFileMapEntry()] },
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("edits");
	});

	test("includes timeline tab when timeline entries exist", () => {
		const distilled = makeDistilled({
			timeline: [makeTimelineEntry()],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("timeline");
	});

	test("includes drift tab when plan_drift exists", () => {
		const distilled = makeDistilled({
			plan_drift: {
				spec_path: "specs/plan.md",
				expected_files: ["a.ts"],
				actual_files: ["a.ts"],
				unexpected_files: [],
				missing_files: [],
				drift_score: 0.0,
			},
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("drift");
	});

	test("includes agents tab when agents exist", () => {
		const distilled = makeDistilled({
			agents: [makeAgent()],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("agents");
	});

	test("includes messages tab when comm_sequence exists", () => {
		const distilled = makeDistilled({
			comm_sequence: [
				{
					t: 1000,
					from_id: "a",
					from_name: "lead",
					to_id: "b",
					to_name: "builder",
					from: "lead",
					to: "builder",
					msg_type: "message",
				},
			],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("messages");
	});

	test("includes graph tab when communication_graph exists", () => {
		const distilled = makeDistilled({
			communication_graph: [
				{
					from_id: "a",
					from_name: "lead",
					to_id: "b",
					to_name: "builder",
					from: "lead",
					to: "builder",
					count: 5,
					msg_types: ["message"],
				},
			],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toContain("graph");
	});

	test("includes all tabs when all data is present", () => {
		const distilled = makeDistilled({
			backtracks: [
				{
					type: "failure_retry",
					start_t: 1000,
					end_t: 2000,
					attempts: 2,
					tool_name: "Edit",
					file_path: "a.ts",
				},
			],
			decisions: [
				{ type: "timing_gap", t: 1000, gap_ms: 5000, classification: "user_idle" },
			],
			reasoning: [{ thinking: "reasoning", intent_hint: "planning", t: 1000 }],
			file_map: { files: [makeFileMapEntry()] },
			timeline: [makeTimelineEntry()],
			plan_drift: {
				spec_path: "specs/plan.md",
				expected_files: [],
				actual_files: [],
				unexpected_files: [],
				missing_files: [],
				drift_score: 0.0,
			},
			agents: [makeAgent()],
			comm_sequence: [
				{
					t: 1000,
					from_id: "a",
					from_name: "lead",
					to_id: "b",
					to_name: "builder",
					from: "lead",
					to: "builder",
					msg_type: "message",
				},
			],
			communication_graph: [
				{
					from_id: "a",
					from_name: "lead",
					to_id: "b",
					to_name: "builder",
					from: "lead",
					to: "builder",
					count: 5,
					msg_types: ["message"],
				},
			],
		});
		const tabs = getVisibleTabs(distilled);
		expect(tabs).toEqual([
			"overview",
			"backtracks",
			"decisions",
			"reasoning",
			"edits",
			"timeline",
			"drift",
			"agents",
			"messages",
			"graph",
		]);
	});
});

// --- nextTab / prevTab ---

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

	test("cycles through visible tabs subset", () => {
		const visible: readonly DetailTab[] = ["overview", "edits", "timeline"];
		expect(nextTab("overview", visible)).toBe("edits");
		expect(nextTab("edits", visible)).toBe("timeline");
		expect(nextTab("timeline", visible)).toBe("overview");
	});

	test("wraps around to first tab from last tab", () => {
		const visible: readonly DetailTab[] = ["overview", "agents"];
		expect(nextTab("agents", visible)).toBe("overview");
	});

	test("uses DETAIL_TABS when visibleTabs is empty", () => {
		expect(nextTab("overview", [])).toBe("backtracks");
	});
});

describe("prevTab", () => {
	test("cycles backward through all tabs", () => {
		const allTabs = [...DETAIL_TABS];
		expect(prevTab("overview", allTabs)).toBe("graph");
		expect(prevTab("backtracks", allTabs)).toBe("overview");
		expect(prevTab("graph", allTabs)).toBe("messages");
	});

	test("cycles backward through visible tabs subset", () => {
		const visible: readonly DetailTab[] = ["overview", "edits", "timeline"];
		expect(prevTab("overview", visible)).toBe("timeline");
		expect(prevTab("edits", visible)).toBe("overview");
		expect(prevTab("timeline", visible)).toBe("edits");
	});

	test("wraps around to last tab from first tab", () => {
		const visible: readonly DetailTab[] = ["overview", "agents"];
		expect(prevTab("overview", visible)).toBe("agents");
	});

	test("uses DETAIL_TABS when visibleTabs is empty", () => {
		expect(prevTab("overview", [])).toBe("graph");
	});
});

// --- filterFilesByAgent / getEditsFileList ---

describe("filterFilesByAgent", () => {
	test("returns all files when no agent filter is set", () => {
		const files = [makeFileMapEntry({ file_path: "a.ts" }), makeFileMapEntry({ file_path: "b.ts" })];
		const state = makeState({
			selectedSession: makeDistilled({ file_map: { files } }),
		});
		const result = filterFilesByAgent(state);
		expect(result.length).toBe(2);
	});

	test("returns empty when selectedSession has no file_map", () => {
		const state = makeState({ selectedSession: undefined });
		const result = filterFilesByAgent(state);
		expect(result).toEqual([]);
	});

	test("filters files by agent name when agentFilter is set", () => {
		const files = [
			makeFileMapEntry({ file_path: "a.ts" }),
			makeFileMapEntry({ file_path: "b.ts" }),
		];
		const state = makeState({
			agentFilter: "builder-a",
			selectedSession: makeDistilled({
				file_map: { files },
				edit_chains: {
					chains: [
						{
							file_path: "a.ts",
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
						{
							file_path: "b.ts",
							steps: [],
							total_edits: 1,
							total_failures: 0,
							total_reads: 0,
							effort_ms: 0,
							has_backtrack: false,
							surviving_edit_ids: [],
							abandoned_edit_ids: [],
							agent_name: "builder-b",
						},
					],
				},
			}),
		});
		const result = filterFilesByAgent(state);
		expect(result.length).toBe(1);
		expect(result[0].file_path).toBe("a.ts");
	});
});

describe("getEditsFileList", () => {
	test("filters to files with edits, writes, or reads", () => {
		const files = [
			makeFileMapEntry({ file_path: "a.ts", edits: 1, writes: 0, reads: 0 }),
			makeFileMapEntry({ file_path: "b.ts", edits: 0, writes: 0, reads: 0 }),
			makeFileMapEntry({ file_path: "c.ts", edits: 0, writes: 1, reads: 0 }),
		];
		const state = makeState({
			selectedSession: makeDistilled({ file_map: { files } }),
		});
		const result = getEditsFileList(state);
		expect(result.length).toBe(2);
	});

	test("returns files sorted by file_path", () => {
		const files = [
			makeFileMapEntry({ file_path: "z.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "m.ts", edits: 1 }),
		];
		const state = makeState({
			selectedSession: makeDistilled({ file_map: { files } }),
		});
		const result = getEditsFileList(state);
		expect(result.map((f) => f.file_path)).toEqual(["a.ts", "m.ts", "z.ts"]);
	});
});

// --- collapsedTimelineLength (tested indirectly via handleKey timeline down) ---

describe("collapsedTimelineLength (via handleKey)", () => {
	test("counts non-collapsed entries correctly", () => {
		// 35 unique tool_call entries (different tool_names) => collapsed length = 35
		// max offset = 35 - 30 = 5
		const timeline = Array.from({ length: 35 }, (_, i) =>
			makeTimelineEntry({ t: 1000 + i, tool_name: `Tool${i}` }),
		);
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: makeDistilled({ timeline }),
			timelineOffset: 5,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			// At max offset, should not increase further
			expect(result.timelineOffset).toBe(5);
		}
	});

	test("consecutive same tool_calls reduce collapsed length", () => {
		// 35 entries, all same tool_name => collapsed length = 1
		// max offset = max(0, 1 - 30) = 0
		const timeline = Array.from({ length: 35 }, (_, i) =>
			makeTimelineEntry({ t: 1000 + i, tool_name: "Read" }),
		);
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: makeDistilled({ timeline }),
			timelineOffset: 0,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.timelineOffset).toBe(0);
		}
	});

	test("mixed entries with some consecutive same tool_calls", () => {
		// [Read, Read, Read, Edit, Edit, Bash] => collapsed = 3 groups
		// max offset = max(0, 3 - 30) = 0
		const timeline = [
			makeTimelineEntry({ t: 1, tool_name: "Read" }),
			makeTimelineEntry({ t: 2, tool_name: "Read" }),
			makeTimelineEntry({ t: 3, tool_name: "Read" }),
			makeTimelineEntry({ t: 4, tool_name: "Edit" }),
			makeTimelineEntry({ t: 5, tool_name: "Edit" }),
			makeTimelineEntry({ t: 6, tool_name: "Bash" }),
		];
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: makeDistilled({ timeline }),
			timelineOffset: 0,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			// max offset = 0 since 3 < 30
			expect(result.timelineOffset).toBe(0);
		}
	});

	test("empty timeline stays at offset 0", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: makeDistilled({ timeline: [] }),
			timelineOffset: 0,
		});
		// timeline is empty so the timeline branch in handleKey won't match
		// (state.selectedSession.timeline would be empty array, which is truthy)
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.timelineOffset).toBe(0);
		}
	});

	test("single entry stays at offset 0", () => {
		const timeline = [makeTimelineEntry({ t: 1, tool_name: "Read" })];
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: makeDistilled({ timeline }),
			timelineOffset: 0,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.timelineOffset).toBe(0);
		}
	});

	test("agent_name boundary prevents collapsing", () => {
		// Same tool_name but different agent_name => not collapsed => length = 2
		const timeline = [
			makeTimelineEntry({ t: 1, tool_name: "Read", agent_name: "builder-a" }),
			makeTimelineEntry({ t: 2, tool_name: "Read", agent_name: "builder-b" }),
		];
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: makeDistilled({ timeline }),
			timelineOffset: 0,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			// 2 < 30, max offset = 0
			expect(result.timelineOffset).toBe(0);
		}
	});
});

// --- handleKey ---

describe("handleKey - quit", () => {
	test("q returns quit from session_list", () => {
		expect(handleKey(makeState(), "q")).toBe("quit");
	});

	test("q returns quit from session_detail", () => {
		expect(handleKey(makeState({ view: "session_detail" }), "q")).toBe("quit");
	});

	test("q returns quit from agent_detail", () => {
		expect(handleKey(makeState({ view: "agent_detail" }), "q")).toBe("quit");
	});
});

describe("handleKey - unknown keys", () => {
	test("unknown key in session_list returns unchanged state", () => {
		const state = makeState();
		const result = handleKey(state, "x");
		expect(result).not.toBe("quit");
		if (result !== "quit") {
			expect(result).toEqual(state);
		}
	});

	test("unknown key in session_detail returns unchanged state", () => {
		const state = makeState({ view: "session_detail" });
		const result = handleKey(state, "z");
		expect(result).not.toBe("quit");
		if (result !== "quit") {
			expect(result).toEqual(state);
		}
	});

	test("unknown key in agent_detail returns unchanged state", () => {
		const state = makeState({ view: "agent_detail", selectedAgent: makeAgent() });
		const result = handleKey(state, "z");
		expect(result).not.toBe("quit");
		if (result !== "quit") {
			expect(result.view).toBe("agent_detail");
		}
	});
});

describe("handleKey - session_list", () => {
	test("up decrements selectedIndex", () => {
		const state = makeState({ selectedIndex: 1 });
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.selectedIndex).toBe(0);
		}
	});

	test("up does not go below 0", () => {
		const state = makeState({ selectedIndex: 0 });
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.selectedIndex).toBe(0);
		}
	});

	test("down increments selectedIndex", () => {
		const state = makeState({ selectedIndex: 0 });
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.selectedIndex).toBe(1);
		}
	});

	test("down does not exceed session count", () => {
		const state = makeState({ selectedIndex: 1 });
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.selectedIndex).toBe(1);
		}
	});

	test("enter transitions to session_detail", () => {
		const state = makeState();
		const result = handleKey(state, "enter");
		if (result !== "quit") {
			expect(result.view).toBe("session_detail");
			expect(result.detailTab).toBe("overview");
			expect(result.agentIndex).toBe(0);
			expect(result.timelineOffset).toBe(0);
			expect(result.commsOffset).toBe(0);
			expect(result.contentOffset).toBe(0);
		}
	});

	test("enter on empty sessions returns state unchanged", () => {
		const state = makeState({ sessions: [], selectedIndex: 0 });
		const result = handleKey(state, "enter");
		if (result !== "quit") {
			expect(result.view).toBe("session_list");
		}
	});
});

describe("handleKey - session_detail", () => {
	test("escape returns to session_list and clears selections", () => {
		const state = makeState({
			view: "session_detail",
			selectedSession: makeDistilled(),
			selectedAgent: makeAgent(),
			selectedJourney: { lifecycle_type: "single_shot", phases: [] },
		});
		const result = handleKey(state, "escape");
		if (result !== "quit") {
			expect(result.view).toBe("session_list");
			expect(result.selectedSession).toBeUndefined();
			expect(result.selectedAgent).toBeUndefined();
			expect(result.selectedJourney).toBeUndefined();
			expect(result.timelineOffset).toBe(0);
			expect(result.commsOffset).toBe(0);
			expect(result.contentOffset).toBe(0);
		}
	});

	test("backspace returns to session_list", () => {
		const state = makeState({ view: "session_detail" });
		const result = handleKey(state, "backspace");
		if (result !== "quit") {
			expect(result.view).toBe("session_list");
		}
	});

	test("escape from edit detail view clears editSelectedFile", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editSelectedFile: "a.ts",
			contentOffset: 5,
		});
		const result = handleKey(state, "escape");
		if (result !== "quit") {
			expect(result.view).toBe("session_detail");
			expect(result.editSelectedFile).toBeUndefined();
			expect(result.contentOffset).toBe(0);
		}
	});

	test("tab cycles to next tab and resets offsets", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "overview",
			timelineOffset: 5,
			commsOffset: 3,
			contentOffset: 2,
			editFileIndex: 1,
			editSelectedFile: "a.ts",
			editGrouping: "agent",
		});
		const result = handleKey(state, "tab");
		if (result !== "quit") {
			expect(result.detailTab).toBe("backtracks");
			expect(result.timelineOffset).toBe(0);
			expect(result.commsOffset).toBe(0);
			expect(result.contentOffset).toBe(0);
			expect(result.editFileIndex).toBe(0);
			expect(result.editSelectedFile).toBeUndefined();
			expect(result.editGrouping).toBe("directory");
		}
	});

	test("shift_tab cycles to previous tab and resets offsets", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "backtracks",
		});
		const result = handleKey(state, "shift_tab");
		if (result !== "quit") {
			expect(result.detailTab).toBe("overview");
		}
	});

	test("up scrolls content for content scroll tabs", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "overview",
			contentOffset: 3,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.contentOffset).toBe(2);
		}
	});

	test("down scrolls content for content scroll tabs", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "overview",
			contentOffset: 0,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.contentOffset).toBe(1);
		}
	});

	test("up scrolls timeline offset", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			timelineOffset: 5,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.timelineOffset).toBe(4);
		}
	});

	test("up does not go below 0 for timeline", () => {
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

	test("up scrolls comms offset for messages tab", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "messages",
			commsOffset: 3,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.commsOffset).toBe(2);
		}
	});

	test("up scrolls agent index for agents tab", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "agents",
			agentIndex: 2,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.agentIndex).toBe(1);
		}
	});

	test("up in edits file list scrolls editFileIndex", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editFileIndex: 2,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.editFileIndex).toBe(1);
		}
	});

	test("up in edits detail scrolls contentOffset", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editSelectedFile: "a.ts",
			contentOffset: 3,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.contentOffset).toBe(2);
		}
	});

	test("down in edits file list caps at max index", () => {
		const files = [
			makeFileMapEntry({ file_path: "a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "b.ts", edits: 1 }),
		];
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editFileIndex: 1,
			selectedSession: makeDistilled({ file_map: { files } }),
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.editFileIndex).toBe(1);
		}
	});

	test("down in edits detail increments contentOffset", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editSelectedFile: "a.ts",
			contentOffset: 0,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.contentOffset).toBe(1);
		}
	});

	test("down in agents tab caps at last agent", () => {
		const distilled = makeDistilled({
			agents: [
				makeAgent({ session_id: "a1" }),
				makeAgent({ session_id: "a2" }),
			],
		});
		const state = makeState({
			view: "session_detail",
			detailTab: "agents",
			agentIndex: 1,
			selectedSession: distilled,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.agentIndex).toBe(1);
		}
	});

	test("down in messages tab caps at max offset", () => {
		const commSequence = Array.from({ length: 35 }, (_, i) => ({
			t: 1000 + i,
			from_id: "a",
			from_name: "lead",
			to_id: "b",
			to_name: "builder",
			from: "lead",
			to: "builder",
			msg_type: "message",
		}));
		const state = makeState({
			view: "session_detail",
			detailTab: "messages",
			commsOffset: 5, // max is 35 - 30 = 5
			selectedSession: makeDistilled({ comm_sequence: commSequence }),
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.commsOffset).toBe(5);
		}
	});

	test("enter in edits selects a file", () => {
		const files = [
			makeFileMapEntry({ file_path: "a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "b.ts", edits: 1 }),
		];
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editFileIndex: 0,
			selectedSession: makeDistilled({ file_map: { files } }),
		});
		const result = handleKey(state, "enter");
		if (result !== "quit") {
			expect(result.editSelectedFile).toBe("a.ts");
			expect(result.contentOffset).toBe(0);
		}
	});

	test("enter in agents navigates to agent_detail", () => {
		const agent = makeAgent({ session_id: "a1" });
		const distilled = makeDistilled({ agents: [agent] });
		const state = makeState({
			view: "session_detail",
			detailTab: "agents",
			agentIndex: 0,
			selectedSession: distilled,
		});
		const result = handleKey(state, "enter");
		if (result !== "quit") {
			expect(result.view).toBe("agent_detail");
			expect(result.selectedAgent).toEqual(agent);
			expect(result.agentDetailOffset).toBe(0);
		}
	});

	test("f in timeline cycles filter", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			timelineOffset: 5,
		});
		const result = handleKey(state, "f");
		if (result !== "quit") {
			expect(result.timelineTypeFilter).toBe("failure");
			expect(result.timelineOffset).toBe(0);
		}
	});

	test("f in non-timeline tab returns unchanged state", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "overview",
		});
		const result = handleKey(state, "f");
		if (result !== "quit") {
			expect(result).toEqual(state);
		}
	});

	test("a in edits cycles agent filter", () => {
		const distilled = makeDistilled({
			agents: [
				makeAgent({ session_id: "a1", agent_name: "builder-a", children: [] }),
				makeAgent({ session_id: "a2", agent_name: "builder-b", children: [] }),
			],
		});
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

	test("a in edits cycles back to undefined after last agent", () => {
		const distilled = makeDistilled({
			agents: [
				makeAgent({ session_id: "a1", agent_name: "builder-a", children: [] }),
			],
		});
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

	test("a in non-edits tab returns unchanged state", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "overview",
		});
		const result = handleKey(state, "a");
		if (result !== "quit") {
			expect(result).toEqual(state);
		}
	});

	test("g in edits toggles grouping and resets editFileIndex", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editGrouping: "directory",
			editFileIndex: 3,
		});
		const result = handleKey(state, "g");
		if (result !== "quit") {
			expect(result.editGrouping).toBe("agent");
			expect(result.editFileIndex).toBe(0);
		}
	});

	test("g toggles back to directory", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			editGrouping: "agent",
		});
		const result = handleKey(state, "g");
		if (result !== "quit") {
			expect(result.editGrouping).toBe("directory");
		}
	});

	test("g in non-edits tab returns unchanged state", () => {
		const state = makeState({
			view: "session_detail",
			detailTab: "overview",
		});
		const result = handleKey(state, "g");
		if (result !== "quit") {
			expect(result).toEqual(state);
		}
	});
});

describe("handleKey - agent_detail", () => {
	test("escape returns to session_detail and clears agent", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
			agentDetailOffset: 5,
		});
		const result = handleKey(state, "escape");
		if (result !== "quit") {
			expect(result.view).toBe("session_detail");
			expect(result.selectedAgent).toBeUndefined();
			expect(result.agentDetailOffset).toBe(0);
		}
	});

	test("backspace returns to session_detail", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
		});
		const result = handleKey(state, "backspace");
		if (result !== "quit") {
			expect(result.view).toBe("session_detail");
			expect(result.selectedAgent).toBeUndefined();
		}
	});

	test("up decrements agentDetailOffset", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
			agentDetailOffset: 3,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.agentDetailOffset).toBe(2);
		}
	});

	test("up does not go below 0", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
			agentDetailOffset: 0,
		});
		const result = handleKey(state, "up");
		if (result !== "quit") {
			expect(result.agentDetailOffset).toBe(0);
		}
	});

	test("down increments agentDetailOffset", () => {
		const state = makeState({
			view: "agent_detail",
			selectedAgent: makeAgent(),
			agentDetailOffset: 0,
		});
		const result = handleKey(state, "down");
		if (result !== "quit") {
			expect(result.agentDetailOffset).toBe(1);
		}
	});
});

// --- CONTENT_SCROLL_TABS ---

describe("CONTENT_SCROLL_TABS", () => {
	test("contains expected tabs", () => {
		expect(CONTENT_SCROLL_TABS.has("overview")).toBe(true);
		expect(CONTENT_SCROLL_TABS.has("backtracks")).toBe(true);
		expect(CONTENT_SCROLL_TABS.has("decisions")).toBe(true);
		expect(CONTENT_SCROLL_TABS.has("reasoning")).toBe(true);
		expect(CONTENT_SCROLL_TABS.has("drift")).toBe(true);
		expect(CONTENT_SCROLL_TABS.has("graph")).toBe(true);
	});

	test("does not contain tabs with dedicated scroll", () => {
		expect(CONTENT_SCROLL_TABS.has("timeline")).toBe(false);
		expect(CONTENT_SCROLL_TABS.has("messages")).toBe(false);
		expect(CONTENT_SCROLL_TABS.has("agents")).toBe(false);
		expect(CONTENT_SCROLL_TABS.has("edits")).toBe(false);
	});
});

// --- DETAIL_TABS ---

describe("DETAIL_TABS", () => {
	test("has all 10 tabs in order", () => {
		expect(DETAIL_TABS).toEqual([
			"overview",
			"backtracks",
			"decisions",
			"reasoning",
			"edits",
			"timeline",
			"drift",
			"agents",
			"messages",
			"graph",
		]);
	});
});

// --- Full navigation flow ---

describe("handleKey - full navigation flow", () => {
	test("session_list -> session_detail -> agent_detail -> back -> back", () => {
		const agent = makeAgent({ session_id: "a1" });
		const distilled = makeDistilled({ agents: [agent] });

		// Start at session_list
		const s1 = makeState();
		expect(s1.view).toBe("session_list");

		// Enter session_detail
		const s2 = handleKey(s1, "enter");
		if (s2 === "quit") return;
		expect(s2.view).toBe("session_detail");

		// Switch to agents tab
		const s3: TuiState = {
			...s2,
			detailTab: "agents",
			selectedSession: distilled,
		};

		// Enter agent_detail
		const s4 = handleKey(s3, "enter");
		if (s4 === "quit") return;
		expect(s4.view).toBe("agent_detail");
		expect(s4.selectedAgent).toEqual(agent);

		// Back to session_detail
		const s5 = handleKey(s4, "escape");
		if (s5 === "quit") return;
		expect(s5.view).toBe("session_detail");
		expect(s5.selectedAgent).toBeUndefined();

		// Back to session_list
		const s6 = handleKey(s5, "escape");
		if (s6 === "quit") return;
		expect(s6.view).toBe("session_list");
		expect(s6.selectedSession).toBeUndefined();
	});
});

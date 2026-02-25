import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	colorizeTimelineType,
	formatAgentDetail,
	formatAgentRow,
	formatOverviewTab,
	formatSessionRow,
	handleKey,
	nextTab,
	parseKey,
	render,
	type TuiState,
} from "../../src/commands/tui";
import { listSessions, readDistilled } from "../../src/session/read";
import type { SessionSummary, TimelineEntry } from "../../src/types";
import type { DistilledSession } from "../../src/types/distill";
import { cleanupTestProject, createTestProject, SESSION_1_ID } from "./helpers";

// ── Helpers ─────────────────────────────────────────────

const WIDTH = 120;
const ROWS = 40;

const key = (raw: string): string => {
	const parsed = parseKey(Buffer.from(raw));
	return parsed ?? raw;
};

describe("TUI State Machine with Fixture Data", () => {
	let projectDir: string;
	let sessions: SessionSummary[];
	let distilled1: DistilledSession | undefined;

	beforeAll(() => {
		projectDir = createTestProject({ sessionCount: 2, withLinks: true, withDistilled: true });
		sessions = listSessions(projectDir);
		distilled1 = readDistilled(SESSION_1_ID, projectDir);
	});

	afterAll(() => {
		cleanupTestProject(projectDir);
	});

	const makeState = (overrides?: Partial<TuiState>): TuiState => ({
		view: "session_list",
		sessions,
		journeys: [],
		selectedIndex: 0,
		detailTab: "overview",
		visibleTabs: ["overview", "backtracks", "decisions", "reasoning", "edits", "timeline", "drift", "agents", "messages", "graph"],
		agentIndex: 0,
		projectDir,
		timelineOffset: 0,
		commsOffset: 0,
		contentOffset: 0,
		editFileIndex: 0,
		editGrouping: "directory",
		agentDetailOffset: 0,
		...overrides,
	});

	// ── Data Loading ────────────────────────────────────

	test("fixture project has 2 sessions", () => {
		expect(sessions.length).toBe(2);
	});

	test("distilled data loads for session 1", () => {
		expect(distilled1).toBeDefined();
		expect(distilled1?.session_id).toBe(SESSION_1_ID);
	});

	test("distilled data has expected stats", () => {
		expect(distilled1?.stats.tool_call_count).toBeGreaterThan(0);
		expect(distilled1?.stats.total_events).toBeGreaterThan(0);
	});

	test("distilled data has summary", () => {
		expect(distilled1?.summary).toBeDefined();
		expect(distilled1?.summary?.narrative.length).toBeGreaterThan(0);
	});

	test("distilled data has agents for team session", () => {
		expect(distilled1?.agents).toBeDefined();
		expect(distilled1?.agents?.length).toBeGreaterThan(0);
	});

	test("distilled data has communication graph", () => {
		expect(distilled1?.communication_graph).toBeDefined();
	});

	test("distilled data has team metrics", () => {
		expect(distilled1?.team_metrics).toBeDefined();
		expect(distilled1?.team_metrics?.agent_count).toBe(2);
	});

	// ── Session List View ───────────────────────────────

	test("session_list renders both sessions", () => {
		const state = makeState();
		const output = render(state, ROWS, WIDTH);
		expect(output).toContain("e2e-test");
	});

	test("formatSessionRow formats session info", () => {
		const row = formatSessionRow(sessions[0], true, WIDTH);
		expect(row.length).toBeGreaterThan(0);
		expect(typeof row).toBe("string");
	});

	test("down arrow moves selection", () => {
		const state = makeState();
		const next = handleKey(state, key("\x1b[B"));
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.selectedIndex).toBe(1);
		}
	});

	test("up arrow at top stays at 0", () => {
		const state = makeState({ selectedIndex: 0 });
		const next = handleKey(state, key("\x1b[A"));
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.selectedIndex).toBe(0);
		}
	});

	test("down arrow at bottom stays at last index", () => {
		const state = makeState({ selectedIndex: sessions.length - 1 });
		const next = handleKey(state, key("\x1b[B"));
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.selectedIndex).toBe(sessions.length - 1);
		}
	});

	test("q quits from session_list", () => {
		const state = makeState();
		const next = handleKey(state, "q");
		expect(next).toBe("quit");
	});

	// ── Session Detail Navigation ───────────────────────

	test("enter from session_list transitions to session_detail", () => {
		// handleKey on "enter" from session_list calls readDistilled internally
		const state = makeState();
		const next = handleKey(state, key("\r"));
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.view).toBe("session_detail");
		}
	});

	test("tab cycles through detail tabs", () => {
		const tabs = ["overview", "backtracks", "decisions", "reasoning", "edits", "timeline", "drift", "agents", "messages", "graph"] as const;
		tabs.forEach((tab, i) => {
			expect(nextTab(tab, [...tabs])).toBe(tabs[(i + 1) % tabs.length]);
		});
	});

	test("esc from session_detail returns to session_list", () => {
		const state = makeState({
			view: "session_detail",
			selectedSession: distilled1,
		});
		const next = handleKey(state, "escape");
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.view).toBe("session_list");
		}
	});

	test("backspace from session_detail returns to session_list", () => {
		const state = makeState({
			view: "session_detail",
			selectedSession: distilled1,
		});
		const next = handleKey(state, "backspace");
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.view).toBe("session_list");
		}
	});

	// ── Overview Tab ────────────────────────────────────

	test("overview tab renders with distilled data", () => {
		if (!distilled1) return;
		const session = sessions.find((s) => s.session_id === SESSION_1_ID);
		if (!session) return;
		const lines = formatOverviewTab(session, distilled1);
		const text = lines.join("\n");
		expect(text).toContain("Duration");
		expect(text).toContain("Tool calls");
	});

	test("overview tab shows phase info", () => {
		if (!distilled1?.summary?.phases?.length) return;
		const session = sessions.find((s) => s.session_id === SESSION_1_ID);
		if (!session) return;
		const lines = formatOverviewTab(session, distilled1);
		const text = lines.join("\n");
		expect(text).toContain("Phases");
	});

	// ── Agents Tab ──────────────────────────────────────

	test("formatAgentRow produces formatted string", () => {
		if (!distilled1?.agents?.[0]) return;
		const row = formatAgentRow(distilled1.agents[0], true, WIDTH);
		expect(row.length).toBeGreaterThan(0);
	});

	test("enter in agents tab goes to agent_detail", () => {
		if (!distilled1?.agents?.length) return;
		const state = makeState({
			view: "session_detail",
			detailTab: "agents",
			selectedSession: distilled1,
			agentIndex: 0,
		});
		const next = handleKey(state, key("\r"));
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.view).toBe("agent_detail");
		}
	});

	// ── Agent Detail ────────────────────────────────────

	test("formatAgentDetail renders agent info", () => {
		if (!distilled1?.agents?.[0]) return;
		const lines = formatAgentDetail(distilled1.agents[0]);
		const text = lines.join("\n");
		expect(text.length).toBeGreaterThan(0);
	});

	test("esc from agent_detail returns to session_detail", () => {
		if (!distilled1?.agents?.[0]) return;
		const state = makeState({
			view: "agent_detail",
			selectedSession: distilled1,
			selectedAgent: distilled1.agents[0],
		});
		const next = handleKey(state, "escape");
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.view).toBe("session_detail");
		}
	});

	// ── Timeline Tab ────────────────────────────────────

	test("timeline tab handles scrolling", () => {
		if (!distilled1?.timeline?.length) return;
		const state = makeState({
			view: "session_detail",
			detailTab: "timeline",
			selectedSession: distilled1,
			timelineOffset: 0,
		});
		const next = handleKey(state, key("\x1b[B"));
		expect(next).not.toBe("quit");
		if (next !== "quit") {
			expect(next.timelineOffset).toBeGreaterThanOrEqual(0);
		}
	});

	test("colorizeTimelineType returns colored string for each type", () => {
		const entries: TimelineEntry[] = [
			{ t: 0, type: "tool_call", tool_name: "Read" },
			{ t: 0, type: "failure", tool_name: "Edit" },
			{ t: 0, type: "thinking" },
			{ t: 0, type: "phase_boundary" },
			{ t: 0, type: "agent_spawn", agent_name: "builder-1" },
			{ t: 0, type: "task_complete", task_subject: "Fix bug" },
		];
		for (const entry of entries) {
			const colored = colorizeTimelineType(entry);
			expect(typeof colored).toBe("string");
			expect(colored.length).toBeGreaterThan(0);
		}
	});

	// ── Edits Tab ───────────────────────────────────────

	test("edits tab renders with distilled data", () => {
		if (!distilled1?.file_map?.files?.length) return;
		const state = makeState({
			view: "session_detail",
			detailTab: "edits",
			selectedSession: distilled1,
		});
		const output = render(state, ROWS, WIDTH);
		expect(output.length).toBeGreaterThan(0);
	});

	// ── Comms Data Availability ────────────────────────

	test("distilled data carries comm_sequence field", () => {
		expect(distilled1).toBeDefined();
		expect(distilled1?.comm_sequence).toBeDefined();
		expect(distilled1?.comm_sequence?.length).toBeGreaterThan(0);
		const first = distilled1!.comm_sequence![0];
		expect(first.t).toBeGreaterThan(0);
		expect(typeof first.from).toBe("string");
		expect(typeof first.to).toBe("string");
		expect(typeof first.msg_type).toBe("string");
		expect(typeof first.from_id).toBe("string");
		expect(typeof first.from_name).toBe("string");
		expect(typeof first.to_id).toBe("string");
		expect(typeof first.to_name).toBe("string");
	});

	test("distilled data carries agent_lifetimes field", () => {
		expect(distilled1).toBeDefined();
		expect(distilled1?.agent_lifetimes).toBeDefined();
		expect(distilled1?.agent_lifetimes?.length).toBeGreaterThan(0);
		const first = distilled1!.agent_lifetimes![0];
		expect(first.agent_id).toBeDefined();
		expect(first.start_t).toBeGreaterThan(0);
		expect(first.end_t).toBeGreaterThanOrEqual(first.start_t);
		expect(typeof first.agent_type).toBe("string");
	});

	test("tab cycle returns to overview after graph", () => {
		// Validates the complete tab cycle wraps around
		const tabs = ["overview", "backtracks", "decisions", "reasoning", "edits", "timeline", "drift", "agents", "messages", "graph"] as const;
		const lastTab = tabs[tabs.length - 1];
		expect(nextTab(lastTab, [...tabs])).toBe("overview");
	});

	// ── Full Render Cycle ───────────────────────────────

	test("complete navigation flow: list → detail → agent → back → back", () => {
		if (!distilled1?.agents?.length) return;

		// Start at session list
		let state = makeState();
		let output = render(state, ROWS, WIDTH);
		expect(output.length).toBeGreaterThan(0);

		// Navigate to session detail
		state = {
			...state,
			view: "session_detail",
			selectedSession: distilled1,
			detailTab: "overview",
		};
		output = render(state, ROWS, WIDTH);
		expect(output).toContain("Duration");

		// Switch to agents tab
		state = { ...state, detailTab: "agents" };
		output = render(state, ROWS, WIDTH);
		expect(output.length).toBeGreaterThan(0);

		// Enter agent detail
		state = {
			...state,
			view: "agent_detail",
			selectedAgent: distilled1.agents[0],
		};
		output = render(state, ROWS, WIDTH);
		expect(output.length).toBeGreaterThan(0);

		// Back to session detail
		const next1 = handleKey(state, "escape");
		expect(next1).not.toBe("quit");
		if (next1 !== "quit") {
			expect(next1.view).toBe("session_detail");

			// Back to session list
			const next2 = handleKey(next1, "escape");
			expect(next2).not.toBe("quit");
			if (next2 !== "quit") {
				expect(next2.view).toBe("session_list");
			}
		}
	});
});

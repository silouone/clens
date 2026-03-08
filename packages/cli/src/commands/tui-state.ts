import { listJourneys } from "../session/journey";
import { enrichSessionSummaries, listSessions, readDistilled } from "../session/read";
import type {
	AgentNode,
	DistilledSession,
	EditChain,
	FileMapEntry,
	Journey,
	SessionSummary,
	TimelineEntry,
} from "../types";
import { flattenAgents } from "../utils";

// --- View state ---

export type ViewType = "session_list" | "session_detail" | "agent_detail";
export type DetailTab =
	| "overview"
	| "backtracks"
	| "decisions"
	| "reasoning"
	| "edits"
	| "timeline"
	| "drift"
	| "agents"
	| "messages"
	| "graph";

export interface TuiState {
	readonly view: ViewType;
	readonly sessions: readonly SessionSummary[];
	readonly journeys: readonly Journey[];
	readonly selectedIndex: number;
	readonly detailTab: DetailTab;
	readonly visibleTabs: readonly DetailTab[];
	readonly selectedSession?: DistilledSession;
	readonly selectedAgent?: AgentNode;
	readonly selectedJourney?: Journey;
	readonly agentIndex: number;
	readonly projectDir: string;
	readonly timelineOffset: number;
	readonly commsOffset: number;
	readonly contentOffset: number;
	readonly timelineTypeFilter?: TimelineEntry["type"];
	readonly agentFilter?: string;
	readonly editFileIndex: number;
	readonly editSelectedFile?: string;
	readonly editGrouping: "directory" | "agent";
	readonly agentDetailOffset: number;
}

export const createInitialState = (projectDir: string): TuiState => ({
	view: "session_list",
	sessions: enrichSessionSummaries(listSessions(projectDir), projectDir),
	journeys: listJourneys(projectDir),
	selectedIndex: 0,
	detailTab: "overview",
	visibleTabs: ["overview"] as const,
	agentIndex: 0,
	projectDir,
	timelineOffset: 0,
	commsOffset: 0,
	contentOffset: 0,
	editFileIndex: 0,
	editGrouping: "directory",
	agentDetailOffset: 0,
});

// --- Constants ---

export const DETAIL_TABS = [
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
] as const;

/** Tabs that use the generic contentOffset scroll (excludes timeline/messages/agents which have their own scroll). */
export const CONTENT_SCROLL_TABS: ReadonlySet<DetailTab> = new Set<DetailTab>([
	"overview",
	"backtracks",
	"decisions",
	"reasoning",
	"drift",
	"graph",
]);

const TIMELINE_FILTER_CYCLE = [
	undefined,
	"failure",
	"thinking",
	"tool_call",
	"agent_spawn",
	"msg_send",
] as const;

// --- Tab navigation ---

export const nextTimelineFilter = (
	current: TimelineEntry["type"] | undefined,
): TimelineEntry["type"] | undefined => {
	const idx = TIMELINE_FILTER_CYCLE.findIndex((v) => v === current);
	const nextIdx = (idx + 1) % TIMELINE_FILTER_CYCLE.length;
	return TIMELINE_FILTER_CYCLE[nextIdx];
};

export const getVisibleTabs = (distilled: DistilledSession | undefined): readonly DetailTab[] => {
	if (!distilled) return ["overview"] as const;
	return [
		"overview" as const,
		...(distilled.backtracks.length > 0 ? ["backtracks" as const] : []),
		...(distilled.decisions.length > 0 ? ["decisions" as const] : []),
		...(distilled.reasoning.length > 0 ? ["reasoning" as const] : []),
		...(distilled.file_map.files.length > 0 ? ["edits" as const] : []),
		...(distilled.timeline && distilled.timeline.length > 0 ? ["timeline" as const] : []),
		...(distilled.plan_drift ? ["drift" as const] : []),
		...(distilled.agents && distilled.agents.length > 0 ? ["agents" as const] : []),
		...(distilled.comm_sequence && distilled.comm_sequence.length > 0 ? ["messages" as const] : []),
		...(distilled.communication_graph && distilled.communication_graph.length > 0
			? ["graph" as const]
			: []),
	];
};

export const nextTab = (current: DetailTab, visibleTabs: readonly DetailTab[]): DetailTab => {
	const tabs = visibleTabs.length > 0 ? visibleTabs : DETAIL_TABS;
	const idx = tabs.indexOf(current);
	return tabs[(idx + 1) % tabs.length];
};

export const prevTab = (current: DetailTab, visibleTabs: readonly DetailTab[]): DetailTab => {
	const tabs = visibleTabs.length > 0 ? visibleTabs : DETAIL_TABS;
	const idx = tabs.indexOf(current);
	return tabs[(idx - 1 + tabs.length) % tabs.length];
};

// --- Private helpers ---

export const filterFilesByAgent = (state: TuiState): readonly FileMapEntry[] => {
	if (!state.selectedSession?.file_map) return [];
	if (!state.agentFilter || !state.selectedSession.edit_chains) {
		return state.selectedSession.file_map.files;
	}
	const agentFilePaths: ReadonlySet<string> = new Set(
		state.selectedSession.edit_chains.chains
			.filter((c) => c.agent_name === state.agentFilter)
			.map((c) => c.file_path),
	);
	return state.selectedSession.file_map.files.filter((f) => agentFilePaths.has(f.file_path));
};

export const getEditsFileList = (state: TuiState): readonly FileMapEntry[] => {
	const fileMapFiles = filterFilesByAgent(state);
	return fileMapFiles
		.filter((f) => f.edits > 0 || f.writes > 0 || f.reads > 0)
		.slice()
		.sort((a, b) => a.file_path.localeCompare(b.file_path));
};

// --- Collapsed timeline length helper ---

/** Count collapsed consecutive tool_call entries (duplicates only the counting logic from tui-tabs). */
const collapsedTimelineLength = (entries: readonly TimelineEntry[]): number =>
	entries.reduce<number>((count, entry, i) => {
		if (i === 0) return 1;
		const prev = entries[i - 1];
		if (
			prev && prev.type === "tool_call" && entry.type === "tool_call" &&
			prev.tool_name === entry.tool_name && prev.agent_name === entry.agent_name
		) return count;
		return count + 1;
	}, 0);

// --- State machine ---

export const handleKey = (state: TuiState, key: string): TuiState | "quit" => {
	if (key === "q") return "quit";

	switch (state.view) {
		case "session_list": {
			switch (key) {
				case "up":
					return {
						...state,
						selectedIndex: Math.max(0, state.selectedIndex - 1),
					};
				case "down":
					return {
						...state,
						selectedIndex: Math.min(state.sessions.length - 1, state.selectedIndex + 1),
					};
				case "enter": {
					const session = state.sessions[state.selectedIndex];
					if (!session) return state;
					const distilled = readDistilled(session.session_id, state.projectDir);
					const matchingJourney = state.journeys.find((j) =>
						j.phases.some((p) => p.session_id === session.session_id),
					);
					return {
						...state,
						view: "session_detail",
						selectedSession: distilled,
						selectedJourney: matchingJourney,
						visibleTabs: getVisibleTabs(distilled),
						detailTab: "overview",
						agentIndex: 0,
						timelineOffset: 0,
						commsOffset: 0,
						contentOffset: 0,
					};
				}
				default:
					return state;
			}
		}
		case "session_detail": {
			switch (key) {
				case "escape":
				case "backspace":
					if (state.editSelectedFile) {
						return { ...state, editSelectedFile: undefined, contentOffset: 0 };
					}
					return {
						...state,
						view: "session_list",
						selectedSession: undefined,
						selectedAgent: undefined,
						selectedJourney: undefined,
						timelineOffset: 0,
						commsOffset: 0,
						contentOffset: 0,
					};
				case "tab":
					return {
						...state,
						detailTab: nextTab(state.detailTab, state.visibleTabs),
						timelineOffset: 0,
						commsOffset: 0,
						contentOffset: 0,
						editFileIndex: 0,
						editSelectedFile: undefined,
						editGrouping: "directory",
					};
				case "shift_tab":
					return {
						...state,
						detailTab: prevTab(state.detailTab, state.visibleTabs),
						timelineOffset: 0,
						commsOffset: 0,
						contentOffset: 0,
						editFileIndex: 0,
						editSelectedFile: undefined,
						editGrouping: "directory",
					};
				case "up":
					if (state.detailTab === "edits" && state.editSelectedFile) {
						return { ...state, contentOffset: Math.max(0, state.contentOffset - 1) };
					}
					if (state.detailTab === "edits" && !state.editSelectedFile) {
						return { ...state, editFileIndex: Math.max(0, state.editFileIndex - 1) };
					}
					if (state.detailTab === "agents") {
						return { ...state, agentIndex: Math.max(0, state.agentIndex - 1) };
					}
					if (state.detailTab === "timeline") {
						return { ...state, timelineOffset: Math.max(0, state.timelineOffset - 1) };
					}
					if (state.detailTab === "messages") {
						return { ...state, commsOffset: Math.max(0, state.commsOffset - 1) };
					}
					if (CONTENT_SCROLL_TABS.has(state.detailTab)) {
						return { ...state, contentOffset: Math.max(0, state.contentOffset - 1) };
					}
					return state;
				case "down":
					if (state.detailTab === "edits" && state.editSelectedFile) {
						return { ...state, contentOffset: state.contentOffset + 1 };
					}
					if (state.detailTab === "edits" && !state.editSelectedFile) {
						const maxIdx = Math.max(0, getEditsFileList(state).length - 1);
						return { ...state, editFileIndex: Math.min(maxIdx, state.editFileIndex + 1) };
					}
					if (state.detailTab === "agents" && state.selectedSession?.agents) {
						const allAgents = flattenAgents(state.selectedSession.agents);
						return {
							...state,
							agentIndex: Math.min(allAgents.length - 1, state.agentIndex + 1),
						};
					}
					if (state.detailTab === "timeline" && state.selectedSession?.timeline) {
						const filteredTimeline = state.timelineTypeFilter
							? state.selectedSession.timeline.filter((e) => e.type === state.timelineTypeFilter)
							: state.selectedSession.timeline;
						const collapsedLength = collapsedTimelineLength(filteredTimeline);
						const maxOffset = Math.max(0, collapsedLength - 30);
						return { ...state, timelineOffset: Math.min(maxOffset, state.timelineOffset + 1) };
					}
					if (state.detailTab === "messages" && state.selectedSession?.comm_sequence) {
						const maxOffset = Math.max(0, state.selectedSession.comm_sequence.length - 30);
						return { ...state, commsOffset: Math.min(maxOffset, state.commsOffset + 1) };
					}
					if (CONTENT_SCROLL_TABS.has(state.detailTab)) {
						return { ...state, contentOffset: state.contentOffset + 1 };
					}
					return state;
				case "enter":
					if (state.detailTab === "edits" && !state.editSelectedFile) {
						const files = getEditsFileList(state);
						const file = files[state.editFileIndex];
						if (file) return { ...state, editSelectedFile: file.file_path, contentOffset: 0 };
						return state;
					}
					if (state.detailTab === "agents" && state.selectedSession?.agents) {
						const allAgents = flattenAgents(state.selectedSession.agents);
						const agent = allAgents[state.agentIndex];
						if (agent) {
							return { ...state, view: "agent_detail", selectedAgent: agent, agentDetailOffset: 0 };
						}
					}
					return state;
				case "f":
					if (state.detailTab === "timeline") {
						return {
							...state,
							timelineTypeFilter: nextTimelineFilter(state.timelineTypeFilter),
							timelineOffset: 0,
						};
					}
					return state;
				case "a":
					if (state.detailTab === "edits" && state.selectedSession?.agents) {
						const allAgentNames = flattenAgents(state.selectedSession.agents)
							.filter((a): a is AgentNode & { agent_name: string } => a.agent_name !== undefined)
							.map((a) => a.agent_name);
						const uniqueNames = [...new Set(allAgentNames)];
						if (uniqueNames.length === 0) return state;
						const currentIdx = state.agentFilter ? uniqueNames.indexOf(state.agentFilter) : -1;
						const nextIdx = (currentIdx + 1) % (uniqueNames.length + 1);
						const nextFilter = nextIdx === uniqueNames.length ? undefined : uniqueNames[nextIdx];
						return { ...state, agentFilter: nextFilter };
					}
					return state;
				case "g":
					if (state.detailTab === "edits") {
						return {
							...state,
							editGrouping: state.editGrouping === "directory" ? "agent" : "directory",
							editFileIndex: 0,
						};
					}
					return state;
				default:
					return state;
			}
		}
		case "agent_detail": {
			switch (key) {
				case "escape":
				case "backspace":
					return {
						...state,
						view: "session_detail",
						selectedAgent: undefined,
						agentDetailOffset: 0,
					};
				case "up":
					return { ...state, agentDetailOffset: Math.max(0, state.agentDetailOffset - 1) };
				case "down":
					return { ...state, agentDetailOffset: state.agentDetailOffset + 1 };
				default:
					return state;
			}
		}
	}
};

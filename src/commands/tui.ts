import { listJourneys } from "../session/journey";
import { enrichSessionSummaries, listSessions, readDistilled } from "../session/read";
import type {
	AgentNode,
	DecisionPoint,
	DistilledSession,
	EditChain,
	FileMapEntry,
	Journey,
	SessionSummary,
	TimelineEntry,
} from "../types";
import {
	flattenAgents,
	formatDuration,
	formatSessionDate,
	formatSessionDateFull,
	sanitizeAgentName,
} from "../utils";
import {
	ansi,
	colorizeTimelineType,
	formatAgentLifetimeBar,
	formatAttributedDiff,
	formatCommGraphSummary,
	formatDecisionsSection,
	formatEditDetail,
	formatGitDiffSection,
	formatSequenceEntry,
	groupFilesByAgent,
	groupFilesByDirectory,
	pluralize,
	stripAnsi,
} from "./tui-formatters";

export {
	colorizeTimelineType,
	formatDecisionsSection,
	formatGitDiffSection,
} from "./tui-formatters";

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

// --- State transitions ---

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
const CONTENT_SCROLL_TABS: ReadonlySet<DetailTab> = new Set<DetailTab>([
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

const filterFilesByAgent = (state: TuiState): readonly FileMapEntry[] => {
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

const getEditsFileList = (state: TuiState): readonly FileMapEntry[] => {
	const fileMapFiles = filterFilesByAgent(state);
	return fileMapFiles
		.filter((f) => f.edits > 0 || f.writes > 0 || f.reads > 0)
		.slice()
		.sort((a, b) => a.file_path.localeCompare(b.file_path));
};

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
						const collapsedLength = collapseConsecutive(filteredTimeline).length;
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

// --- Formatters (pure, testable) ---

export const formatSessionRow = (
	session: SessionSummary,
	selected: boolean,
	width: number,
): string => {
	const shortId = session.session_id.slice(0, 8);
	const nameLabel = session.session_name
		? `${session.session_name.slice(0, 20)} | ${shortId}`
		: shortId;
	const id = nameLabel.slice(0, 30);
	const started = formatSessionDate(session.start_time);
	const branch = (session.git_branch ?? "-").slice(0, 14);
	const team = (session.team_name ?? "-").slice(0, 10);
	const agentCount = session.agent_count ?? 0;
	const type = agentCount > 0 ? `multi(${agentCount})` : "solo";
	const distillMark = session.is_distilled ? "\u2713" : "-";
	const dur = formatDuration(session.duration_ms);
	const events = String(session.event_count);
	const status = session.status === "complete" ? "complete" : "incomplete";

	const plain =
		`${id.padEnd(32)}${started.padEnd(14)}${branch.padEnd(16)}${team.padEnd(12)}${type.padEnd(10)}${distillMark.padEnd(3)}${dur.padEnd(10)}${events.padEnd(8)}${status}`.slice(
			0,
			width,
		);

	if (selected) {
		return ansi.inverse(plain.padEnd(width));
	}
	return plain;
};

export const formatOverviewTab = (
	session: SessionSummary,
	distilled: DistilledSession | undefined,
	journey?: Journey,
	width: number = 120,
): readonly string[] => {
	const dateStr = formatSessionDateFull(session.start_time);
	const sessionLabel = session.session_name
		? `${session.session_name} (${session.session_id.slice(0, 8)})`
		: session.session_id.slice(0, 8);
	const header = [
		ansi.bold(`Session: ${sessionLabel}`),
		ansi.dim(dateStr),
		ansi.dim("[↑↓] scroll"),
		"",
	] as const;

	if (distilled?.summary) {
		const km = distilled.summary.key_metrics;
		const failRate = km.tool_calls > 0 ? ((km.failures / km.tool_calls) * 100).toFixed(1) : "0.0";
		const model = distilled.stats.model ?? "-";
		const agentCount = distilled.team_metrics?.agent_count ?? 0;
		const taskCount = distilled.team_metrics?.task_completed_count ?? 0;

		const topTools = Object.entries(distilled.stats.tools_by_name)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([name]) => name);

		const overviewLines: readonly string[] = [
			ansi.bold("Session Overview"),
			ansi.dim(
				`  ${km.duration_human} session${km.active_duration_human ? ` (${km.active_duration_human} active)` : ""} using ${model}`,
			),
			ansi.dim(`  ${km.tool_calls} tool calls across ${km.files_modified} files`),
		];

		const phaseNames = distilled.summary.phases.map((p) => p.name).join(", ");
		const phaseLine: readonly string[] =
			distilled.summary.phases.length > 0
				? [
						"",
						`Phases: ${phaseNames}`,
						ansi.dim(`  Primary tools: ${topTools.length > 0 ? topTools.join(", ") : "none"}`),
					]
				: [];

		const backtracksDescription: readonly string[] =
			distilled.backtracks.length > 0
				? (() => {
						const typeCounts = distilled.backtracks.reduce(
							(acc, bt) => ({
								...acc,
								[bt.type]: (acc[bt.type] ?? 0) + 1,
							}),
							{} as Record<string, number>,
						);
						const btTypeSummary = Object.entries(typeCounts)
							.map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`)
							.join(", ");
						const reasoningCount = distilled.reasoning.length;
						const dominantIntentValue =
							reasoningCount > 0
								? Object.entries(
										distilled.reasoning.reduce(
											(acc, r) => {
												const intent = r.intent_hint ?? "general";
												return { ...acc, [intent]: (acc[intent] ?? 0) + 1 };
											},
											{} as Record<string, number>,
										),
									).reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
								: undefined;
						return [
							"",
							ansi.bold("Quality:"),
							ansi.dim(
								`  ${distilled.backtracks.length} ${distilled.backtracks.length === 1 ? "backtrack" : "backtracks"} (${btTypeSummary})`,
							),
							ansi.dim(`  Failure rate: ${failRate}%`),
							...(reasoningCount > 0
								? [
										ansi.dim(
											`  ${reasoningCount} thinking ${reasoningCount === 1 ? "block" : "blocks"}, primarily ${dominantIntentValue}`,
										),
									]
								: []),
						];
					})()
				: [];

		const editChainDescription: readonly string[] = (() => {
			const chainsCount = km.edit_chains_count ?? 0;
			const abandoned = km.abandoned_edits ?? 0;
			if (chainsCount === 0) return [];
			const backtrackedFiles = distilled.edit_chains
				? distilled.edit_chains.chains.filter((c) => c.has_backtrack).length
				: 0;
			return [
				"",
				ansi.bold("Edit Activity:"),
				ansi.dim(
					`  ${chainsCount} ${chainsCount === 1 ? "file" : "files"} modified, ${abandoned} abandoned ${abandoned === 1 ? "attempt" : "attempts"}, ${backtrackedFiles} ${backtrackedFiles === 1 ? "backtrack" : "backtracks"}`,
				),
			];
		})();

		const teamDescription: readonly string[] = (() => {
			if (!distilled.team_metrics || agentCount === 0) return [];
			const workload = distilled.summary.agent_workload ?? [];
			const topContributors = workload
				.slice(0, 3)
				.map((a) => `${a.name} (${a.id.slice(0, 8)})`)
				.join(", ");
			const utilization =
				distilled.team_metrics.utilization_ratio !== undefined
					? `${(distilled.team_metrics.utilization_ratio * 100).toFixed(0)}%`
					: undefined;
			return [
				"",
				ansi.bold("Team:"),
				ansi.dim(
					`  ${agentCount} ${agentCount === 1 ? "agent" : "agents"} coordinating across ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`,
				),
				...(topContributors ? [ansi.dim(`  Top contributors: ${topContributors}`)] : []),
				...(utilization ? [ansi.dim(`  Average utilization: ${utilization}`)] : []),
			];
		})();

		const narrativeSection: readonly string[] = [
			...overviewLines,
			...phaseLine,
			...backtracksDescription,
			...editChainDescription,
			...teamDescription,
			"",
		];

		const metricsGrid = [
			`  ${ansi.bold("Duration:".padEnd(14))}${`${km.duration_human}${km.active_duration_human ? ` (${km.active_duration_human} active)` : ""}`.padEnd(33)}${ansi.bold("Model:".padEnd(13))}${model}`,
			`  ${ansi.bold("Tool calls:".padEnd(14))}${String(km.tool_calls).padEnd(33)}${ansi.bold("Failures:".padEnd(13))}${km.failures} (${failRate}%)`,
			`  ${ansi.bold("Files:".padEnd(14))}${String(km.files_modified).padEnd(33)}${ansi.bold("Backtracks:".padEnd(13))}${km.backtrack_count}`,
			`  ${ansi.bold("Agents:".padEnd(14))}${String(agentCount).padEnd(33)}${ansi.bold("Tasks:".padEnd(13))}${taskCount}`,
			"",
		];

		const phases =
			distilled.summary.phases.length > 0
				? [
						"",
						ansi.bold("Phases:"),
						...distilled.summary.phases.map((p, i) => {
							const dur = formatDuration(p.end_t - p.start_t);
							const topTools = p.tool_types.slice(0, 3).join(", ");
							return `  ${i + 1}. ${p.name.padEnd(18)}${dur.padEnd(8)} ${topTools}`;
						}),
					]
				: [];

		const topErrors =
			distilled.summary.top_errors && distilled.summary.top_errors.length > 0
				? [
						"",
						ansi.bold("Top Errors:"),
						...distilled.summary.top_errors.map((e) => {
							const sample = e.sample_message ? `  "${e.sample_message.slice(0, 50)}"` : "";
							return `  ${e.tool_name.padEnd(10)}${String(e.count).padStart(2)} failure${e.count !== 1 ? "s" : " "}${sample}`;
						}),
					]
				: [];

		const agentWorkload =
			distilled.summary.agent_workload && distilled.summary.agent_workload.length > 0
				? [
						"",
						ansi.bold("Agent Workload (top 5):"),
						...distilled.summary.agent_workload.slice(0, 5).map((a) => {
							const dur = formatDuration(a.duration_ms);
							const label = `${a.name} (${a.id})`;
							return `  ${label.padEnd(28)}${String(a.tool_calls).padStart(4)} calls  ${dur.padEnd(6)} ${String(a.files_modified).padStart(2)} files`;
						}),
					]
				: [];

		const allAgents = flattenAgents(distilled.agents ?? []);
		const agentNameLookup: ReadonlyMap<string, string> = new Map(
			allAgents
				.filter((a): a is AgentNode & { agent_name: string } => a.agent_name !== undefined)
				.map((a) => [a.session_id, a.agent_name] as const),
		);
		const resolveAgentName = (id: string): string => agentNameLookup.get(id) ?? id.slice(0, 19);

		const taskSummary =
			distilled.summary.task_summary && distilled.summary.task_summary.length > 0
				? [
						"",
						ansi.bold("Tasks (recent 10):"),
						...distilled.summary.task_summary
							.slice()
							.sort((a, b) => b.t - a.t)
							.slice(0, 10)
							.map((t) => {
								const subject = t.subject ? `: ${t.subject}` : "";
								return `  ${resolveAgentName(t.agent).padEnd(19)}completed${subject}`;
							}),
					]
				: [];

		const lifecycle = journey
			? [
					"",
					ansi.bold("Lifecycle:"),
					`  Type: ${journey.lifecycle_type}${journey.phases.length > 1 ? `  (${journey.phases.length} sessions)` : ""}`,
					...(journey.spec_ref ? [`  Spec: ${journey.spec_ref}`] : []),
				]
			: [];

		const driftSection = distilled?.plan_drift
			? (() => {
					const d = distilled.plan_drift;
					const scoreStr = `\x1b[${d.drift_score < 0.3 ? "32" : d.drift_score < 0.7 ? "33" : "31"}m${d.drift_score.toFixed(2)}\x1b[0m`;
					const shortUnexpected = d.unexpected_files.map((f) => f.split("/").pop() ?? f);
					const unexpectedLine =
						shortUnexpected.length > 0
							? [
									`  Unexpected: ${shortUnexpected.slice(0, 5).join(", ")}${shortUnexpected.length > 5 ? ` (+${shortUnexpected.length - 5})` : ""}`,
								]
							: [];
					const shortMissing = d.missing_files.map((f) => f.split("/").pop() ?? f);
					const missingLine =
						shortMissing.length > 0
							? [
									`  Missing: ${shortMissing.slice(0, 5).join(", ")}${shortMissing.length > 5 ? ` (+${shortMissing.length - 5})` : ""}`,
								]
							: [];
					return [
						"",
						ansi.bold("Plan Drift:"),
						`  Spec: ${d.spec_path}`,
						`  Score: ${scoreStr}    Expected: ${d.expected_files.length}    Actual: ${d.actual_files.length}`,
						...unexpectedLine,
						...missingLine,
					];
				})()
			: [];

		const decisionsSection =
			distilled.decisions.length > 0 ? formatDecisionsSection(distilled.decisions) : [];

		return [
			...header,
			...narrativeSection,
			...metricsGrid,
			...phases,
			...topErrors,
			...agentWorkload,
			...taskSummary,
			...lifecycle,
			...driftSection,
			...decisionsSection,
		];
	}

	return [
		...header,
		`Duration:    ${formatDuration(session.duration_ms)}`,
		`Events:      ${session.event_count}`,
		`Branch:      ${session.git_branch ?? "-"}`,
		"",
		ansi.dim("No distilled data. Run: clens distill <session-id>"),
	];
};

export const formatAgentRow = (
	agent: AgentNode,
	selected: boolean,
	width: number,
	labelWidth?: number,
): string => {
	const label = `${agent.agent_name ?? agent.agent_type} (${agent.session_id.slice(0, 8)})`;
	const maxLabelLen = labelWidth ?? Math.min(label.length, Math.floor(width * 0.35));
	const truncLabel =
		label.length > maxLabelLen ? `${label.slice(0, maxLabelLen - 1)}\u2026` : label;

	const dur = formatDuration(agent.duration_ms).padEnd(8);
	const tools = String(agent.tool_call_count).padEnd(8);
	const filesCount = agent.file_map
		? agent.file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length
		: 0;
	const files = String(filesCount).padEnd(8);
	const cost = agent.cost_estimate ? `$${agent.cost_estimate.estimated_cost_usd.toFixed(2)}` : "-";
	const row = `${truncLabel.padEnd(maxLabelLen + 2)}${dur}${tools}${files}${cost}`;
	const trimmed = row.slice(0, width);
	return selected ? ansi.inverse(trimmed.padEnd(width)) : trimmed;
};

export const formatAgentDetail = (agent: AgentNode): readonly string[] => {
	const header = [
		ansi.bold(`Agent: ${agent.agent_name ?? agent.agent_type} (${agent.session_id.slice(0, 8)})`),
		`Type: ${agent.agent_type}`,
		`Session ID: ${agent.session_id}`,
		...(agent.model ? [`Model: ${agent.model}`] : []),
		`Duration: ${formatDuration(agent.duration_ms)}`,
		"",
	];

	const taskPromptSection = agent.task_prompt
		? [
				ansi.bold("Task Prompt:"),
				...agent.task_prompt.split("\n").map((line: string) => `  ${line}`),
				"",
			]
		: [];

	const toolSection = (() => {
		const stats = agent.stats;
		if (!stats) return [];
		const totalCalls = stats.tool_call_count;
		return [
			ansi.bold("Tool Usage:"),
			...Object.entries(stats.tools_by_name)
				.slice()
				.sort((a, b) => b[1] - a[1])
				.map(([name, count]) => {
					const pct = totalCalls > 0 ? ((count / totalCalls) * 100).toFixed(1) : "0.0";
					return `  ${name.padEnd(20)} ${String(count).padStart(3)} (${pct}%)`;
				}),
			"",
		];
	})();

	const fileSection =
		agent.file_map && agent.file_map.files.length > 0
			? [
					ansi.bold("Files:"),
					...agent.file_map.files
						.filter((f) => f.reads > 0 || f.edits > 0)
						.map((f) => {
							const parts = [
								...(f.reads > 0 ? [`${f.reads}R`] : []),
								...(f.edits > 0 ? [`${f.edits}E`] : []),
								...(f.writes > 0 ? [`${f.writes}W`] : []),
							];
							return `  ${f.file_path.padEnd(35)} ${parts.join(" ")}`;
						}),
					"",
				]
			: [];

	const tokenSection = (() => {
		const usage = agent.stats?.token_usage;
		if (!usage) return [];
		const totalInput = usage.input_tokens + usage.cache_read_tokens;
		return [
			ansi.bold("Token Usage:"),
			`  Input: ${totalInput.toLocaleString()} total${usage.cache_read_tokens > 0 ? ` (${usage.cache_read_tokens.toLocaleString()} cached, ${usage.input_tokens.toLocaleString()} uncached)` : ""}`,
			`  Output: ${usage.output_tokens.toLocaleString()}`,
			...(usage.cache_creation_tokens > 0
				? [`  Cache creation: ${usage.cache_creation_tokens.toLocaleString()}`]
				: []),
			"",
		];
	})();

	const partnersSection =
		agent.communication_partners && agent.communication_partners.length > 0
			? [
					ansi.bold("Communication Partners:"),
					...agent.communication_partners.map((p) => {
						const types = p.msg_types.join(", ");
						return `  ${p.name.padEnd(18)} sent: ${String(p.sent_count).padStart(2)}  recv: ${String(p.received_count).padStart(2)}  [${types}]`;
					}),
					"",
				]
			: [];

	const messagesSection =
		agent.messages && agent.messages.length > 0
			? (() => {
					const recent = [...agent.messages].sort((a, b) => b.t - a.t).slice(0, 5);
					return [
						ansi.bold("Recent Messages:"),
						...recent.map((m) => {
							const time = new Date(m.t).toLocaleTimeString();
							const arrow = m.direction === "sent" ? "->" : "<-";
							const summary = m.summary ? `: ${m.summary}` : "";
							return `  ${ansi.dim(time)} ${arrow} ${m.partner.padEnd(14)} [${m.msg_type}]${summary}`;
						}),
						"",
					];
				})()
			: [];

	const taskSection =
		agent.task_events && agent.task_events.length > 0
			? [
					ansi.bold("Task Activity:"),
					...agent.task_events.map((te) => {
						const subject = te.subject ? `: ${te.subject}` : "";
						return `  ${te.action.padEnd(10)} ${te.task_id}${subject}`;
					}),
					"",
				]
			: [];

	const idleSection =
		agent.idle_periods && agent.idle_periods.length > 0
			? (() => {
					const count = agent.idle_periods.length;
					const recent = [...agent.idle_periods].sort((a, b) => b.t - a.t).slice(0, 3);
					return [
						ansi.bold(`Idle Periods: ${count}`),
						...recent.map((ip) => {
							const time = new Date(ip.t).toLocaleTimeString();
							return `  ${ansi.dim(time)} ${ip.teammate}`;
						}),
						"",
					];
				})()
			: [];

	const costSection = agent.cost_estimate
		? [ansi.bold("Cost:"), `  Total: $${agent.cost_estimate.estimated_cost_usd.toFixed(2)}`]
		: [];

	return [
		...header,
		...taskPromptSection,
		...toolSection,
		...tokenSection,
		...fileSection,
		...partnersSection,
		...messagesSection,
		...taskSection,
		...idleSection,
		...costSection,
	];
};

export const formatCommsTab = (
	distilled: DistilledSession,
	commsOffset: number,
	projectDir?: string,
): readonly string[] => {
	const lifetimes = distilled.agent_lifetimes ?? [];
	const sequence = distilled.comm_sequence ?? [];

	if (
		lifetimes.length === 0 &&
		sequence.length === 0 &&
		(!distilled.communication_graph || distilled.communication_graph.length === 0)
	) {
		return [
			ansi.dim("No communication data available."),
			"",
			ansi.dim("Re-run: clens distill --deep <session-id>"),
		];
	}

	const commGraphSection =
		distilled.communication_graph && distilled.communication_graph.length > 0
			? formatCommGraphSummary(distilled.communication_graph)
			: [];

	const agentNames: readonly string[] = [
		...new Set([
			...lifetimes.map((l) => `${l.agent_name ?? l.agent_type} (${l.agent_id.slice(0, 8)})`),
			...sequence.flatMap((s) => [s.from_name, s.to_name]),
		]),
	].sort();

	const lifetimeSection =
		lifetimes.length > 0
			? (() => {
					const minT = lifetimes.reduce((m, l) => Math.min(m, l.start_t), Infinity);
					const maxT = lifetimes.reduce((m, l) => Math.max(m, l.end_t), 0);
					const barWidth = 40;
					const labelLen = Math.min(
						28,
						Math.max(
							18,
							...lifetimes.map(
								(l) => `${l.agent_name ?? l.agent_type} (${l.agent_id.slice(0, 8)})`.length,
							),
						),
					);
					return [
						ansi.bold("Agent Lifetimes:"),
						"",
						...lifetimes.map((l) =>
							formatAgentLifetimeBar(l, minT, maxT, barWidth, agentNames, labelLen),
						),
						"",
					];
				})()
			: [];

	const messageSection =
		sequence.length > 0
			? (() => {
					const total = sequence.length;
					const offset = commsOffset;
					const visible = sequence.slice(offset, offset + 30);
					const endIdx = Math.min(offset + 30, total);
					const scrollIndicator = ansi.dim(`[${offset + 1}-${endIdx} of ${total}]`);
					return [
						`${ansi.bold("Messages:")}  ${scrollIndicator}`,
						ansi.dim("[↑↓] scroll"),
						"",
						...visible.map((entry) => formatSequenceEntry(entry, agentNames)),
					];
				})()
			: [];

	return [...commGraphSection, ...lifetimeSection, ...messageSection];
};

// --- Timeline collapsing ---

export interface CollapsedEntry {
	readonly entry: TimelineEntry;
	readonly count: number;
}

export const collapseConsecutive = (entries: readonly TimelineEntry[]): readonly CollapsedEntry[] =>
	entries.reduce<readonly CollapsedEntry[]>((acc, entry) => {
		const prev = acc[acc.length - 1];
		if (
			prev &&
			prev.entry.type === "tool_call" &&
			entry.type === "tool_call" &&
			prev.entry.tool_name === entry.tool_name &&
			prev.entry.agent_name === entry.agent_name
		) {
			return [...acc.slice(0, -1), { entry: prev.entry, count: prev.count + 1 }];
		}
		return [...acc, { entry, count: 1 }];
	}, []);

// --- Timeline formatting ---

const formatTimelineEntry = (e: TimelineEntry): string => {
	const time = new Date(e.t).toLocaleTimeString();
	const preview = e.content_preview ? `: ${e.content_preview.slice(0, 50)}` : "";
	return `  ${ansi.dim(time)} ${colorizeTimelineType(e)}${preview}`;
};

const formatCollapsedEntry = (c: CollapsedEntry): string => {
	const suffix = c.count > 1 ? ` ${ansi.dim(`(x${c.count})`)}` : "";
	return `${formatTimelineEntry(c.entry)}${suffix}`;
};

const formatSwimLaneEntry = (e: TimelineEntry, laneWidth: number): string => {
	const time = new Date(e.t).toLocaleTimeString();
	const rawLabel = e.agent_name
		? `${e.agent_name}${e.agent_id ? ` (${e.agent_id.slice(0, 8)})` : ""}`
		: e.agent_id
			? e.agent_id.slice(0, 8)
			: "";
	const agentLabel = rawLabel.slice(0, laneWidth).padEnd(laneWidth);
	const preview = e.content_preview ? `: ${e.content_preview.slice(0, 40)}` : "";
	return `  ${ansi.dim(time)} ${ansi.cyan(agentLabel)} ${colorizeTimelineType(e)}${preview}`;
};

const formatCollapsedSwimLaneEntry = (c: CollapsedEntry, laneWidth: number): string => {
	const suffix = c.count > 1 ? ` ${ansi.dim(`(x${c.count})`)}` : "";
	return `${formatSwimLaneEntry(c.entry, laneWidth)}${suffix}`;
};

export const formatTimelineTab = (
	timeline: readonly TimelineEntry[],
	offset: number,
	typeFilter?: TimelineEntry["type"],
): readonly string[] => {
	const filtered = typeFilter ? timeline.filter((e) => e.type === typeFilter) : timeline;
	const collapsed = collapseConsecutive(filtered);
	const total = collapsed.length;
	const visible = collapsed.slice(offset, offset + 30);
	const endIdx = Math.min(offset + 30, total);
	const scrollIndicator = ansi.dim(`[${offset + 1}-${endIdx} of ${total}]`);
	const filterIndicator = typeFilter ? ` filter: ${typeFilter}` : "";

	const uniqueAgents = [...new Set(filtered.flatMap((e) => (e.agent_name ? [e.agent_name] : [])))];
	const isMultiAgent = uniqueAgents.length > 1;

	const header = [
		`${ansi.bold("Timeline:")}  ${scrollIndicator}${filterIndicator}`,
		ansi.dim("[↑↓] scroll  [f] filter type"),
		"",
	];

	if (!isMultiAgent) {
		return [...header, ...visible.map(formatCollapsedEntry)];
	}

	const laneWidth = Math.min(
		16,
		uniqueAgents.reduce((max, name) => Math.max(max, name.length), 0),
	);

	return [...header, ...visible.map((c) => formatCollapsedSwimLaneEntry(c, laneWidth))];
};

// --- Render functions ---

const renderSessionList = (state: TuiState, rows: number, cols: number): string => {
	const header =
		ansi.bold("clens explorer") + ansi.dim("  [↑↓] navigate  [Enter] select  [q] quit");
	const colHeader = ansi.dim(
		`${"Name / ID".padEnd(32)}${"Started".padEnd(14)}${"Branch".padEnd(16)}${"Team".padEnd(12)}${"Type".padEnd(10)}${"D".padEnd(3)}${"Duration".padEnd(10)}${"Events".padEnd(8)}Status`,
	);
	const separator = ansi.dim("\u2500".repeat(Math.min(cols, 105)));

	const visibleRows = rows - 6;
	const startIdx = Math.max(0, state.selectedIndex - visibleRows + 1);
	const visible = state.sessions.slice(startIdx, startIdx + visibleRows);

	const sessionRows = visible.map((s, i) =>
		formatSessionRow(s, startIdx + i === state.selectedIndex, cols),
	);

	const footer = ansi.dim(`${state.sessions.length} session(s)`);

	return [header, "", colHeader, separator, ...sessionRows, "", footer].join("\n");
};

// --- Tab content renderers (pure) ---

const formatBacktracksTab = (distilled: DistilledSession): readonly string[] => {
	const bts = distilled.backtracks;
	if (bts.length === 0)
		return [ansi.bold("Backtracks:"), "", ansi.dim("None detected — clean session.")];

	const btTimeMs = bts.reduce((sum, bt) => sum + (bt.end_t - bt.start_t), 0);
	const timePercent =
		distilled.stats.duration_ms > 0
			? ((btTimeMs / distilled.stats.duration_ms) * 100).toFixed(1)
			: "0.0";
	const typeLabel = (type: string): string =>
		type === "failure_retry"
			? "failure retry"
			: type === "iteration_struggle"
				? "iteration struggle"
				: "debugging loop";

	return [
		ansi.bold(`Backtracks: ${bts.length}`),
		ansi.dim(`  ${timePercent}% of session time`),
		ansi.dim("[↑↓] scroll"),
		"",
		...bts.map((bt) => {
			const time = new Date(bt.start_t).toLocaleTimeString();
			const dur = formatDuration(bt.end_t - bt.start_t);
			const file = (bt.file_path ?? bt.tool_name).padEnd(30);
			const errorHint = bt.error_message ? `  ${ansi.dim(bt.error_message.slice(0, 40))}` : "";
			return `  ${ansi.dim(time)} ${file} ${typeLabel(bt.type).padEnd(18)} ${bt.attempts} attempts  ${dur}${errorHint}`;
		}),
	];
};

const formatReasoningTab = (distilled: DistilledSession): readonly string[] => {
	const reasoning = distilled.reasoning;
	if (reasoning.length === 0)
		return [
			ansi.bold("Reasoning:"),
			"",
			ansi.dim("No reasoning data. Run 'clens distill --deep' to extract."),
		];

	const byIntent = reasoning.reduce<Readonly<Record<string, number>>>((acc, r) => {
		const key = r.intent_hint ?? "general";
		return { ...acc, [key]: (acc[key] ?? 0) + 1 };
	}, {});

	return [
		ansi.bold(`Reasoning: ${reasoning.length} blocks`),
		ansi.dim("[↑↓] scroll"),
		"",
		ansi.dim("By intent:"),
		...Object.entries(byIntent)
			.sort((a, b) => b[1] - a[1])
			.map(([intent, count]) => `  ${intent.padEnd(20)} ${count}`),
		"",
		ansi.bold("All entries:"),
		...reasoning.map((r) => {
			const preview = r.thinking.slice(0, 60).replace(/\n/g, " ");
			const intent = r.intent_hint ?? "general";
			return `  [${intent}] ${preview}${r.thinking.length > 60 ? "..." : ""}`;
		}),
	];
};

const formatDriftTab = (distilled: DistilledSession): readonly string[] => {
	const drift = distilled.plan_drift;
	if (!drift)
		return [
			ansi.bold("Plan Drift:"),
			"",
			ansi.dim("No drift data. Run 'clens report drift' to analyze."),
		];

	const scoreColor =
		drift.drift_score < 0.3 ? "\x1b[32m" : drift.drift_score < 0.7 ? "\x1b[33m" : "\x1b[31m";

	return [
		ansi.bold("Plan Drift:"),
		ansi.dim("[↑↓] scroll"),
		"",
		`  Spec:       ${drift.spec_path}`,
		`  Score:      ${scoreColor}${drift.drift_score.toFixed(2)}\x1b[0m`,
		`  Expected:   ${drift.expected_files.length} files`,
		`  Actual:     ${drift.actual_files.length} files`,
		`  Unexpected: ${drift.unexpected_files.length}`,
		`  Missing:    ${drift.missing_files.length}`,
		...(drift.unexpected_files.length > 0
			? ["", ansi.bold("Unexpected files:"), ...drift.unexpected_files.map((f) => `  ${f}`)]
			: []),
		...(drift.missing_files.length > 0
			? ["", ansi.bold("Missing files:"), ...drift.missing_files.map((f) => `  ${f}`)]
			: []),
	];
};

const formatGraphTab = (distilled: DistilledSession): readonly string[] => {
	const graph = distilled.communication_graph;
	if (!graph || graph.length === 0)
		return [ansi.bold("Communication Graph:"), "", ansi.dim("No graph data available.")];

	const graphSection = formatCommGraphSummary(graph);

	const lifetimes = distilled.agent_lifetimes ?? [];
	const lifetimeSection =
		lifetimes.length > 0
			? (() => {
					const minT = lifetimes.reduce((m, l) => Math.min(m, l.start_t), Infinity);
					const maxT = lifetimes.reduce((m, l) => Math.max(m, l.end_t), 0);
					const agentNames = [
						...new Set(
							lifetimes.map((l) => `${l.agent_name ?? l.agent_type} (${l.agent_id.slice(0, 8)})`),
						),
					].sort();
					const labelLen = Math.min(28, Math.max(18, ...agentNames.map((n) => n.length)));
					return [
						"",
						ansi.bold("Agent Lifetimes:"),
						"",
						...lifetimes.map((l) =>
							formatAgentLifetimeBar(l, minT, maxT, 40, agentNames, labelLen),
						),
					];
				})()
			: [];

	return [...graphSection, ...lifetimeSection];
};

const formatDecisionDetail = (d: DecisionPoint): string => {
	switch (d.type) {
		case "timing_gap":
			return `${formatDuration(d.gap_ms)} gap (${d.classification})`;
		case "tool_pivot":
			return `${d.from_tool} -> ${d.to_tool}${d.after_failure ? " (after failure)" : ""}`;
		case "phase_boundary":
			return `phase ${d.phase_index + 1}: ${d.phase_name}`;
		case "agent_spawn":
			return `spawned ${d.agent_name} (${d.agent_type})`;
		case "task_delegation":
			return `delegated to ${d.agent_name}${d.subject ? `: ${d.subject}` : ""}`;
		case "task_completion":
			return `completed by ${d.agent_name}${d.subject ? `: ${d.subject}` : ""}`;
	}
};

const formatDecisionsTabFull = (decisions: readonly DecisionPoint[]): readonly string[] => {
	if (decisions.length === 0)
		return [ansi.bold("Decisions:"), "", ansi.dim("No decision points detected.")];

	const countByType = decisions.reduce<Readonly<Record<string, number>>>(
		(acc, d) => ({
			...acc,
			[d.type]: (acc[d.type] ?? 0) + 1,
		}),
		{},
	);

	const summaryParts = Object.entries(countByType)
		.map(([type, count]) => `${count} ${pluralize(type.replace(/_/g, " "), count)}`)
		.join(", ");

	const allDecisions = [...decisions]
		.sort((a, b) => b.t - a.t)
		.map((d) => {
			const time = new Date(d.t).toLocaleTimeString();
			return `  ${ansi.dim(time)} ${d.type.replace(/_/g, " ")}: ${formatDecisionDetail(d)}`;
		});

	return [
		ansi.bold(`Decision Points: ${summaryParts}`),
		ansi.dim("[↑↓] scroll"),
		"",
		...allDecisions,
	];
};

const renderSessionDetail = (state: TuiState, rows: number, cols: number): string => {
	const session = state.sessions[state.selectedIndex];
	if (!session) return "No session selected.";

	const isSingleAgent = (session.agent_count ?? 0) === 0;
	const tabBar = state.visibleTabs
		.map((t) => (t === state.detailTab ? ansi.inverse(` ${t} `) : ansi.dim(` ${t} `)))
		.join(" ");

	// Prefer distilled session_name over summary session_name
	const sessionName = state.selectedSession?.session_name ?? session.session_name;
	const nameLabel = sessionName ? `  ${ansi.bold(sessionName)}` : "";

	const sessionTypeHeader = isSingleAgent
		? ansi.dim("Single-agent session")
		: ansi.dim(`Multi-agent session (${session.agent_count} agents)`);

	const nav = ansi.dim("[Tab] switch tab  [Esc] back  [q] quit");
	const header = `${ansi.bold("Session Detail")}${nameLabel}  ${sessionTypeHeader}  ${nav}`;

	const content: readonly string[] = (() => {
		switch (state.detailTab) {
			case "overview":
				return formatOverviewTab(session, state.selectedSession, state.selectedJourney, cols);
			case "backtracks": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatBacktracksTab(state.selectedSession);
			}
			case "decisions": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatDecisionsTabFull(state.selectedSession.decisions);
			}
			case "reasoning": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatReasoningTab(state.selectedSession);
			}
			case "edits": {
				if (!state.selectedSession?.file_map) {
					return [ansi.dim("No file data available.")];
				}
				const editChains = state.selectedSession.edit_chains?.chains ?? [];
				const editChainMap: ReadonlyMap<string, EditChain> = new Map(
					editChains.map((c) => [c.file_path, c]),
				);
				const allAgents = flattenAgents(state.selectedSession.agents ?? []);
				const agentNames: readonly string[] = [
					...new Set(
						allAgents
							.filter((a): a is AgentNode & { agent_name: string } => a.agent_name !== undefined)
							.map((a) => sanitizeAgentName(a.agent_name, a.session_id)),
					),
				];

				// Detail view for a selected file
				if (state.editSelectedFile) {
					const chain = editChainMap.get(state.editSelectedFile);
					if (!chain) return [ansi.dim(`No edit chain for ${state.editSelectedFile}`)];

					// Check for diff attribution
					const diffAttr = state.selectedSession?.edit_chains?.diff_attribution?.find(
						(d) => d.file_path === state.editSelectedFile,
					);

					const diffSection = diffAttr
						? [
								...formatAttributedDiff(diffAttr, agentNames, cols),
								"",
								ansi.dim("─".repeat(60)),
								"",
							]
						: [];

					return [
						ansi.dim("[Esc] back  [↑↓] scroll"),
						"",
						...diffSection,
						ansi.bold("Edit History:"),
						"",
						...formatEditDetail(chain, agentNames),
					];
				}

				// File list view
				const files = getEditsFileList(state);
				const filterLabel = state.agentFilter ? ` (agent: ${state.agentFilter})` : "";
				const groupingLabel = state.editGrouping === "agent" ? "agent" : "directory";
				const hasAgents = state.selectedSession.agents && state.selectedSession.agents.length > 0;

				const agentMap: ReadonlyMap<string, string> = new Map(
					editChains
						.filter((c): c is EditChain & { agent_name: string } => c.agent_name !== undefined)
						.map((c) => [c.file_path, sanitizeAgentName(c.agent_name, c.agent_name)] as const),
				);

				const fileListContent: readonly string[] =
					state.editGrouping === "agent" && editChains.length > 0
						? groupFilesByAgent(
								files,
								state.projectDir,
								editChains,
								agentNames,
								editChainMap,
								state.editFileIndex,
							)
						: groupFilesByDirectory(
								files,
								state.projectDir,
								editChainMap,
								agentMap,
								agentNames,
								state.editFileIndex,
							);

				const gitDiffSection =
					state.selectedSession.git_diff && state.selectedSession.git_diff.hunks.length > 0
						? formatGitDiffSection(state.selectedSession.git_diff)
						: [];

				const helpParts = [
					"[up/down] select",
					"[Enter] detail",
					...(hasAgents ? ["[a] filter agent"] : []),
					...(editChains.length > 0 ? ["[g] toggle grouping"] : []),
				];

				return [
					ansi.bold(`Files Modified${filterLabel}:`),
					ansi.dim(`Group by: ${groupingLabel}  ${helpParts.join("  ")}`),
					"",
					...fileListContent,
					...gitDiffSection,
				];
			}
			case "timeline": {
				if (!state.selectedSession?.timeline) {
					return [ansi.dim("No timeline data available.")];
				}
				return formatTimelineTab(
					state.selectedSession.timeline,
					state.timelineOffset,
					state.timelineTypeFilter,
				);
			}
			case "drift": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatDriftTab(state.selectedSession);
			}
			case "agents": {
				if (!state.selectedSession?.agents || state.selectedSession.agents.length === 0) {
					return [ansi.dim("No agent data available.")];
				}
				const allAgents = flattenAgents(state.selectedSession.agents);
				const maxLabelLen = Math.min(
					Math.floor(cols * 0.35),
					Math.max(
						10,
						...allAgents.map(
							(a) => `${a.agent_name ?? a.agent_type} (${a.session_id.slice(0, 8)})`.length,
						),
					),
				);
				const agentHeader = ansi.dim(
					`${"Agent".padEnd(maxLabelLen + 2)}${"Dur".padEnd(8)}${"Calls".padEnd(8)}${"Files".padEnd(8)}Cost`,
				);
				const agentRows = allAgents.map((a, i) =>
					formatAgentRow(a, i === state.agentIndex, cols, maxLabelLen),
				);
				return [ansi.dim("[↑↓] navigate  [Enter] drill into agent"), "", agentHeader, ...agentRows];
			}
			case "messages": {
				if (!state.selectedSession) {
					return [ansi.dim("No communication data available.")];
				}
				return formatCommsTab(state.selectedSession, state.commsOffset, state.projectDir);
			}
			case "graph": {
				if (!state.selectedSession) return [ansi.dim("No graph data available.")];
				return formatGraphTab(state.selectedSession);
			}
		}
	})();

	// Apply generic content scrolling for tabs that use contentOffset
	const availableRows = rows - 5;
	const maxOffset = Math.max(0, content.length - availableRows);
	const clampedOffset = Math.min(state.contentOffset, maxOffset);
	const useContentScroll =
		CONTENT_SCROLL_TABS.has(state.detailTab) ||
		(state.detailTab === "edits" && state.editSelectedFile !== undefined);
	const scrolledContent = useContentScroll
		? content.slice(clampedOffset, clampedOffset + availableRows)
		: content;

	const scrollIndicator =
		useContentScroll && content.length > availableRows
			? [
					ansi.dim(
						`[${clampedOffset + 1}-${Math.min(clampedOffset + availableRows, content.length)} of ${content.length}] [↑↓] scroll`,
					),
				]
			: [];

	return [header, "", tabBar, "", ...scrolledContent, ...scrollIndicator].join("\n");
};

const renderAgentDetail = (state: TuiState, rows: number, _cols: number): string => {
	if (!state.selectedAgent) return "No agent selected.";
	const nav = ansi.dim("[Esc] back  [↑↓] scroll  [q] quit");
	const content = formatAgentDetail(state.selectedAgent);
	const availableRows = rows - 4;
	const maxOffset = Math.max(0, content.length - availableRows);
	const clampedOffset = Math.min(state.agentDetailOffset, maxOffset);
	const scrolledContent = content.slice(clampedOffset, clampedOffset + availableRows);
	const scrollIndicator =
		content.length > availableRows
			? [
					ansi.dim(
						`[${clampedOffset + 1}-${Math.min(clampedOffset + availableRows, content.length)} of ${content.length}] [↑↓] scroll`,
					),
				]
			: [];
	return [nav, "", ...scrolledContent, ...scrollIndicator].join("\n");
};

export const render = (state: TuiState, rows: number, cols: number): string => {
	switch (state.view) {
		case "session_list":
			return renderSessionList(state, rows, cols);
		case "session_detail":
			return renderSessionDetail(state, rows, cols);
		case "agent_detail":
			return renderAgentDetail(state, rows, cols);
	}
};

// --- Key parsing ---

export const parseKey = (data: Buffer): string | undefined => {
	const str = data.toString();
	if (str === "\x1b" || str === "\x1b\x1b") return "escape";
	if (str === "\r" || str === "\n") return "enter";
	if (str === "\x7f" || str === "\b") return "backspace";
	if (str === "\t") return "tab";
	if (str === "\x1b[Z") return "shift_tab";
	if (str === "q") return "q";
	if (str === "f") return "f";
	if (str === "a") return "a";
	if (str === "g") return "g";
	if (str === "\x1b[A") return "up";
	if (str === "\x1b[B") return "down";
	if (str === "\x1b[C") return "right";
	if (str === "\x1b[D") return "left";
	return undefined;
};

// --- Main interactive loop (I/O entry point) ---
// This function is the sole I/O boundary for the TUI. It uses process.stdout.write
// and process.stdin directly because the interactive terminal loop is inherently I/O-bound.
// All rendering and state transition logic above is pure and testable.
// Called exclusively from cli.ts.

export const startTui = (projectDir: string): void => {
	const initialState = createInitialState(projectDir);

	if (initialState.sessions.length === 0) {
		process.stdout.write("No sessions found. Run some Claude Code sessions first.\n");
		return;
	}

	process.stdin.setRawMode(true);
	// Enter alternate screen buffer (like vim/less/top) to isolate TUI from terminal scrollback
	process.stdout.write(ansi.enterAltScreen + ansi.hideCursor);

	// MUTATION EXCEPTION: The interactive event loop requires mutable state to track
	// the current TUI state across async stdin data events. The state transitions
	// themselves (handleKey) are pure -- only the binding of new state to `state.current`
	// is mutable. This is an inherent requirement of event-driven terminal I/O.
	const state = { current: initialState };
	// MUTATION EXCEPTION: The `running` flag is an I/O boundary signal that breaks
	// the async stdin stream loop on cleanup. It cannot be folded into the pure state
	// because it controls the imperative I/O loop lifecycle, not the TUI view state.
	let running = true;

	const draw = () => {
		const rows = process.stdout.rows ?? 24;
		const cols = process.stdout.columns ?? 80;
		const output = render(state.current, rows, cols);
		process.stdout.write(ansi.clearScreen + output);
	};

	const cleanup = () => {
		running = false;
		process.stdout.write(ansi.showCursor + ansi.leaveAltScreen);
		process.stdin.setRawMode(false);
	};

	process.on("SIGINT", cleanup);

	draw();

	// Use Bun.stdin.stream() instead of process.stdin.on("data") —
	// the Node.js EventEmitter API on stdin does not fire in Bun.
	// LOOP EXCEPTION: The `for await...of` over Bun.stdin.stream() is the only way
	// to consume an async ReadableStream in Bun. There is no FP-friendly alternative
	// for async stream iteration at the I/O boundary. All logic inside is dispatch-only.
	(async () => {
		for await (const chunk of Bun.stdin.stream()) {
			if (!running) break;
			const key = parseKey(Buffer.from(chunk));
			if (!key) continue;

			const result = handleKey(state.current, key);
			if (result === "quit") {
				cleanup();
				return;
			}
			state.current = result;
			draw();
		}
	})();
};

import type {
	ActiveDurationResult,
	AgentNode,
	BacktrackResult,
	DistilledSummary,
	EditChainsResult,
	FileMapEntry,
	PhaseInfo,
	StatsResult,
	StoredEvent,
	TeamMetrics,
	TranscriptReasoning,
} from "../types";
import { buildTeamSentence, extractAgentWorkload, extractTopErrors } from "./summary-team";

// --- Duration formatting ---

const formatDurationHuman = (ms: number): string => {
	if (ms < 1000) return `${ms}ms`;
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	return hours > 0
		? `${hours}h ${minutes}m ${seconds}s`
		: minutes > 0
			? `${minutes}m ${seconds}s`
			: `${seconds}s`;
};

// --- Top N tools extraction ---

const topNTools = (toolsByName: Record<string, number>, n: number): string[] =>
	Object.entries(toolsByName)
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([name]) => name);

// --- Backtrack type summary ---

const summarizeBacktrackTypes = (backtracks: readonly BacktrackResult[]): string => {
	const typeCounts = backtracks.reduce(
		(acc, bt) => ({
			...acc,
			[bt.type]: (acc[bt.type] ?? 0) + 1,
		}),
		{} as Record<string, number>,
	);
	return Object.entries(typeCounts)
		.map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`)
		.join(", ");
};

// --- Dominant intent from reasoning ---

const dominantIntent = (reasoning: readonly TranscriptReasoning[]): string => {
	const intentCounts = reasoning.reduce(
		(acc, r) => {
			const intent = r.intent_hint ?? "general";
			return { ...acc, [intent]: (acc[intent] ?? 0) + 1 };
		},
		{} as Record<string, number>,
	);
	const entries = Object.entries(intentCounts);
	return entries.length === 0
		? "general"
		: entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best), entries[0])[0];
};

// --- Main extractor types ---

export interface SummaryOptions {
	readonly stats: StatsResult;
	readonly backtracks: readonly BacktrackResult[];
	readonly phases: readonly PhaseInfo[];
	readonly file_map: readonly FileMapEntry[];
	readonly reasoning: readonly TranscriptReasoning[];
	readonly team_metrics?: TeamMetrics;
	readonly activeDuration?: ActiveDurationResult;
	readonly agents?: readonly AgentNode[];
	readonly events?: readonly StoredEvent[];
	readonly editChains?: EditChainsResult;
}

// --- Narrative generation ---

const buildNarrative = (opts: SummaryOptions): string => {
	const { stats, backtracks, phases, file_map, reasoning, team_metrics, activeDuration, agents, editChains } = opts;
	const modelName = stats.model ?? "unknown model";
	const duration = formatDurationHuman(stats.duration_ms);
	const top3 = topNTools(stats.tools_by_name, 3);
	const filesModified = file_map.filter((f) => f.edits > 0 || f.writes > 0).length;

	const activeTag =
		activeDuration && activeDuration.active_ms < stats.duration_ms
			? ` (${formatDurationHuman(activeDuration.active_ms)} active)`
			: "";
	const sentence1 = `A ${duration} session${activeTag} using ${modelName} with ${stats.tool_call_count} tool calls.`;

	const phaseNames = phases.map((p) => p.name).join(", ");
	const sentence2 =
		phases.length > 0
			? ` The session had ${phases.length} phase${phases.length === 1 ? "" : "s"}: ${phaseNames}.`
			: "";

	const toolList = top3.length > 0 ? top3.join(", ") : "none";
	const sentence3 = ` Primary tools: ${toolList}. ${filesModified} file${filesModified === 1 ? "" : "s"} modified.`;

	const sentence4 =
		backtracks.length > 0
			? ` Encountered ${backtracks.length} backtrack${backtracks.length === 1 ? "" : "s"} (${summarizeBacktrackTypes(backtracks)}). Failure rate: ${(stats.failure_rate * 100).toFixed(1)}%.`
			: "";

	const sentence5 =
		reasoning.length > 0
			? ` ${reasoning.length} thinking block${reasoning.length === 1 ? "" : "s"} captured, primarily ${dominantIntent(reasoning)}.`
			: "";

	const sentence_edit_chains = (() => {
		if (!editChains || editChains.chains.length === 0) return "";
		const totalAbandoned = editChains.chains.reduce(
			(sum, c) => sum + c.abandoned_edit_ids.length,
			0,
		);
		const backtrackedFiles = editChains.chains.filter((c) => c.has_backtrack).length;
		return totalAbandoned > 0 || backtrackedFiles > 0
			? ` ${editChains.chains.length} files were modified with ${totalAbandoned} abandoned attempt${totalAbandoned === 1 ? "" : "s"} across ${backtrackedFiles} backtrack${backtrackedFiles === 1 ? "" : "s"}.`
			: "";
	})();

	const sentence6 =
		team_metrics !== undefined && team_metrics.agent_count > 0
			? buildTeamSentence(team_metrics, agents, stats)
			: "";

	return `${sentence1}${sentence2}${sentence3}${sentence4}${sentence5}${sentence_edit_chains}${sentence6}`;
};

// --- Main extractor ---

export const extractSummary = (opts: SummaryOptions): DistilledSummary => {
	const { stats, backtracks, phases, file_map, reasoning, team_metrics, activeDuration, agents, events, editChains } = opts;
	const filesModified = file_map.filter((f) => f.edits > 0 || f.writes > 0).length;

	const topErrors = extractTopErrors(stats, events);
	const taskSummary = team_metrics?.tasks;
	const agentWorkload = agents && agents.length > 0 ? extractAgentWorkload(agents) : undefined;

	return {
		narrative: buildNarrative(opts),
		phases: [...phases],
		key_metrics: {
			duration_human: formatDurationHuman(stats.duration_ms),
			tool_calls: stats.tool_call_count,
			failures: stats.failure_count,
			files_modified: filesModified,
			backtrack_count: backtracks.length,
			...(activeDuration
				? {
						active_duration_ms: activeDuration.active_ms,
						active_duration_human: formatDurationHuman(activeDuration.active_ms),
					}
				: {}),
			...(editChains
				? {
						abandoned_edits: editChains.chains.reduce(
							(sum, c) => sum + c.abandoned_edit_ids.length,
							0,
						),
						edit_chains_count: editChains.chains.length,
					}
				: {}),
		},
		...(topErrors.length > 0 ? { top_errors: topErrors } : {}),
		...(taskSummary && taskSummary.length > 0 ? { task_summary: taskSummary } : {}),
		...(agentWorkload ? { agent_workload: agentWorkload } : {}),
	};
};

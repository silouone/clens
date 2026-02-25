import type {
	AgentNode,
	AgentStats,
	AggregatedTeamData,
	BacktrackResult,
	CostEstimate,
	EditChainsResult,
	FileDiffAttribution,
	FileMapEntry,
	FileMapResult,
	StatsResult,
	TranscriptReasoning,
} from "../types";
import { flattenAgents, sanitizeAgentName } from "../utils";

export interface AggregateTeamInput {
	readonly parentStats: StatsResult;
	readonly parentFileMap: FileMapResult;
	readonly parentEditChains: EditChainsResult;
	readonly parentBacktracks: readonly BacktrackResult[];
	readonly parentReasoning: readonly TranscriptReasoning[];
	readonly parentCost: CostEstimate | undefined;
	readonly agents: readonly AgentNode[];
}

// --- mergeFileMaps ---

/** Group by file_path, sum reads/edits/writes/errors, concat tool_use_ids. */
export const mergeFileMaps = (maps: readonly FileMapResult[]): FileMapResult => {
	const allFiles = maps.flatMap((m) => m.files);

	const merged = allFiles.reduce<Readonly<Record<string, FileMapEntry>>>((acc, entry) => {
		const existing = acc[entry.file_path];
		return {
			...acc,
			[entry.file_path]: existing
				? {
						file_path: entry.file_path,
						reads: existing.reads + entry.reads,
						edits: existing.edits + entry.edits,
						writes: existing.writes + entry.writes,
						errors: existing.errors + entry.errors,
						tool_use_ids: [...existing.tool_use_ids, ...entry.tool_use_ids],
						...(existing.source !== undefined || entry.source !== undefined
							? { source: existing.source ?? entry.source }
							: {}),
					}
				: entry,
		};
	}, {});

	const files = Object.values(merged);

	return { files };
};

// --- mergeStats ---

/** Sum tool_call_count, failure_count, union unique_files, merge tools_by_name. */
export const mergeStats = (
	parentStats: StatsResult,
	agentStats: readonly AgentStats[],
): StatsResult => {
	const totalToolCallCount = agentStats.reduce(
		(acc, s) => acc + s.tool_call_count,
		parentStats.tool_call_count,
	);

	const totalFailureCount = agentStats.reduce(
		(acc, s) => acc + s.failure_count,
		parentStats.failure_count,
	);

	const uniqueFilesSet = new Set([
		...parentStats.unique_files,
		...agentStats.flatMap((s) => s.unique_files),
	]);

	const mergedToolsByName = agentStats.reduce<Record<string, number>>(
		(acc, s) =>
			Object.entries(s.tools_by_name).reduce<Record<string, number>>(
				(inner, [name, count]) => ({
					...inner,
					[name]: (inner[name] ?? 0) + count,
				}),
				acc,
			),
		{ ...parentStats.tools_by_name },
	);

	return {
		...parentStats,
		tool_call_count: totalToolCallCount,
		failure_count: totalFailureCount,
		failure_rate: totalToolCallCount > 0 ? totalFailureCount / totalToolCallCount : 0,
		unique_files: Array.from(uniqueFilesSet),
		tools_by_name: mergedToolsByName,
	};
};

// --- mergeEditChains ---

/** Collect all chains, tag each agent chain with agent_name. Keep separate chains per agent-file pair. */
export const mergeEditChains = (
	parentChains: EditChainsResult,
	agentChains: readonly { readonly agentName: string; readonly chains: EditChainsResult }[],
): EditChainsResult => {
	const taggedAgentChains = agentChains.flatMap(({ agentName, chains: result }) =>
		result.chains.map((chain) => ({
			...chain,
			agent_name: agentName,
		})),
	);

	// Merge diff attributions: collect all, deduplicate by file_path (keep entry with more lines)
	const allDiffAttrs: readonly FileDiffAttribution[] = [
		...(parentChains.diff_attribution ?? []),
		...agentChains.flatMap(({ chains: result }) => result.diff_attribution ?? []),
	];

	const mergedDiffAttrs = allDiffAttrs.reduce<readonly FileDiffAttribution[]>((acc, attr) => {
		const existingIdx = acc.findIndex((a) => a.file_path === attr.file_path);
		if (existingIdx === -1) return [...acc, attr];
		const existing = acc[existingIdx];
		if (attr.lines.length > existing.lines.length) {
			return [...acc.slice(0, existingIdx), attr, ...acc.slice(existingIdx + 1)];
		}
		return acc;
	}, []);

	return {
		chains: [...parentChains.chains, ...taggedAgentChains],
		net_changes: parentChains.net_changes,
		...(mergedDiffAttrs.length > 0 ? { diff_attribution: mergedDiffAttrs } : {}),
	};
};

// --- mergeBacktracks ---

/** Compute overlap ratio: intersection / min(length_a, length_b). */
const toolUseIdOverlap = (idsA: readonly string[], idsB: readonly string[]): number => {
	if (idsA.length === 0 || idsB.length === 0) return 0;
	const setB = new Set(idsB);
	const intersectionSize = idsA.filter((id) => setB.has(id)).length;
	return intersectionSize / Math.min(idsA.length, idsB.length);
};

/** Deduplicate backtracks where type+file_path match and tool_use_ids overlap ≥ 50%. Keep entry with more tool_use_ids. */
const deduplicateBacktracks = (sorted: readonly BacktrackResult[]): readonly BacktrackResult[] =>
	sorted.reduce<readonly BacktrackResult[]>((acc, entry) => {
		const duplicateIndex = acc.findIndex(
			(existing) =>
				existing.type === entry.type &&
				existing.file_path === entry.file_path &&
				toolUseIdOverlap(existing.tool_use_ids, entry.tool_use_ids) >= 0.5,
		);

		if (duplicateIndex === -1) return [...acc, entry];

		// Keep the one with more tool_use_ids, or the existing one if equal
		const existing = acc[duplicateIndex];
		if (entry.tool_use_ids.length > existing.tool_use_ids.length) {
			return [...acc.slice(0, duplicateIndex), entry, ...acc.slice(duplicateIndex + 1)];
		}
		return acc;
	}, []);

/** Flatten all backtrack arrays, sort by start_t, and deduplicate overlapping entries. */
export const mergeBacktracks = (
	parentBacktracks: readonly BacktrackResult[],
	agentBacktracks: readonly (readonly BacktrackResult[])[],
): readonly BacktrackResult[] => {
	const sorted = [...parentBacktracks, ...agentBacktracks.flatMap((b) => b)].sort(
		(a, b) => a.start_t - b.start_t,
	);
	return deduplicateBacktracks(sorted);
};

// --- mergeCostEstimates ---

/** Sum estimated_input_tokens, estimated_output_tokens, estimated_cost_usd, and cache tokens. Use parent's model or first available. */
export const mergeCostEstimates = (
	parentCost: CostEstimate | undefined,
	agentCosts: readonly (CostEstimate | undefined)[],
): CostEstimate | undefined => {
	const allCosts = [parentCost, ...agentCosts].filter((c): c is CostEstimate => c !== undefined);

	if (allCosts.length === 0) return undefined;

	const model = parentCost?.model ?? allCosts[0].model;

	const totalInputTokens = allCosts.reduce((acc, c) => acc + c.estimated_input_tokens, 0);
	const totalOutputTokens = allCosts.reduce((acc, c) => acc + c.estimated_output_tokens, 0);
	const totalCostUsd = allCosts.reduce((acc, c) => acc + c.estimated_cost_usd, 0);
	const totalCacheRead = allCosts.reduce((acc, c) => acc + (c.cache_read_tokens ?? 0), 0);
	const totalCacheCreation = allCosts.reduce((acc, c) => acc + (c.cache_creation_tokens ?? 0), 0);

	return {
		model,
		estimated_input_tokens: totalInputTokens,
		estimated_output_tokens: totalOutputTokens,
		estimated_cost_usd: Math.round(totalCostUsd * 10000) / 10000,
		...(totalCacheRead > 0 ? { cache_read_tokens: totalCacheRead } : {}),
		...(totalCacheCreation > 0 ? { cache_creation_tokens: totalCacheCreation } : {}),
	};
};

// --- aggregateTeamData ---

/** Calls flattenAgents, then each merge function. Returns complete AggregatedTeamData. */
export const aggregateTeamData = ({
	parentStats,
	parentFileMap,
	parentEditChains,
	parentBacktracks,
	parentReasoning,
	parentCost,
	agents,
}: AggregateTeamInput): AggregatedTeamData => {
	const allAgents = flattenAgents(agents);

	const agentStatsEntries = allAgents.flatMap((a) => (a.stats ? [a.stats] : []));

	const agentFileMaps = allAgents.flatMap((a) => (a.file_map ? [a.file_map] : []));

	const agentEditChainEntries = allAgents.flatMap((a) =>
		a.edit_chains
			? [
					{
						agentName: sanitizeAgentName(a.agent_name ?? a.agent_type, a.session_id),
						chains: a.edit_chains,
					},
				]
			: [],
	);

	const agentBacktrackEntries = allAgents.flatMap((a) => (a.backtracks ? [a.backtracks] : []));

	const agentReasoningEntries = allAgents.flatMap((a) => (a.reasoning ? a.reasoning : []));

	const agentCostEntries = allAgents.map((a) => a.cost_estimate);

	const stats = mergeStats(parentStats, agentStatsEntries);
	const file_map = mergeFileMaps([parentFileMap, ...agentFileMaps]);
	const edit_chains = mergeEditChains(parentEditChains, agentEditChainEntries);
	const backtracks = mergeBacktracks(parentBacktracks, agentBacktrackEntries);
	const reasoning = [...parentReasoning, ...agentReasoningEntries];
	const cost_estimate = mergeCostEstimates(parentCost, agentCostEntries);

	return {
		stats,
		file_map,
		edit_chains,
		backtracks,
		reasoning,
		...(cost_estimate !== undefined ? { cost_estimate } : {}),
	};
};

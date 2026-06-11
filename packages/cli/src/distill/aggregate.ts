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
	TokenUsage,
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

/**
 * Merge agent-only dimensions onto the parent stats.
 *
 * The parent JSONL stream records EVERY tool call in the session — subagent tool
 * calls land in the same parent stream as PreToolUse/PostToolUseFailure events, so
 * `parentStats` already counts them. Per-agent stats are re-derived from each
 * subagent transcript, i.e. the SAME calls a second time. Re-adding agent
 * tool/failure/per-tool counts therefore double-counts (bug B4: 664 vs raw 336,
 * failures 25 vs 11). Parent counts computed over the full stream are authoritative
 * for the session, so tool_call_count, failure_count, failure_rate and
 * tools_by_name are taken from the parent unchanged.
 *
 * Agent-only dimensions are still aggregated:
 *  - unique_files: unioned (a harmless superset of the parent set; parent tool
 *    events already carry file paths, so this rarely adds anything but never
 *    double-counts since it is a set union, not a sum).
 *  - token_usage: summed. Parent hook events carry no token usage; per-turn token
 *    counts only exist in the per-agent transcripts, so this is the one dimension
 *    that genuinely requires agent contributions.
 */
export const mergeStats = (
	parentStats: StatsResult,
	agentStats: readonly AgentStats[],
): StatsResult => {
	const uniqueFilesSet = new Set([
		...parentStats.unique_files,
		...agentStats.flatMap((s) => s.unique_files),
	]);

	// Sum token_usage from parent + agents (parent hook events usually lack usage)
	const allTokenUsages = [
		parentStats.token_usage,
		...agentStats.map((s) => s.token_usage),
	].filter((u): u is TokenUsage => u !== undefined);

	const mergedTokenUsage: TokenUsage | undefined =
		allTokenUsages.length > 0
			? allTokenUsages.reduce<TokenUsage>(
					(acc, u) => ({
						input_tokens: acc.input_tokens + u.input_tokens,
						output_tokens: acc.output_tokens + u.output_tokens,
						cache_read_tokens: acc.cache_read_tokens + u.cache_read_tokens,
						cache_creation_tokens: acc.cache_creation_tokens + u.cache_creation_tokens,
					}),
					{ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
				)
			: undefined;

	return {
		...parentStats,
		// tool_call_count, failure_count, failure_rate, tools_by_name: authoritative
		// from the parent stream — NOT re-added from per-agent stats (would double-count).
		unique_files: Array.from(uniqueFilesSet),
		...(mergedTokenUsage ? { token_usage: mergedTokenUsage } : {}),
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
	const isEstimated = allCosts.some((c) => c.is_estimated);

	return {
		model,
		estimated_input_tokens: totalInputTokens,
		estimated_output_tokens: totalOutputTokens,
		estimated_cost_usd: Math.round(totalCostUsd * 10000) / 10000,
		...(totalCacheRead > 0 ? { cache_read_tokens: totalCacheRead } : {}),
		...(totalCacheCreation > 0 ? { cache_creation_tokens: totalCacheCreation } : {}),
		is_estimated: isEstimated,
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

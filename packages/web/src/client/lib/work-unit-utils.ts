import type { DistilledSession, BacktrackResult, FileMapEntry, TimelineEntry, CostEstimate } from "../../shared/types";
import type { WorkUnitDetailSession } from "./stores";

// ── Aggregation utilities for cross-session work unit analysis ──────

/** Extract all distilled sessions from a work unit detail response. */
export const distilledSessions = (sessions: readonly WorkUnitDetailSession[]): readonly DistilledSession[] =>
	sessions.flatMap((s) => (s.distilled ? [s.distilled] : []));

/** Aggregate backtracks across all sessions. */
export const aggregateBacktracks = (sessions: readonly DistilledSession[]): readonly BacktrackResult[] =>
	sessions.flatMap((s) => s.backtracks);

/** Aggregate file map entries across sessions (union by file_path, sum edits). */
export const aggregateFileMap = (sessions: readonly DistilledSession[]): readonly FileMapEntry[] => {
	const allFiles = sessions.flatMap((s) => s.file_map.files);
	const byPath = new Map<string, FileMapEntry>();
	allFiles.forEach((file) => {
		const existing = byPath.get(file.file_path);
		byPath.set(file.file_path, existing
			? { ...existing, reads: existing.reads + file.reads, writes: existing.writes + file.writes, edits: existing.edits + file.edits }
			: file,
		);
	});
	return [...byPath.values()];
};

/** Aggregate timeline entries across sessions, sorted by timestamp. */
export const aggregateTimeline = (sessions: readonly DistilledSession[]): readonly TimelineEntry[] =>
	sessions
		.flatMap((s) => s.timeline ?? [])
		.sort((a, b) => a.t - b.t);

/** Aggregate costs across sessions. */
export const aggregateCosts = (sessions: readonly DistilledSession[]): CostEstimate | undefined => {
	const estimates = sessions.flatMap((s) => (s.cost_estimate ? [s.cost_estimate] : []));
	if (estimates.length === 0) return undefined;
	return {
		model: estimates[0].model,
		estimated_input_tokens: estimates.reduce((sum, e) => sum + e.estimated_input_tokens, 0),
		estimated_output_tokens: estimates.reduce((sum, e) => sum + e.estimated_output_tokens, 0),
		estimated_cost_usd: estimates.reduce((sum, e) => sum + e.estimated_cost_usd, 0),
		is_estimated: estimates.some((e) => e.is_estimated),
		cache_read_tokens: estimates.reduce((sum, e) => sum + (e.cache_read_tokens ?? 0), 0),
		cache_creation_tokens: estimates.reduce((sum, e) => sum + (e.cache_creation_tokens ?? 0), 0),
	};
};

/** Total tool calls across sessions. */
export const totalToolCalls = (sessions: readonly DistilledSession[]): number =>
	sessions.reduce((sum, s) => sum + (s.summary?.key_metrics.tool_calls ?? s.stats.tool_call_count), 0);

/** Total failures across sessions. */
export const totalFailures = (sessions: readonly DistilledSession[]): number =>
	sessions.reduce((sum, s) => sum + (s.summary?.key_metrics.failures ?? s.stats.failure_count), 0);

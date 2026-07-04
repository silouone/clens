import type { ContextConsumption, ContextConsumptionPoint } from "../types/distill";
import type { TranscriptEntry } from "../types/transcript";
import { getModelContextWindow } from "./stats";

/** Compaction = context dropped more than 30% from previous turn. */
const COMPACTION_DROP_THRESHOLD = 0.7;

const safeNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

const roundTo2 = (n: number): number => Math.round(n * 100) / 100;

const isAssistantEntry = (entry: TranscriptEntry): boolean => entry.type === "assistant";

/**
 * Deduplicate assistant entries by requestId (streaming chunks share the same requestId).
 * Takes the last entry per group, matching the pattern in agent-distill.ts.
 */
const deduplicateByRequest = (entries: readonly TranscriptEntry[]): readonly TranscriptEntry[] => {
	const byRequest = new Map<string, TranscriptEntry>(
		entries
			.filter(isAssistantEntry)
			.filter((e) => e.message?.usage !== undefined)
			.map((entry) => [entry.requestId ?? entry.uuid, entry] as const),
	);
	return [...byRequest.values()];
};

const buildPoint = (
	entry: TranscriptEntry,
	turnIndex: number,
	modelContextWindow: number,
	prevTotalTokens: number | undefined,
): ContextConsumptionPoint => {
	const usage = entry.message?.usage;
	const inputTokens = safeNumber(usage?.input_tokens);
	const outputTokens = safeNumber(usage?.output_tokens);
	const cacheReadTokens = safeNumber(usage?.cache_read_input_tokens);
	const cacheCreationTokens = safeNumber(usage?.cache_creation_input_tokens);
	const totalContextTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
	const contextPct = (totalContextTokens / modelContextWindow) * 100;
	const isCompaction =
		prevTotalTokens !== undefined &&
		totalContextTokens < prevTotalTokens * COMPACTION_DROP_THRESHOLD;

	return {
		t: new Date(entry.timestamp).getTime(),
		turn_index: turnIndex,
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		cache_read_tokens: cacheReadTokens,
		cache_creation_tokens: cacheCreationTokens,
		total_context_tokens: totalContextTokens,
		context_pct: roundTo2(contextPct),
		is_compaction: isCompaction,
	};
};

const buildPoints = (
	dedupedEntries: readonly TranscriptEntry[],
	modelContextWindow: number,
): readonly ContextConsumptionPoint[] =>
	dedupedEntries.reduce<readonly ContextConsumptionPoint[]>((acc, entry, idx) => {
		const prevTotal = acc.length > 0 ? acc[acc.length - 1].total_context_tokens : undefined;
		const point = buildPoint(entry, idx, modelContextWindow, prevTotal);
		return [...acc, point];
	}, []);

const computeVelocity = (points: readonly ContextConsumptionPoint[]): number => {
	const nonCompactionPoints = points.filter((p) => !p.is_compaction);
	if (nonCompactionPoints.length < 2) return 0;

	const first = nonCompactionPoints[0];
	const last = nonCompactionPoints[nonCompactionPoints.length - 1];
	const timeSpanMs = last.t - first.t;
	const timeSpanMin = timeSpanMs / 60_000;

	return timeSpanMin > 0 ? roundTo2((last.context_pct - first.context_pct) / timeSpanMin) : 0;
};

/**
 * Extract context consumption data from transcript entries.
 * Returns undefined if no usage data found or model context window is unknown.
 */
export const extractContextConsumption = (
	entries: readonly TranscriptEntry[],
	model: string | undefined,
): ContextConsumption | undefined => {
	if (!model) return undefined;

	const modelContextWindow = getModelContextWindow(model);
	if (modelContextWindow === undefined) return undefined;

	const dedupedEntries = deduplicateByRequest(entries);
	if (dedupedEntries.length === 0) return undefined;

	const points = buildPoints(dedupedEntries, modelContextWindow);
	const peakPoint = points.reduce(
		(max, p) => (p.total_context_tokens > max.total_context_tokens ? p : max),
		points[0],
	);
	const finalPoint = points[points.length - 1];
	const compactionCount = points.filter((p) => p.is_compaction).length;
	const velocity = computeVelocity(points);

	return {
		points,
		peak_context_pct: peakPoint.context_pct,
		peak_context_tokens: peakPoint.total_context_tokens,
		final_context_pct: finalPoint.context_pct,
		compaction_count: compactionCount,
		context_velocity_per_min: velocity,
		model_context_window: modelContextWindow,
		turn_count: points.length,
	};
};

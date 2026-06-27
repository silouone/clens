import type { CostBasis, CostEstimate, PricingTier, StatsResult, StoredEvent, TokenUsage, TranscriptReasoning } from "../types";
import { computeEffectiveDuration, findLastMeaningfulEvent } from "../utils";

// Per-MTok API rates (platform.claude.com pricing, verified 2026-06-11).
// Longest matching prefix wins, so version-specific entries override the
// family fallbacks (e.g. Opus 4.5+ at $5/$25 vs Opus 4.0/4.1 at $15/$75).
// Cache rates: read = 0.1x input, write = 1.25x input (5-minute TTL).
const API_PRICING = {
	"claude-fable-5": { input: 10, output: 50, cache_read: 1.0, cache_write: 12.5 },
	"claude-opus-4-8": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	"claude-opus-4-7": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	"claude-opus-4-6": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	"claude-opus-4-5": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
	"claude-opus-4": { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
	"claude-sonnet-4-6": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	"claude-sonnet-4": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	"claude-haiku-4-5": { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
	"claude-haiku-4": { input: 0.8, output: 4, cache_read: 0.08, cache_write: 1.0 },
} as const;

export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
	"claude-fable-5": 1_000_000,
	"claude-opus-4-8": 1_000_000,
	"claude-opus-4-7": 1_000_000,
	"claude-opus-4-6": 1_000_000,
	"claude-opus-4": 200_000,
	"claude-sonnet-4-6": 1_000_000,
	"claude-sonnet-4": 200_000,
	"claude-haiku-4-5": 200_000,
	"claude-haiku-4": 200_000,
};

/** Longest prefix first so version-specific entries beat family fallbacks. */
const byLengthDesc = (a: string, b: string): number => b.length - a.length;

/**
 * Bare model aliases Claude Code may emit (e.g. `opus`, `sonnet`, `haiku`)
 * instead of a fully-qualified id. Each maps to its CURRENT canonical id — the
 * same tier the alias resolves to today — so the longest-prefix match below
 * never silently falls through to an unpriced $0. Keyed on the exact lowercased
 * string, so fully-qualified ids (`claude-opus-4-8`) are untouched.
 */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
	opus: "claude-opus-4-8",
	sonnet: "claude-sonnet-4-6",
	haiku: "claude-haiku-4-5",
	fable: "claude-fable-5",
};

/** Resolve a bare alias to its canonical model id; pass anything else through. */
const normalizeModelId = (model: string): string => MODEL_ALIASES[model.toLowerCase()] ?? model;

const CONTEXT_WINDOW_PREFIXES = Object.keys(MODEL_CONTEXT_WINDOWS).sort(byLengthDesc);

export const getModelContextWindow = (model: string): number | undefined => {
	const normalized = normalizeModelId(model);
	const matchedPrefix = CONTEXT_WINDOW_PREFIXES.find((prefix) => normalized.startsWith(prefix));
	return matchedPrefix ? MODEL_CONTEXT_WINDOWS[matchedPrefix] : undefined;
};

/** Max subscription effective rate is ~1/3 of API pricing. */
const SUBSCRIPTION_MULTIPLIER = 1 / 3;

type ModelPrefix = keyof typeof API_PRICING;

const MODEL_PREFIXES = (Object.keys(API_PRICING) as ModelPrefix[]).sort(byLengthDesc);

interface ModelRates {
	readonly input: number;
	readonly output: number;
	readonly cache_read: number;
	readonly cache_write: number;
}

/** Get pricing rates for a model+tier combination. "auto" treated same as "api". */
export const getPricing = (model: string, tier: PricingTier = "api"): ModelRates | undefined => {
	const normalized = normalizeModelId(model);
	const matchedPrefix = MODEL_PREFIXES.find((prefix) => normalized.startsWith(prefix));
	if (!matchedPrefix) return undefined;
	const base = API_PRICING[matchedPrefix];
	const multiplier = tier === "max" ? SUBSCRIPTION_MULTIPLIER : 1;
	return {
		input: base.input * multiplier,
		output: base.output * multiplier,
		cache_read: base.cache_read * multiplier,
		cache_write: base.cache_write * multiplier,
	};
};


/** Safely extract a model string from an unknown config value (type guard, no unsafe cast). */
const extractModelFromConfig = (cfg: unknown): string | undefined => {
	if (typeof cfg !== "object" || cfg === null) return undefined;
	if (!("model" in cfg)) return undefined;
	const model = (cfg as { model: unknown }).model; // narrowed by object + "model" in cfg
	return typeof model === "string" ? model : undefined;
};

/** Extract model identifier from events with multi-step fallback chain. */
const extractModel = (events: readonly StoredEvent[]): string | undefined => {
	// 1. Primary: SessionStart context.model
	const sessionStartModel = events.find(
		(e) => e.event === "SessionStart" && e.context?.model,
	)?.context?.model;
	if (sessionStartModel) return sessionStartModel;

	// 2. Fallback: any event with a data.model string field
	const eventWithModel = events.find(
		(e) => typeof e.data.model === "string" && String(e.data.model).length > 0,
	);
	if (eventWithModel) return String(eventWithModel.data.model);

	// 3. Fallback: ConfigChange events with model in nested config object
	const configModel = events
		.filter((e) => e.event === "ConfigChange")
		.reduce<string | undefined>((found, e) => {
			if (found) return found;
			const cfg = e.data.config;
			return extractModelFromConfig(cfg);
		}, undefined);
	return configModel;
};

/**
 * Version stamp for the active API pricing table (`API_PRICING`). Bump this
 * whenever a rate in that table changes so a re-priced cost can be distinguished
 * from a frozen distill-time value, and stale caches can be detected.
 */
export const PRICING_VERSION = "2026-06-11";

/**
 * Re-price a frozen CostEstimate at the CURRENT pricing table.
 *
 * Distilled `cost_estimate` values are frozen at distill-time rates. When the API
 * price table later changes (e.g. Opus 4.5+ dropping from the legacy $15/$75 to
 * $5/$25 — exactly 3x on every component) the stored `estimated_cost_usd` becomes
 * stale (~3x too high). This recomputes the cost from the estimate's OWN token
 * counts × current-table rates — via the same longest-prefix `getPricing` match,
 * so version-specific entries still beat family fallbacks — and stamps
 * `pricing_version`. The frozen number itself is never transformed, only the
 * tokens are re-multiplied.
 *
 * Measured costs (Tier 0) are verbatim captured values, not table-derived, so
 * they are returned unchanged — repricing them would corrupt a real figure.
 * Callers keep the on-disk estimate as the frozen record and use the return value
 * for display only.
 */
export const repriceCostEstimate = (
	estimate: CostEstimate,
	tier: PricingTier = "api",
): CostEstimate => {
	// Tier 0 measured: verbatim captured value — never re-priced (cost-basis.test).
	if (estimate.cost_basis === "measured") return estimate;

	const pricing = getPricing(estimate.model, tier);
	// Unknown model (no prefix match) ⇒ cannot re-price; keep the frozen value but
	// still stamp the version so downstream readers know it was evaluated.
	if (!pricing) return { ...estimate, pricing_version: PRICING_VERSION };

	const repricedUsd =
		(estimate.estimated_input_tokens / 1_000_000) * pricing.input +
		(estimate.estimated_output_tokens / 1_000_000) * pricing.output +
		((estimate.cache_read_tokens ?? 0) / 1_000_000) * pricing.cache_read +
		((estimate.cache_creation_tokens ?? 0) / 1_000_000) * pricing.cache_write;

	return {
		...estimate,
		estimated_cost_usd: Math.round(repricedUsd * 10000) / 10000,
		pricing_tier: tier,
		pricing_version: PRICING_VERSION,
	};
};

/** Recompute cost estimate from known token counts and a model identifier. */
export const estimateCostFromTokens = (
	model: string,
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens?: number,
	cacheCreationTokens?: number,
	tier: PricingTier = "api",
): CostEstimate | undefined => {
	const pricing = getPricing(model, tier);
	if (!pricing) return undefined;

	const estimatedCostUsd =
		(inputTokens / 1_000_000) * pricing.input +
		(outputTokens / 1_000_000) * pricing.output +
		((cacheReadTokens ?? 0) / 1_000_000) * pricing.cache_read +
		((cacheCreationTokens ?? 0) / 1_000_000) * pricing.cache_write;

	// is_estimated is false ONLY when grounded in real token usage (B26). If no
	// real tokens backed this call, the result is not measured usage and must not
	// claim to be — fall back to is_estimated: true (heuristic-equivalent).
	const hasRealUsage =
		inputTokens > 0 || outputTokens > 0 || (cacheReadTokens ?? 0) > 0 || (cacheCreationTokens ?? 0) > 0;

	return {
		model,
		estimated_input_tokens: inputTokens,
		estimated_output_tokens: outputTokens,
		estimated_cost_usd: Math.round(estimatedCostUsd * 10000) / 10000,
		...(cacheReadTokens ? { cache_read_tokens: cacheReadTokens } : {}),
		...(cacheCreationTokens ? { cache_creation_tokens: cacheCreationTokens } : {}),
		is_estimated: !hasRealUsage,
		// Real tokens ⇒ "estimated"; no real tokens ⇒ this is a heuristic-equivalent
		// (e.g. an all-zero usage object) so it must not claim token-grounded provenance.
		cost_basis: hasRealUsage ? "estimated" : "heuristic",
		pricing_tier: tier,
	};
};

/**
 * Extract a measured per-session cost (Tier-0) from captured event data.
 *
 * Claude Code's local transcripts do NOT carry an SDK result `total_cost_usd`
 * today (coverage measured at ~0% on disk, 2026-06-21 — only token `usage` is
 * present), so this is forward-looking: it activates only when a capture path
 * supplies `total_cost_usd`/`costUSD` (> 0) on a hook event's data. Picks the
 * largest such value (a cumulative session total rather than a per-turn delta).
 */
const extractMeasuredCostUsd = (events: readonly StoredEvent[]): number | undefined => {
	const readCost = (raw: unknown): number | undefined =>
		typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;

	const costs = events.flatMap((e) => {
		const direct = readCost(e.data.total_cost_usd) ?? readCost(e.data.costUSD);
		return direct !== undefined ? [direct] : [];
	});

	return costs.length > 0 ? Math.max(...costs) : undefined;
};

/** Build a Tier-0 "measured" cost estimate from a verbatim measured cost. */
const measuredCostEstimate = (
	model: string,
	measuredCostUsd: number,
	tokenUsage: TokenUsage | undefined,
	tier: PricingTier,
): CostEstimate => ({
	model,
	estimated_input_tokens: tokenUsage?.input_tokens ?? 0,
	estimated_output_tokens: tokenUsage?.output_tokens ?? 0,
	// Verbatim measured value — never rounded away, never multiplied by a subscription factor.
	estimated_cost_usd: measuredCostUsd,
	...(tokenUsage?.cache_read_tokens ? { cache_read_tokens: tokenUsage.cache_read_tokens } : {}),
	...(tokenUsage?.cache_creation_tokens ? { cache_creation_tokens: tokenUsage.cache_creation_tokens } : {}),
	is_estimated: false,
	cost_basis: "measured",
	pricing_tier: tier,
});

/** Extract accumulated token usage from events containing usage/token_usage data. */
const extractTokenUsage = (events: readonly StoredEvent[]): TokenUsage | undefined => {
	const usageEntries = events
		.map((e) => {
			const usage = e.data.usage ?? e.data.token_usage;
			if (typeof usage !== "object" || usage === null) return undefined;
			const u = usage as Readonly<Record<string, unknown>>;
			const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;
			const output = typeof u.output_tokens === "number" ? u.output_tokens : 0;
			const cacheRead = typeof u.cache_read_tokens === "number" ? u.cache_read_tokens : 0;
			const cacheCreation = typeof u.cache_creation_tokens === "number" ? u.cache_creation_tokens : 0;
			return input > 0 || output > 0
				? { input, output, cacheRead, cacheCreation }
				: undefined;
		})
		.filter((u): u is { input: number; output: number; cacheRead: number; cacheCreation: number } =>
			u !== undefined,
		);

	if (usageEntries.length === 0) return undefined;

	return usageEntries.reduce<TokenUsage>(
		(acc, u) => ({
			input_tokens: acc.input_tokens + u.input,
			output_tokens: acc.output_tokens + u.output,
			cache_read_tokens: acc.cache_read_tokens + u.cacheRead,
			cache_creation_tokens: acc.cache_creation_tokens + u.cacheCreation,
		}),
		{ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
	);
};

const estimateCost = (
	model: string | undefined,
	totalEvents: number,
	toolCallCount: number,
	reasoning: readonly TranscriptReasoning[],
	tier: PricingTier = "api",
): CostEstimate | undefined => {
	if (!model) return undefined;

	const pricing = getPricing(model, tier);
	if (!pricing) return undefined;

	const reasoningCharCount = reasoning.reduce((acc, r) => acc + r.thinking.length, 0);

	const estimatedInputTokens = totalEvents * 500 + Math.ceil(reasoningCharCount / 4);
	const estimatedOutputTokens = toolCallCount * 200 + Math.ceil(reasoningCharCount / 4);

	const estimatedCostUsd =
		(estimatedInputTokens / 1_000_000) * pricing.input +
		(estimatedOutputTokens / 1_000_000) * pricing.output;

	return {
		model,
		estimated_input_tokens: estimatedInputTokens,
		estimated_output_tokens: estimatedOutputTokens,
		estimated_cost_usd: Math.round(estimatedCostUsd * 10000) / 10000,
		is_estimated: true,
		cost_basis: "heuristic",
		pricing_tier: tier,
	};
};

export const extractStats = (
	events: readonly StoredEvent[],
	reasoning: readonly TranscriptReasoning[] = [],
	transcriptTokenUsage?: TokenUsage,
	tier: PricingTier = "api",
): StatsResult => {
	if (events.length === 0) {
		return {
			total_events: 0,
			duration_ms: 0,
			events_by_type: {},
			tools_by_name: {},
			tool_call_count: 0,
			failure_count: 0,
			failure_rate: 0,
			unique_files: [],
		};
	}

	const eventsByType = events.reduce(
		(acc, event) => ({
			...acc,
			[event.event]: (acc[event.event] ?? 0) + 1,
		}),
		{} as Record<string, number>,
	);

	const model = extractModel(events);

	const toolEvents = events.filter(
		(e) =>
			e.event === "PreToolUse" || e.event === "PostToolUse" || e.event === "PostToolUseFailure",
	);

	const toolsByName = toolEvents
		.filter((e) => e.event === "PreToolUse" && typeof e.data.tool_name === "string")
		.reduce(
			(acc, e) => {
				const name = typeof e.data.tool_name === "string" ? e.data.tool_name : "";
				return { ...acc, [name]: (acc[name] ?? 0) + 1 };
			},
			{} as Record<string, number>,
		);

	const toolCallCount = toolEvents.filter(
		(e) => e.event === "PreToolUse" && e.data.tool_name,
	).length;

	const failureCount = toolEvents.filter(
		(e) => e.event === "PostToolUseFailure" && e.data.tool_name && !e.data.is_interrupt,
	).length;

	const filesSet = new Set(
		toolEvents
			.map((e) => {
				const toolInput = e.data.tool_input as Record<string, unknown> | undefined;
				const raw = toolInput?.file_path ?? toolInput?.path;
				return typeof raw === "string" ? raw : undefined;
			})
			.filter((f): f is string => f !== undefined),
	);

	const failuresByTool = events
		.filter((e) => e.event === "PostToolUseFailure" && typeof e.data.tool_name === "string" && !e.data.is_interrupt)
		.reduce(
			(acc, e) => {
				const name = typeof e.data.tool_name === "string" ? e.data.tool_name : "";
				return { ...acc, [name]: (acc[name] ?? 0) + 1 };
			},
			{} as Record<string, number>,
		);

	const startTime = events[0].t;
	const lastMeaningful = findLastMeaningfulEvent(events);
	const endTime = lastMeaningful?.t ?? events[events.length - 1].t;

	// 4-tier cost resolution: measured > transcript tokens > hook event tokens > heuristic.
	// The stored cost is ALWAYS API-equivalent value at FULL LIST PRICE — token/heuristic
	// tiers price at "api" (never the subscription-multiplied "max" rate). The resolved
	// `tier` is still recorded on `pricing_tier` so a staleness layer can detect tier drift.
	const hookTokenUsage = extractTokenUsage(events);
	const resolvedTokenUsage = transcriptTokenUsage ?? hookTokenUsage;
	const measuredCostUsd = extractMeasuredCostUsd(events);

	// Stamp the resolved tier onto a full-list-priced estimate for staleness detection.
	const withResolvedTier = (estimate: CostEstimate | undefined): CostEstimate | undefined =>
		estimate ? { ...estimate, pricing_tier: tier } : undefined;

	const cost_estimate = (() => {
		// Tier 0: Measured cost — taken verbatim, marked cost_basis: "measured".
		if (measuredCostUsd !== undefined && model) {
			return measuredCostEstimate(model, measuredCostUsd, resolvedTokenUsage, tier);
		}
		// Tier 1: Transcript token usage (most accurate token-based estimate)
		if (transcriptTokenUsage && model) {
			return withResolvedTier(
				estimateCostFromTokens(
					model,
					transcriptTokenUsage.input_tokens,
					transcriptTokenUsage.output_tokens,
					transcriptTokenUsage.cache_read_tokens,
					transcriptTokenUsage.cache_creation_tokens,
				),
			);
		}
		// Tier 2: Hook event token usage
		if (hookTokenUsage && model) {
			return withResolvedTier(
				estimateCostFromTokens(
					model,
					hookTokenUsage.input_tokens,
					hookTokenUsage.output_tokens,
					hookTokenUsage.cache_read_tokens,
					hookTokenUsage.cache_creation_tokens,
				),
			);
		}
		// Tier 3: Heuristic (magic numbers)
		return withResolvedTier(estimateCost(model, events.length, toolCallCount, reasoning));
	})();

	const timestamps = events.map((e) => e.t);
	const effectiveDuration = computeEffectiveDuration(timestamps);

	return {
		total_events: events.length,
		duration_ms: effectiveDuration.effective_duration_ms,
		wall_duration_ms: effectiveDuration.wall_duration_ms,
		events_by_type: eventsByType,
		tools_by_name: toolsByName,
		tool_call_count: toolCallCount,
		failure_count: failureCount,
		failure_rate: toolCallCount > 0 ? failureCount / toolCallCount : 0,
		unique_files: Array.from(filesSet),
		model,
		cost_estimate,
		...(resolvedTokenUsage ? { token_usage: resolvedTokenUsage } : {}),
		failures_by_tool: Object.keys(failuresByTool).length > 0 ? failuresByTool : undefined,
	};
};

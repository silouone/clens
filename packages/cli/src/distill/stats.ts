import type { CostEstimate, StatsResult, StoredEvent, TokenUsage, TranscriptReasoning } from "../types";
import { computeEffectiveDuration, findLastMeaningfulEvent } from "../utils";

const MODEL_PRICING = {
	"claude-opus-4": { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
	"claude-sonnet-4": { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
	"claude-haiku-4": { input: 0.8, output: 4, cache_read: 0.08, cache_write: 1.0 },
} as const;

type ModelPrefix = keyof typeof MODEL_PRICING;

const MODEL_PREFIXES = Object.keys(MODEL_PRICING) as ModelPrefix[];

const findModelPricing = (model: string): (typeof MODEL_PRICING)[ModelPrefix] | undefined => {
	const matchedPrefix = MODEL_PREFIXES.find((prefix) => model.startsWith(prefix));
	return matchedPrefix ? MODEL_PRICING[matchedPrefix] : undefined;
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

/** Recompute cost estimate from known token counts and a model identifier. */
export const estimateCostFromTokens = (
	model: string,
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens?: number,
	cacheCreationTokens?: number,
): CostEstimate | undefined => {
	const pricing = findModelPricing(model);
	if (!pricing) return undefined;

	const estimatedCostUsd =
		(inputTokens / 1_000_000) * pricing.input +
		(outputTokens / 1_000_000) * pricing.output +
		((cacheReadTokens ?? 0) / 1_000_000) * pricing.cache_read +
		((cacheCreationTokens ?? 0) / 1_000_000) * pricing.cache_write;

	return {
		model,
		estimated_input_tokens: inputTokens,
		estimated_output_tokens: outputTokens,
		estimated_cost_usd: Math.round(estimatedCostUsd * 10000) / 10000,
		...(cacheReadTokens ? { cache_read_tokens: cacheReadTokens } : {}),
		...(cacheCreationTokens ? { cache_creation_tokens: cacheCreationTokens } : {}),
		is_estimated: false,
	};
};

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
): CostEstimate | undefined => {
	if (!model) return undefined;

	const pricing = findModelPricing(model);
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
	};
};

export const extractStats = (
	events: readonly StoredEvent[],
	reasoning: readonly TranscriptReasoning[] = [],
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

	// Prefer real token counts from events; fall back to magic-number heuristic
	const tokenUsage = extractTokenUsage(events);
	const cost_estimate = tokenUsage && model
		? estimateCostFromTokens(
				model,
				tokenUsage.input_tokens,
				tokenUsage.output_tokens,
				tokenUsage.cache_read_tokens,
				tokenUsage.cache_creation_tokens,
			)
		: estimateCost(model, events.length, toolCallCount, reasoning);

	const timestamps = events.map((e) => e.t);
	const effectiveDuration = computeEffectiveDuration(timestamps);

	return {
		total_events: events.length,
		duration_ms: effectiveDuration.effective_duration_ms,
		events_by_type: eventsByType,
		tools_by_name: toolsByName,
		tool_call_count: toolCallCount,
		failure_count: failureCount,
		failure_rate: toolCallCount > 0 ? failureCount / toolCallCount : 0,
		unique_files: Array.from(filesSet),
		model,
		cost_estimate,
		failures_by_tool: Object.keys(failuresByTool).length > 0 ? failuresByTool : undefined,
	};
};

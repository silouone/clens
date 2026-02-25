import type {
	AgentDistillResult,
	AgentStats,
	StoredEvent,
	TokenUsage,
	TranscriptContentBlock,
	TranscriptEntry,
} from "../types";
import { extractBacktracks } from "./backtracks";
import { extractEditChains } from "./edit-chains";
import { extractFileMap } from "./file-map";
import { extractReasoning } from "./reasoning";
import { extractStats } from "./stats";

const isAssistantEntry = (entry: TranscriptEntry): boolean => entry.type === "assistant";

const isToolUseBlock = (
	block: TranscriptContentBlock,
): block is Extract<TranscriptContentBlock, { type: "tool_use" }> => block.type === "tool_use";

const contentBlocksOf = (entry: TranscriptEntry): readonly TranscriptContentBlock[] => {
	const content = entry.message?.content;
	return Array.isArray(content) ? content : [];
};

const isToolResultErrorBlock = (
	block: TranscriptContentBlock,
): block is Extract<TranscriptContentBlock, { type: "tool_result" }> =>
	block.type === "tool_result" && block.is_error === true;

export const transcriptToEvents = (entries: readonly TranscriptEntry[]): readonly StoredEvent[] => {
	// First pass: build tool_use_id → {tool_name, tool_input} map from assistant entries
	const toolUseMap: ReadonlyMap<string, { tool_name: string; tool_input: Readonly<Record<string, unknown>> }> = new Map(
		entries
			.filter(isAssistantEntry)
			.flatMap(contentBlocksOf)
			.filter(isToolUseBlock)
			.map((block) => [block.id, { tool_name: block.name, tool_input: block.input }] as const),
	);

	// PreToolUse events from assistant entries
	const preToolEvents: readonly StoredEvent[] = entries.filter(isAssistantEntry).flatMap((entry) => {
		const t = new Date(entry.timestamp).getTime();
		const sid = entry.sessionId;
		return contentBlocksOf(entry)
			.filter(isToolUseBlock)
			.map((block) => ({
				t,
				event: "PreToolUse" as const,
				sid,
				data: {
					tool_name: block.name,
					tool_input: block.input,
					tool_use_id: block.id,
				},
			}));
	});

	// PostToolUseFailure events from user entries with is_error tool_results
	const failureEvents: readonly StoredEvent[] = entries
		.filter((e) => e.type === "user")
		.flatMap((entry) => {
			const t = new Date(entry.timestamp).getTime();
			const sid = entry.sessionId;
			return contentBlocksOf(entry)
				.filter(isToolResultErrorBlock)
				.map((block) => {
					const toolInfo = toolUseMap.get(block.tool_use_id);
					const errorContent =
						typeof block.content === "string"
							? block.content
							: JSON.stringify(block.content);
					return {
						t,
						event: "PostToolUseFailure" as const,
						sid,
						data: {
							tool_name: toolInfo?.tool_name ?? "unknown",
							tool_input: toolInfo?.tool_input ?? {},
							tool_use_id: block.tool_use_id,
							error: errorContent,
						},
					};
				});
		});

	return [...preToolEvents, ...failureEvents].sort((a, b) => a.t - b.t);
};

const safeNumber = (value: unknown): number => (typeof value === "number" ? value : 0);

/**
 * Sum per-turn token usage across all assistant entries.
 * Claude API semantics: `input_tokens` excludes cached tokens (only new/uncached input),
 * `cache_read_input_tokens` = tokens served from prompt cache,
 * `cache_creation_input_tokens` = tokens written to cache.
 * Total billable input = input_tokens + cache_read + cache_creation.
 */
export const extractTokenUsage = (entries: readonly TranscriptEntry[]): TokenUsage =>
	entries.filter(isAssistantEntry).reduce<TokenUsage>(
		(acc, entry) => {
			const usage = entry.message?.usage;
			if (!usage) return acc;
			return {
				input_tokens: acc.input_tokens + safeNumber(usage.input_tokens),
				output_tokens: acc.output_tokens + safeNumber(usage.output_tokens),
				cache_read_tokens: acc.cache_read_tokens + safeNumber(usage.cache_read_input_tokens),
				cache_creation_tokens:
					acc.cache_creation_tokens + safeNumber(usage.cache_creation_input_tokens),
			};
		},
		{ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
	);

export const extractTaskPrompt = (entries: readonly TranscriptEntry[]): string | undefined => {
	const first = entries.find(
		(e) => e.type === "user" && e.message?.role === "user",
	);
	if (!first?.message) return undefined;
	const { content } = first.message;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const textBlock = content.find(
			(b): b is Extract<TranscriptContentBlock, { type: "text" }> => b.type === "text",
		);
		return textBlock?.text;
	}
	return undefined;
};

export const extractAgentModel = (entries: readonly TranscriptEntry[]): string | undefined => {
	const firstAssistant = entries.find(isAssistantEntry);
	return firstAssistant?.message?.model;
};

export const distillAgent = (entries: readonly TranscriptEntry[]): AgentDistillResult | undefined => {
	if (entries.length === 0) return undefined;

	const events = transcriptToEvents(entries);
	const statsResult = extractStats(events);
	const file_map = extractFileMap(events);
	const token_usage = extractTokenUsage(entries);
	const model = extractAgentModel(entries);
	const task_prompt = extractTaskPrompt(entries);

	// Extract reasoning from transcript entries
	const reasoning = extractReasoning(entries);

	// Extract backtracks from synthesized events
	const backtracks = extractBacktracks(events);

	// Extract edit chains binding reasoning + backtracks to file edits
	const edit_chains = extractEditChains(events, reasoning, backtracks);

	const stats: AgentStats = {
		tool_call_count: statsResult.tool_call_count,
		failure_count: statsResult.failure_count,
		tools_by_name: statsResult.tools_by_name,
		unique_files: statsResult.unique_files,
		token_usage,
	};

	return {
		stats,
		file_map,
		model,
		token_usage,
		cost_estimate: statsResult.cost_estimate,
		...(task_prompt !== undefined ? { task_prompt } : {}),
		...(reasoning.length > 0 ? { reasoning } : {}),
		...(backtracks.length > 0 ? { backtracks } : {}),
		...(edit_chains.chains.length > 0 ? { edit_chains } : {}),
	};
};

import type { ConversationEntry } from "../types/conversation";
import type { DistilledSession, StoredEvent } from "../types";

/** Truncate a value to a JSON preview of ~maxLen chars. */
const truncatePreview = (value: unknown, maxLen: number = 100): string => {
	const raw = typeof value === "string" ? value : JSON.stringify(value ?? {});
	return raw.length > maxLen ? `${raw.slice(0, maxLen)}...` : raw;
};

/** Check if a record has a string field. */
const hasStringField = (
	data: Readonly<Record<string, unknown>>,
	key: string,
): data is Readonly<Record<string, unknown>> & Record<typeof key, string> =>
	typeof data[key] === "string";

/** Extract file_path from tool_input data (PreToolUse). */
const extractFilePath = (data: Readonly<Record<string, unknown>>): string | undefined => {
	const toolInput = data["tool_input"];
	if (toolInput && typeof toolInput === "object" && toolInput !== null) {
		const input = toolInput as Readonly<Record<string, unknown>>;
		if (typeof input["file_path"] === "string") return input["file_path"];
		if (typeof input["path"] === "string") return input["path"];
	}
	return undefined;
};

/** Build args_preview from tool_input data. */
const buildArgsPreview = (data: Readonly<Record<string, unknown>>): string =>
	truncatePreview(data["tool_input"]);

/** Map user_messages from distilled session to UserPromptEntry[]. */
const mapUserPrompts = (distilled: DistilledSession): readonly ConversationEntry[] =>
	distilled.user_messages
		.filter((m) => !m.is_tool_result && m.message_type !== "system")
		.map((m, i) => ({
			type: "user_prompt" as const,
			t: m.t,
			text: m.content,
			index: i,
		}));

/** Map reasoning entries to ThinkingEntry[]. */
const mapThinking = (distilled: DistilledSession): readonly ConversationEntry[] =>
	distilled.reasoning.map((r) => ({
		type: "thinking" as const,
		t: r.t,
		text: r.thinking,
		intent: r.intent_hint ?? "general",
	}));

/** Map PreToolUse events to ToolCallEntry[]. */
const mapToolCalls = (events: readonly StoredEvent[]): readonly ConversationEntry[] =>
	events
		.filter((e) => e.event === "PreToolUse")
		.filter((e) => hasStringField(e.data, "tool_use_id") && hasStringField(e.data, "tool_name"))
		.map((e) => ({
			type: "tool_call" as const,
			t: e.t,
			tool_name: e.data["tool_name"] as string,
			tool_use_id: e.data["tool_use_id"] as string,
			file_path: extractFilePath(e.data),
			args_preview: buildArgsPreview(e.data),
		}));

/** Map PostToolUse / PostToolUseFailure events to ToolResultEntry[]. */
const mapToolResults = (events: readonly StoredEvent[]): readonly ConversationEntry[] =>
	events
		.filter((e) => e.event === "PostToolUse" || e.event === "PostToolUseFailure")
		.filter((e) => hasStringField(e.data, "tool_use_id") && hasStringField(e.data, "tool_name"))
		.map((e) => ({
			type: "tool_result" as const,
			t: e.t,
			tool_use_id: e.data["tool_use_id"] as string,
			tool_name: e.data["tool_name"] as string,
			outcome: (e.event === "PostToolUseFailure" ? "failure" : "success") as "success" | "failure",
			...(e.event === "PostToolUseFailure" && hasStringField(e.data, "error")
				? { error: e.data["error"] as string }
				: {}),
		}));

/** Map backtracks to BacktrackEntry[]. */
const mapBacktracks = (distilled: DistilledSession): readonly ConversationEntry[] =>
	distilled.backtracks.map((b) => ({
		type: "backtrack" as const,
		t: b.start_t,
		backtrack_type: b.type,
		attempt: b.attempts,
		reverted_tool_ids: b.tool_use_ids,
	}));

/** Map summary phases to PhaseBoundaryEntry[]. */
const mapPhaseBoundaries = (distilled: DistilledSession): readonly ConversationEntry[] =>
	(distilled.summary?.phases ?? []).map((p, i) => ({
		type: "phase_boundary" as const,
		t: p.start_t,
		phase_name: p.name,
		phase_index: i,
	}));

/**
 * Build a sorted conversation timeline from distilled data and raw events.
 * Pure function — no I/O, no mutation.
 */
export const buildConversation = (
	distilled: DistilledSession,
	events: readonly StoredEvent[],
): readonly ConversationEntry[] => {
	const all: readonly ConversationEntry[] = [
		...mapUserPrompts(distilled),
		...mapThinking(distilled),
		...mapToolCalls(events),
		...mapToolResults(events),
		...mapBacktracks(distilled),
		...mapPhaseBoundaries(distilled),
	];

	return [...all].sort((a, b) => a.t - b.t);
};

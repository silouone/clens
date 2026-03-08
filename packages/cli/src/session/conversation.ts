import type { ConversationEntry } from "../types/conversation";
import type { AgentNode, DistilledSession, StoredEvent, TranscriptContentBlock, TranscriptEntry } from "../types";

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

// ── Transcript-based conversation builder (for agents without hook events) ──

/** Type guard for content block arrays. */
const isContentBlockArray = (
	content: string | readonly TranscriptContentBlock[],
): content is readonly TranscriptContentBlock[] => Array.isArray(content);

/** Extract user prompt entries from transcript entries. */
const mapTranscriptUserPrompts = (entries: readonly TranscriptEntry[]): readonly ConversationEntry[] =>
	entries
		.filter((e) => e.type === "user" && e.message?.role === "user")
		.flatMap((e, i): readonly ConversationEntry[] => {
			const content = e.message?.content;
			if (!content) return [];
			const text = typeof content === "string"
				? content
				: content
						.filter((b): b is Extract<TranscriptContentBlock, { type: "text" }> => b.type === "text")
						.map((b) => b.text)
						.join("\n");
			return text ? [{
				type: "user_prompt" as const,
				t: new Date(e.timestamp).getTime(),
				text,
				index: i,
			}] : [];
		});

/** Extract tool call entries from assistant transcript content blocks. */
const mapTranscriptToolCalls = (entries: readonly TranscriptEntry[]): readonly ConversationEntry[] =>
	entries
		.filter((e) => e.type === "assistant" && e.message?.content)
		.flatMap((e): readonly ConversationEntry[] => {
			const content = e.message?.content;
			if (!content || !isContentBlockArray(content)) return [];
			const t = new Date(e.timestamp).getTime();
			return content
				.filter((b): b is Extract<TranscriptContentBlock, { type: "tool_use" }> => b.type === "tool_use")
				.map((b) => {
					// b.input is Record<string, unknown> — bracket access is required
					const filePath = typeof b.input["file_path"] === "string"
						? b.input["file_path"]
						: typeof b.input["path"] === "string"
							? b.input["path"]
							: undefined;
					return {
						type: "tool_call" as const,
						t,
						tool_name: b.name,
						tool_use_id: b.id,
						file_path: filePath,
						args_preview: truncatePreview(b.input),
					};
				});
		});

/** Extract tool result entries from user transcript content blocks (tool results come back as user messages). */
const mapTranscriptToolResults = (entries: readonly TranscriptEntry[]): readonly ConversationEntry[] =>
	entries
		.filter((e) => e.type === "user" && e.message?.content)
		.flatMap((e): readonly ConversationEntry[] => {
			const content = e.message?.content;
			if (!content || !isContentBlockArray(content)) return [];
			const t = new Date(e.timestamp).getTime();
			return content
				.filter((b): b is Extract<TranscriptContentBlock, { type: "tool_result" }> => b.type === "tool_result")
				.map((b) => ({
					type: "tool_result" as const,
					t,
					tool_use_id: b.tool_use_id,
					tool_name: "unknown",
					outcome: (b.is_error ? "failure" : "success") as "success" | "failure",
					...(b.is_error && typeof b.content === "string" ? { error: b.content } : {}),
				}));
		});

/** Extract thinking entries from assistant transcript content blocks. */
const mapTranscriptThinking = (entries: readonly TranscriptEntry[]): readonly ConversationEntry[] =>
	entries
		.filter((e) => e.type === "assistant" && e.message?.content)
		.flatMap((e): readonly ConversationEntry[] => {
			const content = e.message?.content;
			if (!content || !isContentBlockArray(content)) return [];
			const t = new Date(e.timestamp).getTime();
			return content
				.filter((b): b is Extract<TranscriptContentBlock, { type: "thinking" }> => b.type === "thinking")
				.map((b) => ({
					type: "thinking" as const,
					t,
					text: b.thinking,
					intent: "general",
				}));
		});

/** Map agent messages (from link enrichment) to AgentMessageEntry[]. */
const mapAgentMessages = (agent?: AgentNode): readonly ConversationEntry[] =>
	(agent?.messages ?? []).map((m) => ({
		type: "agent_message" as const,
		t: m.t,
		direction: m.direction,
		partner: m.partner,
		msg_type: m.msg_type,
		...(m.summary ? { summary: m.summary } : {}),
	}));

/** Derive earliest timestamp from agent data (messages, task_events, reasoning). */
const getAgentStartTime = (agent?: AgentNode): number | undefined => {
	const timestamps = [
		...(agent?.messages ?? []).map((m) => m.t),
		...(agent?.task_events ?? []).map((te) => te.t),
		...(agent?.reasoning ?? []).map((r) => r.t),
	];
	return timestamps.length > 0 ? Math.min(...timestamps) : undefined;
};

/**
 * Build conversation from transcript entries and optional agent node data.
 * Used as fallback when hook events are unavailable (sub-agents).
 * Pure function — no I/O, no mutation.
 */
export const buildConversationFromTranscript = (
	transcript: readonly TranscriptEntry[],
	agent?: AgentNode,
): readonly ConversationEntry[] => {
	const agentReasoning: readonly ConversationEntry[] = (agent?.reasoning ?? []).map((r) => ({
		type: "thinking" as const,
		t: r.t,
		text: r.thinking,
		intent: r.intent_hint ?? "general",
	}));

	const agentBacktracks: readonly ConversationEntry[] = (agent?.backtracks ?? []).map((b) => ({
		type: "backtrack" as const,
		t: b.start_t,
		backtrack_type: b.type,
		attempt: b.attempts,
		reverted_tool_ids: b.tool_use_ids,
	}));

	// Use agent-level reasoning if available (richer with intent_hint), else extract from transcript
	const thinking = agentReasoning.length > 0 ? agentReasoning : mapTranscriptThinking(transcript);

	// Task prompt as first user message (when transcript is empty and agent has one)
	const taskPrompt: readonly ConversationEntry[] = (() => {
		if (!agent?.task_prompt) return [];
		const startT = getAgentStartTime(agent) ?? 0;
		return [{
			type: "user_prompt" as const,
			t: startT - 1, // before any other entries
			text: agent.task_prompt,
			index: 0,
		}];
	})();

	// Agent messages from link enrichment (inter-agent communication)
	const messages = mapAgentMessages(agent);

	const all: readonly ConversationEntry[] = [
		...taskPrompt,
		...mapTranscriptUserPrompts(transcript),
		...thinking,
		...mapTranscriptToolCalls(transcript),
		...mapTranscriptToolResults(transcript),
		...agentBacktracks,
		...messages,
	];

	return [...all].sort((a, b) => a.t - b.t);
};

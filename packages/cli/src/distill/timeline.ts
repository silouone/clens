import type {
	AgentLifetime,
	BacktrackResult,
	LinkEvent,
	PhaseInfo,
	StoredEvent,
	TimelineEntry,
	TranscriptReasoning,
	TranscriptUserMessage,
} from "../types";
import { resolveName } from "../utils";
import { extractAgentLifetimes } from "./comm-sequence";

const TIMELINE_CAP = 500;

// --- Source mappers ---

const eventsToEntries = (events: readonly StoredEvent[]): readonly TimelineEntry[] =>
	events.flatMap((event): readonly TimelineEntry[] => {
		if (event.event === "PreToolUse") {
			const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : undefined;
			const toolUseId =
				typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : undefined;
			return [
				{
					t: event.t,
					type: "tool_call" as const,
					tool_name: toolName,
					tool_use_id: toolUseId,
				},
			];
		}
		if (event.event === "PostToolUseFailure") {
			const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : undefined;
			const toolUseId =
				typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : undefined;
			const error = typeof event.data.error === "string" ? event.data.error : undefined;
			return [
				{
					t: event.t,
					type: "failure" as const,
					tool_name: toolName,
					tool_use_id: toolUseId,
					content_preview: error?.slice(0, 200),
				},
			];
		}
		if (event.event === "TeammateIdle") {
			const teammateName =
				typeof event.data.agent_name === "string"
					? event.data.agent_name
					: typeof event.data.agent_id === "string"
						? event.data.agent_id
						: "unknown";
			return [
				{
					t: event.t,
					type: "teammate_idle" as const,
					teammate_name: teammateName,
					content_preview: `${teammateName} idle`,
				},
			];
		}
		if (event.event === "TaskCompleted") {
			const taskId = typeof event.data.task_id === "string" ? event.data.task_id : undefined;
			const taskSubject = typeof event.data.subject === "string" ? event.data.subject : undefined;
			return [
				{
					t: event.t,
					type: "task_complete" as const,
					task_id: taskId,
					task_subject: taskSubject,
					content_preview: `Task completed: ${taskSubject ?? "unknown"}`,
				},
			];
		}
		return [];
	});

const reasoningToEntries = (reasoning: readonly TranscriptReasoning[]): readonly TimelineEntry[] =>
	reasoning.map((r) => ({
		t: r.t,
		type: "thinking" as const,
		content_preview: r.thinking.slice(0, 200),
		tool_use_id: r.tool_use_id,
		tool_name: r.tool_name,
	}));

const userMessagesToEntries = (
	messages: readonly TranscriptUserMessage[],
): readonly TimelineEntry[] =>
	messages
		.filter((m) => m.message_type === "prompt")
		.map((m) => ({
			t: m.t,
			type: "user_prompt" as const,
			content_preview: m.content.slice(0, 200),
		}));

const backtracksToEntries = (backtracks: readonly BacktrackResult[]): readonly TimelineEntry[] =>
	backtracks.map((bt) => ({
		t: bt.start_t,
		type: "backtrack" as const,
		tool_name: bt.tool_name,
		content_preview: `${bt.type}: ${bt.attempts} attempts`,
	}));

const phasesToEntries = (phases: readonly PhaseInfo[]): readonly TimelineEntry[] =>
	phases.map((p, i) => ({
		t: p.start_t,
		type: "phase_boundary" as const,
		content_preview: p.name,
		phase_index: i,
	}));

const agentEventsToEntries = (
	events: readonly StoredEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly TimelineEntry[] =>
	events.flatMap((event): readonly TimelineEntry[] => {
		if (event.event === "SubagentStart") {
			const agentId = typeof event.data.agent_id === "string" ? event.data.agent_id : undefined;
			const agentName =
				typeof event.data.agent_name === "string"
					? event.data.agent_name
					: agentId && nameMap
						? resolveName(agentId, nameMap)
						: undefined;
			return [
				{
					t: event.t,
					type: "agent_spawn" as const,
					agent_id: agentId,
					agent_name: agentName,
					content_preview: `Spawned ${agentName ?? agentId?.slice(0, 8) ?? "agent"} (${typeof event.data.agent_type === "string" ? event.data.agent_type : "unknown"})`,
				},
			];
		}
		if (event.event === "SubagentStop") {
			const agentId = typeof event.data.agent_id === "string" ? event.data.agent_id : undefined;
			const agentName = agentId && nameMap ? resolveName(agentId, nameMap) : undefined;
			return [
				{
					t: event.t,
					type: "agent_stop" as const,
					agent_id: agentId,
					agent_name: agentName,
					content_preview: `Stopped ${agentName ?? agentId?.slice(0, 8) ?? "agent"}`,
				},
			];
		}
		return [];
	});

const taskLinksToEntries = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly TimelineEntry[] =>
	links.flatMap((link): readonly TimelineEntry[] => {
		if (link.type !== "task") return [];
		if (link.action === "create") {
			return [
				{
					t: link.t,
					type: "task_create" as const,
					agent_name: link.agent ? resolveName(link.agent, nameMap ?? new Map()) : undefined,
					content_preview: `Task created: ${link.subject ?? link.task_id}`,
				},
			];
		}
		if (link.action === "assign") {
			return [
				{
					t: link.t,
					type: "task_assign" as const,
					agent_name: link.owner,
					content_preview: `Task assigned to ${link.owner ?? "?"}: ${link.subject ?? link.task_id}`,
				},
			];
		}
		return [];
	});

const messageLinkToEntries = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly TimelineEntry[] =>
	links.flatMap((link): readonly TimelineEntry[] => {
		if (link.type !== "msg_send") return [];
		const fromName = nameMap ? resolveName(link.from, nameMap) : link.from;
		const toName = nameMap ? resolveName(link.to, nameMap) : link.to;
		const summary = link.summary ? `: ${link.summary.slice(0, 100)}` : "";
		return [
			{
				t: link.t,
				type: "msg_send" as const,
				agent_name: fromName,
				msg_from: fromName,
				msg_to: toName,
				content_preview: `${fromName} -> ${toName}${summary}`,
			},
		];
	});

// --- Agent lifetime annotation ---

const annotateAgentOwnership = (
	entry: TimelineEntry,
	lifetimes: readonly AgentLifetime[],
): TimelineEntry => {
	if (entry.agent_id ?? entry.agent_name) return entry;

	const match = lifetimes.find((lt) => entry.t >= lt.start_t && entry.t <= lt.end_t);
	return match
		? { ...entry, agent_id: match.agent_id, agent_name: match.agent_name }
		: entry;
};

// --- Phase index assignment ---

const assignPhaseIndex = (entry: TimelineEntry, phases: readonly PhaseInfo[]): TimelineEntry => {
	if (entry.phase_index !== undefined) return entry;

	const idx = phases.reduce(
		(foundIdx, phase, i) => (entry.t >= phase.start_t && entry.t <= phase.end_t ? i : foundIdx),
		-1,
	);

	return idx >= 0 ? { ...entry, phase_index: idx } : entry;
};

// --- Capping strategy ---

const isStructural = (entry: TimelineEntry): boolean =>
	entry.type === "phase_boundary" ||
	entry.type === "user_prompt" ||
	entry.type === "teammate_idle" ||
	entry.type === "task_complete" ||
	entry.type === "agent_spawn" ||
	entry.type === "agent_stop" ||
	entry.type === "task_create" ||
	entry.type === "task_assign" ||
	entry.type === "msg_send";

const capEntries = (entries: readonly TimelineEntry[]): readonly TimelineEntry[] => {
	if (entries.length <= TIMELINE_CAP) return entries;

	const structural = entries.filter(isStructural);
	const nonStructural = entries.filter((e) => !isStructural(e));

	const remainingSlots = Math.max(0, TIMELINE_CAP - structural.length);

	// Even sampling: keep every Nth entry
	const sampleRate =
		remainingSlots > 0 ? Math.max(1, Math.ceil(nonStructural.length / remainingSlots)) : 1;
	const sampled = nonStructural.filter((_, i) => i % sampleRate === 0).slice(0, remainingSlots);

	return [...structural, ...sampled].sort((a, b) => a.t - b.t);
};

// --- Main extractor ---

export const extractTimeline = (
	events: readonly StoredEvent[],
	reasoning: readonly TranscriptReasoning[],
	user_messages: readonly TranscriptUserMessage[],
	backtracks: readonly BacktrackResult[],
	phases: readonly PhaseInfo[],
	links?: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly TimelineEntry[] => {
	const allEntries = [
		...eventsToEntries(events),
		...agentEventsToEntries(events, nameMap),
		...reasoningToEntries(reasoning),
		...userMessagesToEntries(user_messages),
		...backtracksToEntries(backtracks),
		...phasesToEntries(phases),
		...(links ? taskLinksToEntries(links, nameMap) : []),
		...(links ? messageLinkToEntries(links, nameMap) : []),
	].sort((a, b) => a.t - b.t);

	const capped = capEntries(allEntries);

	const lifetimes = links ? extractAgentLifetimes(links, nameMap) : [];
	const annotated = lifetimes.length > 0
		? capped.map((entry) => annotateAgentOwnership(entry, lifetimes))
		: capped;

	return annotated.map((entry) => assignPhaseIndex(entry, phases));
};

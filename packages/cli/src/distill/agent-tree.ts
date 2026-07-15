import type {
	AgentNode,
	LinkEvent,
	MessageLink,
	PricingTier,
	SpawnLink,
	StopLink,
	StoredEvent,
	TaskLink,
	TranscriptEntry,
} from "../types";
import { computeEffectiveDuration, deduplicateSpawns, IDLE_THRESHOLD_MS } from "../utils";
import { type DiffContext, distillAgent } from "./agent-distill";
import { extractFileMap } from "./file-map";
import { extractStats } from "./stats";

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";
const isStopLink = (link: LinkEvent): link is StopLink => link.type === "stop";

/** Minimal event shape needed for tool-call attribution. */
type AttributableEvent = {
	readonly t: number;
	readonly event: string;
	readonly data: Record<string, unknown>;
};

/** Read a string `data.agent_id` tag from an event, if present (untrusted JSON — narrow, never cast). */
const eventAgentId = (event: AttributableEvent): string | undefined => {
	const raw = event.data.agent_id;
	return typeof raw === "string" && raw.length > 0 ? raw : undefined;
};

/**
 * Count PreToolUse calls attributable to an agent.
 *
 * Preferred: raw hook events carry `data.agent_id` tagging which agent issued each
 * tool call. When the agent has any tagged events, that count is authoritative — pure
 * time-window attribution mis-assigns calls across overlapping/nested agent intervals
 * and zeroes agents whose tagged events fall outside the naive spawn→stop window (ghost
 * zeroing). Fall back to the spawn→stop time window only for fully-untagged sessions.
 */
const countAgentToolCalls = (
	agentId: string,
	spawnT: number,
	stopT: number | undefined,
	events: readonly AttributableEvent[],
): { readonly count: number; readonly tagged: boolean } => {
	const preEvents = events.filter((e) => e.event === "PreToolUse");
	const tagged = preEvents.filter((e) => eventAgentId(e) === agentId);
	if (tagged.length > 0) return { count: tagged.length, tagged: true };

	const windowCount = preEvents.filter(
		(e) =>
			eventAgentId(e) === undefined && e.t >= spawnT && (stopT !== undefined ? e.t <= stopT : true),
	).length;
	return { count: windowCount, tagged: false };
};

/** Agent interval for event attribution. */
interface AgentInterval {
	readonly agentId: string;
	readonly start: number;
	readonly end: number;
}

/**
 * Attribute events to agents based on spawn/stop time boundaries.
 * Returns a Map from agentId (or sessionId for the parent) to events within that agent's interval.
 * Events are attributed to the innermost (most specific) agent whose interval contains the event.
 */
export const attributeEventsToAgents = (
	sessionId: string,
	events: readonly StoredEvent[],
	links: readonly LinkEvent[],
): ReadonlyMap<string, readonly StoredEvent[]> => {
	const spawns = deduplicateSpawns(links.filter(isSpawnLink));
	const stops = links.filter(isStopLink);

	// Build intervals: for each spawn, find matching stop
	const intervals: readonly AgentInterval[] = spawns.map((spawn): AgentInterval => {
		const stop = stops.find((s) => s.agent_id === spawn.agent_id);
		const maxT =
			events.length > 0 ? events.reduce((max, e) => Math.max(max, e.t), 0) : (stop?.t ?? spawn.t);
		return {
			agentId: spawn.agent_id,
			start: spawn.t,
			end: stop?.t ?? maxT,
		};
	});

	// Sort intervals by start time descending so inner (more specific) agents are checked first
	const sortedIntervals = [...intervals].sort((a, b) => b.start - a.start);

	// For each event, find the innermost agent interval containing it
	const findAgent = (t: number): string => {
		const match = sortedIntervals.find((interval) => t >= interval.start && t <= interval.end);
		return match?.agentId ?? sessionId;
	};

	// Attribute each event
	return events.reduce<Map<string, StoredEvent[]>>((acc, event) => {
		const agentId = findAgent(event.t);
		const existing = acc.get(agentId);
		if (existing) existing.push(event);
		else acc.set(agentId, [event]);
		return acc;
	}, new Map());
};

/** Estimate duration from link events attributed to an agent (by id or name). */
export const computeLinkBasedDuration = (
	agentId: string,
	agentName: string | undefined,
	spawnT: number,
	links: readonly LinkEvent[],
): number => {
	const isRelevant = (link: LinkEvent): boolean => {
		if (link.type === "msg_send") return link.from === agentId || link.to === agentId;
		if (link.type === "task") return link.session_id === agentId;
		if (link.type === "task_complete") return agentName !== undefined && link.agent === agentName;
		if (link.type === "teammate_idle")
			return agentName !== undefined && link.teammate === agentName;
		return false;
	};

	const relevantTimestamps = links.filter(isRelevant).map((l) => l.t);
	if (relevantTimestamps.length === 0) return 0;

	const maxT = relevantTimestamps.reduce((max, t) => (t > max ? t : max), relevantTimestamps[0]);
	return Math.max(0, maxT - spawnT);
};

/** Type for injectable transcript reader dependency. */
export type ReadTranscriptFn = (path: string) => readonly TranscriptEntry[];

/** Type for injectable agent session event reader. Returns events from the agent's own session file. */
export type ReadAgentEventsFn = (agentId: string) => readonly StoredEvent[];

/**
 * Enrich an AgentNode with transcript-derived data (stats, file_map, cost, etc.).
 * Accepts a `readTranscriptFn` for dependency injection, keeping this module I/O-free.
 */
export const enrichNodeWithTranscript = (
	node: AgentNode,
	transcriptPath: string,
	readTranscriptFn: ReadTranscriptFn,
	diffContext?: DiffContext,
	tier: PricingTier = "api",
): AgentNode => {
	const entries = readTranscriptFn(transcriptPath);
	const result = distillAgent(entries, diffContext, tier);
	if (!result) {
		// Fallback: record that enrichment was attempted
		return { ...node, transcript_path: transcriptPath };
	}

	return {
		...node,
		transcript_path: transcriptPath,
		model: result.model,
		stats: result.stats,
		file_map: result.file_map,
		cost_estimate: result.cost_estimate,
		tool_call_count: result.stats.tool_call_count,
		...(result.task_prompt ? { task_prompt: result.task_prompt } : {}),
		...(result.edit_chains ? { edit_chains: result.edit_chains } : {}),
		...(result.backtracks ? { backtracks: result.backtracks } : {}),
		...(result.reasoning ? { reasoning: result.reasoning } : {}),
		...(result.context_consumption ? { context_consumption: result.context_consumption } : {}),
	};
};

/**
 * Enrich an AgentNode from its own session events (hook JSONL file).
 * Fallback for when transcript enrichment is unavailable.
 */
export const enrichNodeFromSessionEvents = (
	node: AgentNode,
	agentEvents: readonly StoredEvent[],
	tier: PricingTier = "api",
): AgentNode => {
	if (agentEvents.length === 0) return node;

	const statsResult = extractStats(agentEvents, [], undefined, tier);
	const file_map = extractFileMap(agentEvents);

	if (statsResult.tool_call_count === 0 && file_map.files.length === 0) return node;

	return {
		...node,
		tool_call_count:
			statsResult.tool_call_count > 0 ? statsResult.tool_call_count : node.tool_call_count,
		model: statsResult.model ?? node.model,
		stats: {
			tool_call_count: statsResult.tool_call_count,
			failure_count: statsResult.failure_count,
			tools_by_name: statsResult.tools_by_name,
			unique_files: statsResult.unique_files,
		},
		...(file_map.files.length > 0 ? { file_map } : {}),
		...(statsResult.cost_estimate ? { cost_estimate: statsResult.cost_estimate } : {}),
	};
};

/**
 * Build the agent hierarchy tree from link events and session events.
 * Accepts `readTranscriptFn` for dependency injection so transcript I/O stays outside extractors.
 * Optionally accepts `readAgentEventsFn` to read agent session events as fallback when transcript is unavailable.
 */
export const buildAgentTree = (
	sessionId: string,
	links: readonly LinkEvent[],
	events: readonly { t: number; event: string; data: Record<string, unknown> }[],
	readTranscriptFn: ReadTranscriptFn,
	readAgentEventsFn?: ReadAgentEventsFn,
	diffContext?: DiffContext,
	tier: PricingTier = "api",
): AgentNode[] => {
	const spawns = deduplicateSpawns(links.filter(isSpawnLink));
	const stops = links.filter(isStopLink);

	const rootSpawns = spawns.filter((s) => s.parent_session === sessionId);

	const buildNode = (spawn: SpawnLink): AgentNode => {
		const matchingStop = stops.find((s) => s.agent_id === spawn.agent_id);
		const rawDurationMs = matchingStop ? matchingStop.t - spawn.t : 0;
		const agentDurationMs = (() => {
			if (rawDurationMs <= IDLE_THRESHOLD_MS) return rawDurationMs;
			const agentEvents = events.filter(
				(e) => e.t >= spawn.t && (matchingStop ? e.t <= matchingStop.t : true),
			);
			if (agentEvents.length < 2) return rawDurationMs;
			const agentTimestamps = agentEvents.map((e) => e.t);
			return computeEffectiveDuration(agentTimestamps).effective_duration_ms;
		})();
		const linkDuration =
			agentDurationMs > 0
				? agentDurationMs
				: computeLinkBasedDuration(spawn.agent_id, spawn.agent_name, spawn.t, links);
		// Absolute fallback: if link-based duration is also 0 but stop event exists, use stop.t - spawn.t
		const durationMs =
			linkDuration > 0 ? linkDuration : matchingStop ? Math.abs(matchingStop.t - spawn.t) : 0;

		const childSpawns = spawns.filter((s) => s.parent_session === spawn.agent_id);
		const children = childSpawns.map(buildNode);

		// Attribute tool calls by data.agent_id when raw events carry it (authoritative);
		// fall back to the spawn→stop time window only for untagged sessions.
		const toolCalls = countAgentToolCalls(spawn.agent_id, spawn.t, matchingStop?.t, events);
		const toolCallCount = toolCalls.count;

		const baseNode: AgentNode = {
			session_id: spawn.agent_id,
			agent_type: spawn.agent_type,
			agent_name: spawn.agent_name,
			duration_ms: durationMs,
			tool_call_count: toolCallCount,
			children,
		};

		// Auto-enrich when transcript path exists
		const transcriptPath = matchingStop?.transcript_path;
		if (transcriptPath) {
			const enriched = enrichNodeWithTranscript(
				baseNode,
				transcriptPath,
				readTranscriptFn,
				diffContext,
				tier,
			);
			// When hook-based toolCallCount is 0 but transcript enrichment produced stats, prefer transcript stats
			const finalEnriched =
				enriched.tool_call_count === 0 && enriched.stats && enriched.stats.tool_call_count > 0
					? { ...enriched, tool_call_count: enriched.stats.tool_call_count }
					: enriched;
			if (
				finalEnriched.tool_call_count > 0 ||
				(finalEnriched.stats && finalEnriched.stats.tool_call_count > 0)
			) {
				return finalEnriched;
			}
		}

		// Fallback: read agent's own session events when transcript enrichment didn't produce stats
		if (readAgentEventsFn && baseNode.tool_call_count === 0) {
			const agentSessionEvents = readAgentEventsFn(spawn.agent_id);
			const fromEvents = enrichNodeFromSessionEvents(baseNode, agentSessionEvents, tier);
			if (fromEvents.tool_call_count > 0) return fromEvents;
		}

		// When the count came from per-event data.agent_id tags it is authoritative — keep it,
		// even without transcript/session-event stats (these are real tool calls, not a ghost estimate).
		if (toolCalls.tagged && baseNode.tool_call_count > 0) return baseNode;

		// Ghost agent: enrichment failed and tool_call_count was estimated from the time window — reset to 0
		return baseNode.tool_call_count > 0 && !baseNode.stats
			? { ...baseNode, tool_call_count: 0 }
			: baseNode;
	};

	return rootSpawns.map(buildNode);
};

const isMessageLink = (link: LinkEvent): link is MessageLink => link.type === "msg_send";
const isTaskLinkGuard = (link: LinkEvent): link is TaskLink => link.type === "task";

/**
 * Infer agent nodes from communication links when no spawn links exist.
 * Extracts agent names from msg_send recipients, maps names to UUIDs via task links,
 * and computes duration from first-to-last activity timestamps.
 *
 * When `teamMemberSessions` is provided, agent names found in the map get their
 * real session_id (enabling event/transcript reading for enrichment).
 */
export const inferAgentsFromComms = (
	sessionId: string,
	links: readonly LinkEvent[],
	teamMemberSessions?: ReadonlyMap<string, string>,
): AgentNode[] => {
	// Collect unique agent names from msg_send where the session is the sender
	const msgRecipients = links
		.filter(isMessageLink)
		.filter((msg) => msg.from === sessionId || msg.session_id === sessionId)
		.map((msg) => msg.to);
	const uniqueNames = [...new Set(msgRecipients)].filter((name) => name.length > 0);

	if (uniqueNames.length === 0) return [];

	// Build name→UUID map from task links where owner is set
	const nameToUuid: ReadonlyMap<string, string> = new Map(
		links
			.filter(isTaskLinkGuard)
			.filter(
				(link): link is typeof link & { owner: string; session_id: string } =>
					typeof link.owner === "string" &&
					typeof link.session_id === "string" &&
					link.session_id !== sessionId,
			)
			.map((link) => [link.owner, link.session_id] as const),
	);

	// Compute first/last activity per agent name across all link types
	const activityTimestamps = (agentName: string): readonly number[] =>
		links.flatMap((link): readonly number[] => {
			if (link.type === "msg_send" && (link.to === agentName || link.from_name === agentName))
				return [link.t];
			if (link.type === "task" && link.owner === agentName) return [link.t];
			if (link.type === "task_complete" && link.agent === agentName) return [link.t];
			if (link.type === "teammate_idle" && link.teammate === agentName) return [link.t];
			return [];
		});

	// Resolution priority: teamMemberSessions (real session_id) > task-link UUID > agent name
	const resolveSessionId = (agentName: string): string =>
		teamMemberSessions?.get(agentName) ?? nameToUuid.get(agentName) ?? agentName;

	return uniqueNames.map((agentName): AgentNode => {
		const timestamps = activityTimestamps(agentName);
		const firstT = timestamps.length > 0 ? Math.min(...timestamps) : 0;
		const lastT = timestamps.length > 0 ? Math.max(...timestamps) : 0;

		return {
			session_id: resolveSessionId(agentName),
			agent_type: "builder",
			agent_name: agentName,
			duration_ms: lastT - firstT,
			tool_call_count: 0,
			children: [],
		};
	});
};

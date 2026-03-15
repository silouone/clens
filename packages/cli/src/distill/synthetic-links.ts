// Synthesize SpawnLink/StopLink events for background sub-agents
// that don't fire SubagentStart/SubagentStop hook events.
// Matches by timestamp correlation between Agent tool calls and session files.
//
// Pure module: I/O (file scanning) is injected via the `scanFn` parameter.
// The default scanSessionFiles implementation lives in session/synthetic-scan.ts.

import type { LinkEvent, SpawnLink, StopLink, StoredEvent } from "../types";
import type { SessionFileInfo } from "../session/synthetic-scan";

/** An Agent tool call extracted from parent session events. */
interface AgentCall {
	readonly t: number;
	readonly name: string;
	readonly agentType: string;
	readonly description: string;
}

/** Match between an Agent call and a session file. */
interface AgentSessionMatch {
	readonly call: AgentCall;
	readonly session: SessionFileInfo;
	readonly deltaMs: number;
}

/** Signature for the session file scanner (injected I/O). */
export type ScanSessionFilesFn = (
	projectDir: string,
	parentSessionId: string,
	linkedSessionIds: ReadonlySet<string>,
	timeRange: { readonly minT: number; readonly maxT: number },
) => readonly SessionFileInfo[];

const MATCH_WINDOW_MS = 15_000; // 15 seconds

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

/**
 * Extract Agent tool PreToolUse events that have no matching SubagentStart.
 * A SubagentStart "matches" if it occurs within 2s of the PreToolUse and shares the agent_type.
 */
export const extractUnlinkedAgentCalls = (
	events: readonly StoredEvent[],
	links: readonly LinkEvent[],
): readonly AgentCall[] => {
	const spawns = links.filter(isSpawnLink);

	const agentPreToolUses = events.filter(
		(e) => e.event === "PreToolUse" && e.data?.tool_name === "Agent",
	);

	return agentPreToolUses.flatMap((e): readonly AgentCall[] => {
		const rawInput: unknown = e.data?.tool_input ?? {};
		const toolInput = typeof rawInput === "object" && rawInput !== null ? rawInput as Readonly<Record<string, unknown>> : {};
		const name = typeof toolInput.name === "string" ? toolInput.name : "";
		const agentType = typeof toolInput.subagent_type === "string" ? toolInput.subagent_type : "";
		const description = typeof toolInput.description === "string" ? toolInput.description : "";

		if (!name && !agentType) return [];

		// Check if a SubagentStart exists within 2s with matching agent_type
		const hasMatchingSpawn = spawns.some(
			(s) => Math.abs(s.t - e.t) < 2000 && s.agent_type === agentType,
		);

		return hasMatchingSpawn ? [] : [{ t: e.t, name, agentType, description }];
	});
};

/**
 * Match unlinked Agent calls to candidate session files by timestamp proximity.
 * For each call, finds the session whose startT is closest and within MATCH_WINDOW_MS.
 * Handles duplicate agent names by matching sequentially (second call -> second candidate).
 */
export const matchAgentCallsToSessions = (
	calls: readonly AgentCall[],
	candidates: readonly SessionFileInfo[],
): readonly AgentSessionMatch[] => {
	// Sort calls by timestamp for sequential matching
	const sortedCalls = [...calls].sort((a, b) => a.t - b.t);

	// Use reduce to accumulate matches without mutation
	const { matches } = sortedCalls.reduce<{
		readonly matches: readonly AgentSessionMatch[];
		readonly claimed: ReadonlySet<string>;
	}>(
		(acc, call) => {
			// Find candidates whose startT is within window AFTER the call
			const eligible = candidates
				.filter((c) => !acc.claimed.has(c.sessionId))
				.filter((c) => c.startT >= call.t && c.startT - call.t <= MATCH_WINDOW_MS)
				.sort((a, b) => (a.startT - call.t) - (b.startT - call.t));

			const best = eligible[0];
			if (!best) return acc;

			return {
				matches: [...acc.matches, { call, session: best, deltaMs: best.startT - call.t }],
				claimed: new Set([...acc.claimed, best.sessionId]),
			};
		},
		{ matches: [], claimed: new Set<string>() },
	);

	return matches;
};

/**
 * Generate synthetic SpawnLink and StopLink events from matched Agent calls.
 */
export const buildSyntheticLinks = (
	matches: readonly AgentSessionMatch[],
	parentSessionId: string,
): { readonly spawns: readonly SpawnLink[]; readonly stops: readonly StopLink[] } => {
	const spawns: readonly SpawnLink[] = matches.map((m) => ({
		t: m.call.t,
		type: "spawn" as const,
		parent_session: parentSessionId,
		agent_id: m.session.sessionId,
		agent_type: m.call.agentType,
		agent_name: m.call.name !== "" ? m.call.name : undefined,
		synthetic: true,
	}));

	const stops: readonly StopLink[] = matches.flatMap((m): readonly StopLink[] => {
		if (m.session.endT === undefined) return [];
		return [{
			t: m.session.endT,
			type: "stop" as const,
			parent_session: parentSessionId,
			agent_id: m.session.sessionId,
			synthetic: true,
		}];
	});

	return { spawns, stops };
};

/**
 * Main entry point: synthesize spawn/stop links for background sub-agents.
 * Pure orchestration — I/O is performed by the injected scanFn.
 */
export const synthesizeSpawnLinks = (
	events: readonly StoredEvent[],
	existingLinks: readonly LinkEvent[],
	projectDir: string,
	sessionId: string,
	scanFn: ScanSessionFilesFn,
): { readonly spawns: readonly SpawnLink[]; readonly stops: readonly StopLink[] } => {
	const unlinkedCalls = extractUnlinkedAgentCalls(events, existingLinks);
	if (unlinkedCalls.length === 0) return { spawns: [], stops: [] };

	// Build set of already-linked session IDs
	const linkedIds = new Set(
		existingLinks.filter(isSpawnLink).map((s) => s.agent_id),
	);

	// Determine parent session time range from events
	const timestamps = events.map((e) => e.t);
	const minT = timestamps.length > 0 ? timestamps.reduce((a, b) => (a < b ? a : b)) : 0;
	const maxT = timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : 0;
	if (minT === 0 && maxT === 0) return { spawns: [], stops: [] };

	const candidates = scanFn(projectDir, sessionId, linkedIds, { minT, maxT });
	if (candidates.length === 0) return { spawns: [], stops: [] };

	const matches = matchAgentCallsToSessions(unlinkedCalls, candidates);
	if (matches.length === 0) return { spawns: [], stops: [] };

	return buildSyntheticLinks(matches, sessionId);
};

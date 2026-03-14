// Synthesize SpawnLink/StopLink events for background sub-agents
// that don't fire SubagentStart/SubagentStop hook events.
// Matches by timestamp correlation between Agent tool calls and session files.

import { readdirSync, readFileSync } from "node:fs";
import type { LinkEvent, SpawnLink, StopLink, StoredEvent } from "../types";

/** Metadata from scanning a session file (first + last line only). */
interface SessionFileInfo {
	readonly sessionId: string;
	readonly startT: number;
	readonly endT: number | undefined;
}

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
 * Parse first and last line of a session file to extract timestamp metadata.
 * Returns undefined if the file cannot be parsed or doesn't start with SessionStart.
 */
const parseSessionFile = (
	filePath: string,
	timeRange: { readonly minT: number; readonly maxT: number },
): { readonly startT: number; readonly endT: number | undefined } | undefined => {
	try {
		const content = readFileSync(filePath, "utf-8");
		const firstNewline = content.indexOf("\n");
		const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);

		const firstEvent: unknown = JSON.parse(firstLine);
		if (!firstEvent || typeof firstEvent !== "object" || !("event" in firstEvent) || !("t" in firstEvent)) return undefined;
		const { event, t: rawT } = firstEvent as { event: unknown; t: unknown };
		if (event !== "SessionStart" || typeof rawT !== "number") return undefined;

		const startT = rawT;

		// Filter: session must have started within parent's time range
		if (startT < timeRange.minT || startT > timeRange.maxT) return undefined;

		// Read last line for endT
		const trimmed = content.trimEnd();
		const lastNewline = trimmed.lastIndexOf("\n");
		const lastLine = lastNewline === -1 ? trimmed : trimmed.slice(lastNewline + 1);
		const lastEvent: unknown = JSON.parse(lastLine);
		const endT = lastEvent && typeof lastEvent === "object" && "t" in lastEvent && typeof (lastEvent as { t: unknown }).t === "number"
			? (lastEvent as { t: number }).t
			: undefined;

		return { startT, endT };
	} catch {
		return undefined;
	}
};

/**
 * Scan session files in .clens/sessions/ for timestamp metadata.
 * Reads only the first and last lines of each file for performance.
 * Filters to sessions that started within the parent session's time range.
 */
export const scanSessionFiles = (
	projectDir: string,
	parentSessionId: string,
	linkedSessionIds: ReadonlySet<string>,
	timeRange: { readonly minT: number; readonly maxT: number },
): readonly SessionFileInfo[] => {
	const sessionsDir = `${projectDir}/.clens/sessions`;

	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter(
				(f) => f.endsWith(".jsonl") && f !== "_links.jsonl",
			);
		} catch {
			return [];
		}
	})();

	return files.flatMap((file): readonly SessionFileInfo[] => {
		const sessionId = file.replace(".jsonl", "");

		// Skip parent session and already-linked sessions
		if (sessionId === parentSessionId || linkedSessionIds.has(sessionId)) return [];

		const parsed = parseSessionFile(`${sessionsDir}/${file}`, timeRange);
		if (!parsed) return [];

		return [{ sessionId, startT: parsed.startT, endT: parsed.endT }];
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
 * Pure orchestration of the above functions.
 */
export const synthesizeSpawnLinks = (
	events: readonly StoredEvent[],
	existingLinks: readonly LinkEvent[],
	projectDir: string,
	sessionId: string,
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

	const candidates = scanSessionFiles(projectDir, sessionId, linkedIds, { minT, maxT });
	if (candidates.length === 0) return { spawns: [], stops: [] };

	const matches = matchAgentCallsToSessions(unlinkedCalls, candidates);
	if (matches.length === 0) return { spawns: [], stops: [] };

	return buildSyntheticLinks(matches, sessionId);
};

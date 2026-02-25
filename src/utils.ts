import { appendFileSync, mkdirSync } from "node:fs";
import type { AgentNode, LinkEvent, SpawnLink, StoredEvent } from "./types";
import { BROADCAST_EVENTS } from "./types";

export const IDLE_THRESHOLD_MS = 300_000;

export interface EffectiveDuration {
	readonly effective_duration_ms: number;
	readonly idle_gaps_ms: number;
	readonly effective_end_t: number;
	readonly wall_duration_ms: number;
}

export const computeEffectiveDuration = (
	timestamps: readonly number[],
	idleThresholdMs: number = IDLE_THRESHOLD_MS,
): EffectiveDuration => {
	if (timestamps.length === 0) return { effective_duration_ms: 0, idle_gaps_ms: 0, effective_end_t: 0, wall_duration_ms: 0 };
	if (timestamps.length === 1) return { effective_duration_ms: 0, idle_gaps_ms: 0, effective_end_t: timestamps[0], wall_duration_ms: 0 };

	const sorted = [...timestamps].sort((a, b) => a - b);
	const wall_duration_ms = sorted[sorted.length - 1] - sorted[0];

	const idle_gaps_ms = sorted.slice(1).reduce((acc, t, i) => {
		const gap = t - sorted[i];
		return gap > idleThresholdMs ? acc + gap : acc;
	}, 0);

	const effective_end_t = sorted.reduceRight((end, t, i) => {
		if (i === sorted.length - 1) return t;
		const gap = sorted[i + 1] - t;
		return gap > idleThresholdMs ? t : end;
	}, sorted[sorted.length - 1]);

	return {
		effective_duration_ms: Math.max(0, wall_duration_ms - idle_gaps_ms),
		idle_gaps_ms,
		effective_end_t,
		wall_duration_ms,
	};
};

/** Deduplicate spawn links by agent_id (resumed agents create multiple spawn events). */
export const deduplicateSpawns = (spawns: readonly SpawnLink[]): readonly SpawnLink[] =>
	spawns.reduce<readonly SpawnLink[]>((acc, spawn) =>
		acc.some((s) => s.agent_id === spawn.agent_id) ? acc : [...acc, spawn],
	[]);

/**
 * Recursively flatten an agent tree into a flat array of AgentNode.
 */
export const flattenAgents = (agents: readonly AgentNode[]): readonly AgentNode[] =>
	agents.flatMap((a) => [a, ...flattenAgents(a.children ?? [])]);

/**
 * Detect whether a string looks like a raw hex UUID (16+ hex chars, no dashes).
 */
export const isUuidLike = (s: string): boolean => /^[0-9a-f]{16,}$/i.test(s);

/**
 * Return a human-friendly agent name. Falls back to 8-char truncated ID if the
 * raw name is undefined, empty, or looks like a UUID.
 */
export const sanitizeAgentName = (
	rawName: string | undefined,
	agentId: string,
): string =>
	rawName && !isUuidLike(rawName) ? rawName : agentId.slice(0, 8);

/** Find the last event that is not a broadcast/noise event. Falls back to last event if all are broadcast. */
export const findLastMeaningfulEvent = (events: readonly StoredEvent[]): StoredEvent | undefined =>
	events.findLast((e) => !BROADCAST_EVENTS.has(e.event)) ?? events[events.length - 1];

/** Check whether every event in the array is a broadcast event (ghost session). */
export const isGhostSession = (events: readonly StoredEvent[]): boolean =>
	events.length > 0 && events.every((e) => BROADCAST_EVENTS.has(e.event));

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Compact date for list/table views: "Feb 24 12:30" */
export const formatSessionDate = (ms: number): string => {
	const d = new Date(ms);
	const mon = MONTH_NAMES[d.getMonth()];
	const day = d.getDate();
	const h = d.getHours();
	const m = String(d.getMinutes()).padStart(2, "0");
	return `${mon} ${day} ${h}:${m}`;
};

/** Full date for detail/report views: "Feb 24, 2026 at 12:30 PM" */
export const formatSessionDateFull = (ms: number): string => {
	const d = new Date(ms);
	const mon = MONTH_NAMES[d.getMonth()];
	const day = d.getDate();
	const year = d.getFullYear();
	const hours = d.getHours();
	const ampm = hours >= 12 ? "PM" : "AM";
	const h12 = hours % 12 || 12;
	const m = String(d.getMinutes()).padStart(2, "0");
	return `${mon} ${day}, ${year} at ${h12}:${m} ${ampm}`;
};

export const formatDuration = (ms: number): string => {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const remainMin = minutes % 60;
	return `${hours}h${remainMin}m`;
};

export const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
};

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

export const buildNameMap = (links: readonly LinkEvent[]): ReadonlyMap<string, string> => {
	const uniqueSpawns = deduplicateSpawns(links.filter(isSpawnLink));
	const entries: readonly (readonly [string, string])[] = uniqueSpawns
		.map((s) => [s.agent_id, s.agent_name ?? s.agent_type] as const);
	return new Map(entries);
};

export const resolveName = (id: string, nameMap: ReadonlyMap<string, string>): string =>
	nameMap.get(id) ?? id;

export const resolveId = (name: string, nameMap: ReadonlyMap<string, string>): string =>
	[...nameMap].find(([, n]) => n === name)?.[0] ?? name;

export const buildReverseNameMap = (nameMap: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
	new Map([...nameMap].map(([id, name]) => [name, id]));

/**
 * Resolve the parent session for a given agent name or id by searching spawn links.
 * Returns { id, name } of the parent, falling back to "leader" when no spawn match is found.
 */
export const resolveParentSession = (
	agentNameOrId: string,
	spawns: readonly SpawnLink[],
	nameMap?: ReadonlyMap<string, string>,
): { readonly id: string; readonly name: string } => {
	const spawn = spawns.find(
		(s) => s.agent_name === agentNameOrId || s.agent_id === agentNameOrId,
	);
	if (spawn) {
		const parentName = nameMap ? resolveName(spawn.parent_session, nameMap) : spawn.parent_session;
		return { id: spawn.parent_session, name: parentName };
	}
	return { id: "leader", name: "leader" };
};

/**
 * Filter link events to only those belonging to a specific session and its descendants.
 *
 * Step 1: Build agent ID set by recursively walking SpawnLink.parent_session chains.
 * Step 2: Build agent name set from spawn links matching the agent ID set.
 * Step 3: Filter each link type by matching against ID set or name set.
 *
 * Known limitation: `task_complete` and `teammate_idle` use agent names not UUIDs,
 * so name collisions across sessions cannot be fully resolved.
 */
export const filterLinksForSession = (
	sessionId: string,
	links: readonly LinkEvent[],
): readonly LinkEvent[] => {
	const spawns = links.filter(isSpawnLink);

	// Step 1: Build agent ID set via fixed-point recursion over spawn chains
	const expandAgentIds = (ids: ReadonlySet<string>): ReadonlySet<string> => {
		const nextIds = new Set([
			...ids,
			...spawns
				.filter((s) => ids.has(s.parent_session))
				.map((s) => s.agent_id),
		]);
		return nextIds.size === ids.size ? ids : expandAgentIds(nextIds);
	};

	const agentIds = expandAgentIds(new Set([sessionId]));

	// Step 2: Build agent name set from spawn links whose agent_id is in the ID set
	const agentNames: ReadonlySet<string> = new Set(
		spawns
			.filter((s): s is SpawnLink & { agent_name: string } => agentIds.has(s.agent_id) && s.agent_name !== undefined)
			.map((s) => s.agent_name),
	);

	// Step 3: Filter each link type
	const matchesLink = (link: LinkEvent): boolean => {
		switch (link.type) {
			case "spawn":
				return agentIds.has(link.parent_session) || agentIds.has(link.agent_id);
			case "stop":
				return agentIds.has(link.agent_id);
			case "msg_send":
				return agentIds.has(link.from) || agentIds.has(link.session_id) || agentNames.has(link.to);
			case "task":
				return agentIds.has(link.session_id);
			case "task_complete":
				return (link.session_id !== undefined && agentIds.has(link.session_id)) || agentNames.has(link.agent);
			case "teammate_idle":
				return (link.session_id !== undefined && agentIds.has(link.session_id)) || agentNames.has(link.teammate);
			case "team":
				return agentIds.has(link.leader_session);
			case "session_end":
				return agentIds.has(link.session);
			case "config_change":
				return agentIds.has(link.session);
			case "worktree_create":
				return agentIds.has(link.session);
			case "worktree_remove":
				return agentIds.has(link.session);
		}
	};

	return links.filter(matchesLink);
};

/**
 * Log an error to `.clens/errors.log` with timestamp and context.
 * Uses sync I/O to be safe in hook context. Silently no-ops if logging itself fails.
 */
export const logError = (
	projectDir: string,
	context: string,
	err: unknown,
): void => {
	try {
		const clensDir = `${projectDir}/.clens`;
		mkdirSync(clensDir, { recursive: true });
		const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
		const stack = err instanceof Error && err.stack
			? err.stack.split("\n").slice(0, 3).join("\n  ")
			: "no stack";
		appendFileSync(
			`${clensDir}/errors.log`,
			`${new Date().toISOString()} [${context}] ${message}\n  stack: ${stack}\n`,
		);
	} catch {
		// Even error logging failed — truly silent
	}
};

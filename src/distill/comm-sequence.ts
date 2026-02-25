import type {
	AgentLifetime,
	CommunicationSequenceEntry,
	ConversationGroup,
	LinkEvent,
	MessageLink,
	SpawnLink,
	StopLink,
	TaskCompleteLink,
	TeammateIdleLink,
} from "../types";
import { resolveName, resolveId, resolveParentSession, sanitizeAgentName } from "../utils";

const MAX_ENTRIES = 500;
const PREVIEW_LENGTH = 120;

const isMessageLink = (link: LinkEvent): link is MessageLink => link.type === "msg_send";
const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";
const isStopLink = (link: LinkEvent): link is StopLink => link.type === "stop";
const isTaskCompleteLink = (link: LinkEvent): link is TaskCompleteLink => link.type === "task_complete";
const isTeammateIdleLink = (link: LinkEvent): link is TeammateIdleLink => link.type === "teammate_idle";

const truncate = (s: string, max: number): string =>
	s.length <= max ? s : `${s.slice(0, max)}…`;

const conversationKey = (a: string, b: string): string =>
	a < b ? `${a}::${b}` : `${b}::${a}`;

/**
 * Build sequence entries from msg_send links.
 */
const messageEntries = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly CommunicationSequenceEntry[] =>
	links.filter(isMessageLink).map((msg): CommunicationSequenceEntry => {
		const from_id = msg.from;
		const from_name = msg.from_name ?? (nameMap ? resolveName(msg.from, nameMap) : msg.from);
		const to_name = nameMap ? resolveName(msg.to, nameMap) : msg.to;
		const to_id = msg.to_id ?? (nameMap ? resolveId(msg.to, nameMap) : msg.to);

		return {
			t: msg.t,
			from_id,
			from_name,
			to_id,
			to_name,
			from: from_name,
			to: to_name,
			msg_type: msg.msg_type,
			edge_type: "message",
			...(msg.summary ? { summary: truncate(msg.summary, PREVIEW_LENGTH) } : {}),
			...(msg.content_hash ? { content_preview: msg.content_hash } : {}),
		};
	});

/**
 * Build sequence entries from task_complete links.
 */
const taskCompleteEntries = (
	links: readonly LinkEvent[],
	spawns: readonly SpawnLink[],
	nameMap?: ReadonlyMap<string, string>,
): readonly CommunicationSequenceEntry[] =>
	links.filter(isTaskCompleteLink).map((tc): CommunicationSequenceEntry => {
		const parent = resolveParentSession(tc.agent, spawns, nameMap);
		const fromName = nameMap ? resolveName(tc.agent, nameMap) : tc.agent;
		const fromId = nameMap ? resolveId(tc.agent, nameMap) : tc.agent;
		return {
			t: tc.t,
			from_id: fromId,
			from_name: fromName,
			to_id: parent.id,
			to_name: parent.name,
			from: fromName,
			to: parent.name,
			msg_type: "task_complete",
			edge_type: "task_complete",
			...(tc.subject ? { summary: truncate(tc.subject, PREVIEW_LENGTH) } : {}),
		};
	});

/**
 * Build sequence entries from teammate_idle links.
 */
const idleEntries = (
	links: readonly LinkEvent[],
	spawns: readonly SpawnLink[],
	nameMap?: ReadonlyMap<string, string>,
): readonly CommunicationSequenceEntry[] =>
	links.filter(isTeammateIdleLink).map((idle): CommunicationSequenceEntry => {
		const parent = resolveParentSession(idle.teammate, spawns, nameMap);
		const fromName = nameMap ? resolveName(idle.teammate, nameMap) : idle.teammate;
		const fromId = nameMap ? resolveId(idle.teammate, nameMap) : idle.teammate;
		return {
			t: idle.t,
			from_id: fromId,
			from_name: fromName,
			to_id: parent.id,
			to_name: parent.name,
			from: fromName,
			to: parent.name,
			msg_type: "teammate_idle",
			edge_type: "idle_notify",
		};
	});

/**
 * Ordered list of all inter-agent communication entries (messages + task completions + idle),
 * capped at MAX_ENTRIES.
 */
export const extractCommSequence = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly CommunicationSequenceEntry[] => {
	const spawns = links.filter(isSpawnLink);

	const allEntries: readonly CommunicationSequenceEntry[] = [
		...messageEntries(links, nameMap),
		...taskCompleteEntries(links, spawns, nameMap),
		...idleEntries(links, spawns, nameMap),
	];

	if (allEntries.length === 0) return [];

	const sorted = [...allEntries].sort((a, b) => a.t - b.t);

	return sorted.slice(0, MAX_ENTRIES);
};

/**
 * Groups a communication sequence into conversations between the same pair of agents.
 * Sequential messages between the same pair are grouped together.
 */
export const groupByConversation = (
	sequence: readonly CommunicationSequenceEntry[],
): readonly ConversationGroup[] => {
	if (sequence.length === 0) return [];

	// Walk through the sorted sequence, accumulating groups where the participant pair stays the same.
	const { groups, current } = sequence.reduce<{
		readonly groups: readonly ConversationGroup[];
		readonly current: {
			readonly key: string;
			readonly participants: readonly [string, string];
			readonly messages: readonly CommunicationSequenceEntry[];
		} | null;
	}>(
		(acc, entry) => {
			const key = conversationKey(entry.from, entry.to);

			if (acc.current && acc.current.key === key) {
				return {
					groups: acc.groups,
					current: {
						...acc.current,
						messages: [...acc.current.messages, entry],
					},
				};
			}

			const participants: readonly [string, string] =
				entry.from < entry.to
					? [entry.from, entry.to]
					: [entry.to, entry.from];

			const newCurrent = {
				key,
				participants,
				messages: [entry] as readonly CommunicationSequenceEntry[],
			};

			return acc.current
				? {
						groups: [
							...acc.groups,
							{ participants: acc.current.participants, messages: acc.current.messages },
						],
						current: newCurrent,
					}
				: { groups: acc.groups, current: newCurrent };
		},
		{ groups: [], current: null },
	);

	return current
		? [...groups, { participants: current.participants, messages: current.messages }]
		: groups;
};

/**
 * Infer agent lifetimes from communication activity when no spawn links exist.
 * Uses msg_send, task, task_complete, teammate_idle timestamps per agent name.
 */
const inferLifetimesFromComms = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly AgentLifetime[] => {
	// Collect unique agent names from nameMap or from message recipients
	const agentNames = nameMap
		? [...new Set(nameMap.values())]
		: [...new Set(links.filter(isMessageLink).map((msg) => msg.to))];

	if (agentNames.length === 0) return [];

	// Reverse lookup: name → id
	const nameToId = nameMap
		? new Map([...nameMap].map(([id, name]) => [name, id]))
		: new Map<string, string>();

	return agentNames
		.map((agentName): AgentLifetime | undefined => {
			const timestamps: readonly number[] = links.flatMap((link): readonly number[] => {
				if (link.type === "msg_send" && (link.to === agentName || link.from_name === agentName)) return [link.t];
				if (link.type === "task" && link.owner === agentName) return [link.t];
				if (link.type === "task_complete" && link.agent === agentName) return [link.t];
				if (link.type === "teammate_idle" && link.teammate === agentName) return [link.t];
				return [];
			});
			if (timestamps.length === 0) return undefined;

			const agentId = nameToId.get(agentName) ?? agentName;
			return {
				agent_id: agentId,
				agent_name: agentName,
				start_t: Math.min(...timestamps),
				end_t: Math.max(...timestamps),
				agent_type: "builder",
			};
		})
		.filter((l): l is AgentLifetime => l !== undefined)
		.sort((a, b) => a.start_t - b.start_t);
};

/**
 * Extracts agent lifetimes (spawn-to-stop ranges) for swim-lane rendering.
 * When nameMap is provided, resolves agent_name from agent_id if not present in spawn data.
 * Falls back to inferring lifetimes from communication activity when no spawns exist.
 */
export const extractAgentLifetimes = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly AgentLifetime[] => {
	const spawns = links.filter(isSpawnLink);
	const stops = links.filter(isStopLink);

	if (spawns.length === 0) return inferLifetimesFromComms(links, nameMap);

	// Build a lookup of agent_id → stop timestamp
	const stopMap: ReadonlyMap<string, number> = new Map(
		stops.map((s) => [s.agent_id, s.t]),
	);

	// Fallback end_t: latest timestamp in all links
	const maxT = links.reduce((max, link) => Math.max(max, link.t), 0);

	const resolveAgentName = (spawn: SpawnLink): string | undefined => {
		const raw = spawn.agent_name ?? (nameMap ? resolveName(spawn.agent_id, nameMap) : undefined);
		return raw ? sanitizeAgentName(raw, spawn.agent_id) : undefined;
	};

	return spawns
		.map((spawn): AgentLifetime => {
			const agent_name = resolveAgentName(spawn);
			return {
				agent_id: spawn.agent_id,
				...(agent_name ? { agent_name } : {}),
				start_t: spawn.t,
				end_t: stopMap.get(spawn.agent_id) ?? maxT,
				agent_type: spawn.agent_type,
			};
		})
		.sort((a, b) => a.start_t - b.start_t);
};

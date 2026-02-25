import type {
	CommunicationEdge,
	CommunicationEdgeType,
	LinkEvent,
	MessageLink,
	SpawnLink,
	TaskCompleteLink,
	TaskLink,
	TeammateIdleLink,
} from "../types";
import { resolveId, resolveName, resolveParentSession } from "../utils";

const isMessageLink = (link: LinkEvent): link is MessageLink => link.type === "msg_send";
const isTaskCompleteLink = (link: LinkEvent): link is TaskCompleteLink => link.type === "task_complete";
const isTeammateIdleLink = (link: LinkEvent): link is TeammateIdleLink => link.type === "teammate_idle";
const isTaskLink = (link: LinkEvent): link is TaskLink => link.type === "task";
const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

interface RawEdge {
	readonly from_id: string;
	readonly from_name: string;
	readonly to_id: string;
	readonly to_name: string;
	readonly edge_type: CommunicationEdgeType;
	readonly msg_type: string;
}

const edgeKey = (from: string, to: string, edgeType: CommunicationEdgeType): string =>
	`${from}::${to}::${edgeType}`;

/**
 * Build message edges from msg_send links (original behavior).
 */
const buildMessageEdges = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly RawEdge[] =>
	links.filter(isMessageLink).map((msg): RawEdge => ({
		from_id: msg.from,
		from_name: msg.from_name ?? (nameMap ? resolveName(msg.from, nameMap) : msg.from),
		to_id: msg.to_id ?? (nameMap ? resolveId(msg.to, nameMap) : msg.to),
		to_name: nameMap ? resolveName(msg.to, nameMap) : msg.to,
		edge_type: "message",
		msg_type: msg.msg_type,
	}));

/**
 * Build edges from task_complete links: completer -> parent session.
 */
const buildTaskCompleteEdges = (
	links: readonly LinkEvent[],
	spawns: readonly SpawnLink[],
	nameMap?: ReadonlyMap<string, string>,
): readonly RawEdge[] =>
	links.filter(isTaskCompleteLink).map((tc): RawEdge => {
		const parent = resolveParentSession(tc.agent, spawns, nameMap);
		const fromName = nameMap ? resolveName(tc.agent, nameMap) : tc.agent;
		const fromId = nameMap ? resolveId(tc.agent, nameMap) : tc.agent;
		return {
			from_id: fromId,
			from_name: fromName,
			to_id: parent.id,
			to_name: parent.name,
			edge_type: "task_complete",
			msg_type: "task_complete",
		};
	});

/**
 * Build edges from teammate_idle links: idle teammate -> parent session.
 */
const buildIdleEdges = (
	links: readonly LinkEvent[],
	spawns: readonly SpawnLink[],
	nameMap?: ReadonlyMap<string, string>,
): readonly RawEdge[] =>
	links.filter(isTeammateIdleLink).map((idle): RawEdge => {
		const parent = resolveParentSession(idle.teammate, spawns, nameMap);
		const fromName = nameMap ? resolveName(idle.teammate, nameMap) : idle.teammate;
		const fromId = nameMap ? resolveId(idle.teammate, nameMap) : idle.teammate;
		return {
			from_id: fromId,
			from_name: fromName,
			to_id: parent.id,
			to_name: parent.name,
			edge_type: "idle_notify",
			msg_type: "teammate_idle",
		};
	});

/**
 * Build edges from task links with action "assign": assigner -> owner.
 */
const buildTaskAssignEdges = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly RawEdge[] =>
	links
		.filter(isTaskLink)
		.filter((tl) => tl.action === "assign" && tl.owner !== undefined)
		.map((tl): RawEdge => {
			const fromName = tl.agent ?? (nameMap ? resolveName(tl.session_id, nameMap) : tl.session_id);
			const fromId = tl.agent ? (nameMap ? resolveId(tl.agent, nameMap) : tl.agent) : tl.session_id;
			const toName = tl.owner ?? "unknown";
			const toId = nameMap ? resolveId(toName, nameMap) : toName;
			return {
				from_id: fromId,
				from_name: fromName,
				to_id: toId,
				to_name: toName,
				edge_type: "task_assign",
				msg_type: "task_assign",
			};
		});

export const buildCommGraph = (
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly CommunicationEdge[] => {
	const spawns = links.filter(isSpawnLink);

	const allEdges: readonly RawEdge[] = [
		...buildMessageEdges(links, nameMap),
		...buildTaskCompleteEdges(links, spawns, nameMap),
		...buildIdleEdges(links, spawns, nameMap),
		...buildTaskAssignEdges(links, nameMap),
	];

	if (allEdges.length === 0) return [];

	// Group edges by (from_id, to_id, edge_type) — immutable reduce
	const grouped = allEdges.reduce<ReadonlyMap<string, readonly RawEdge[]>>((acc, edge) => {
		const key = edgeKey(edge.from_id, edge.to_id, edge.edge_type);
		const existing = acc.get(key) ?? [];
		return new Map([...acc, [key, [...existing, edge]]]);
	}, new Map());

	return [...grouped.values()]
		.map((edges): CommunicationEdge => {
			const first = edges[0];
			return {
				from_id: first.from_id,
				from_name: first.from_name,
				to_id: first.to_id,
				to_name: first.to_name,
				from: first.from_name,
				to: first.to_name,
				count: edges.length,
				msg_types: [...new Set(edges.map((e) => e.msg_type))].sort(),
				edge_type: first.edge_type,
			};
		})
		.sort((a, b) => b.count - a.count);
};

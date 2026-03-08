import type {
	AgentCommunicationPartner,
	AgentIdlePeriod,
	AgentMessage,
	AgentNode,
	AgentTaskEvent,
	LinkEvent,
	MessageLink,
	SpawnLink,
	TaskCompleteLink,
	TaskLink,
	TeammateIdleLink,
} from "../types";
import { resolveName } from "../utils";

// --- Type guards ---

const isMessageLink = (link: LinkEvent): link is MessageLink => link.type === "msg_send";

const isTaskLink = (link: LinkEvent): link is TaskLink => link.type === "task";

const isTaskCompleteLink = (link: LinkEvent): link is TaskCompleteLink => link.type === "task_complete";

const isTeammateIdleLink = (link: LinkEvent): link is TeammateIdleLink => link.type === "teammate_idle";

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

// --- Internal helpers ---

/** Resolve agent name from spawn links in the same link set. */
const resolveAgentName = (agentId: string, links: readonly LinkEvent[]): string | undefined =>
	links.filter(isSpawnLink).find((s) => s.agent_id === agentId)?.agent_name;

// --- Public extractors ---

/** Extract all messages sent by or received by a specific agent, sorted chronologically. */
export const extractAgentMessages = (
	agentId: string,
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly AgentMessage[] =>
	links
		.filter(isMessageLink)
		.filter((msg) => msg.from === agentId || msg.to === agentId)
		.map((msg): AgentMessage => {
			const isSent = msg.from === agentId;
			const partnerId = isSent ? msg.to : msg.from;
			const partner = nameMap ? resolveName(partnerId, nameMap) : partnerId;
			return {
				t: msg.t,
				direction: isSent ? "sent" : "received",
				partner,
				msg_type: msg.msg_type,
				...(msg.summary ? { summary: msg.summary } : {}),
			};
		})
		.sort((a, b) => a.t - b.t);

/**
 * Extract all task events (create, assign, status_change, complete) associated with a specific agent.
 * Matches by session_id on TaskLink and by resolved agent name on TaskCompleteLink.
 */
export const extractAgentTasks = (
	agentId: string,
	links: readonly LinkEvent[],
): readonly AgentTaskEvent[] => {
	const agentName = resolveAgentName(agentId, links);

	const taskActions: readonly AgentTaskEvent[] = links
		.filter(isTaskLink)
		.filter(
			(tl) =>
				tl.session_id === agentId ||
				(agentName !== undefined && (tl.owner === agentName || tl.agent === agentName)),
		)
		.map(
			(tl): AgentTaskEvent => ({
				t: tl.t,
				action: tl.action,
				task_id: tl.task_id,
				...(tl.subject ? { subject: tl.subject } : {}),
				...(tl.status ? { status: tl.status } : {}),
				...(tl.owner ? { owner: tl.owner } : {}),
			}),
		);

	const completions: readonly AgentTaskEvent[] =
		agentName !== undefined
			? links
					.filter(isTaskCompleteLink)
					.filter((tc) => tc.agent === agentName)
					.map(
						(tc): AgentTaskEvent => ({
							t: tc.t,
							action: "complete",
							task_id: tc.task_id,
							...(tc.subject ? { subject: tc.subject } : {}),
						}),
					)
			: [];

	return [...taskActions, ...completions].sort((a, b) => a.t - b.t);
};

/** Extract idle transition timestamps for a specific agent. */
export const extractAgentIdlePeriods = (
	agentId: string,
	links: readonly LinkEvent[],
): readonly AgentIdlePeriod[] => {
	const agentName = resolveAgentName(agentId, links);

	return agentName !== undefined
		? links
				.filter(isTeammateIdleLink)
				.filter((idle) => idle.teammate === agentName)
				.map(
					(idle): AgentIdlePeriod => ({
						t: idle.t,
						teammate: idle.teammate,
					}),
				)
		: [];
};

/**
 * Extract communication partners for a specific agent with message counts and types.
 * Returns partners sorted by total message count (descending).
 */
export const extractAgentCommunicationPartners = (
	agentId: string,
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): readonly AgentCommunicationPartner[] => {
	const agentMessages = links
		.filter(isMessageLink)
		.filter((msg) => msg.from === agentId || msg.to === agentId);

	if (agentMessages.length === 0) return [];

	const partnerIds = [...new Set(agentMessages.map((msg) => (msg.from === agentId ? msg.to : msg.from)))];

	return partnerIds
		.map((partnerId): AgentCommunicationPartner => {
			const sent = agentMessages.filter((msg) => msg.from === agentId && msg.to === partnerId);
			const received = agentMessages.filter((msg) => msg.from === partnerId && msg.to === agentId);
			const allMsgs = [...sent, ...received];
			const msgTypes = [...new Set(allMsgs.map((m) => m.msg_type))].sort();

			return {
				name: nameMap ? resolveName(partnerId, nameMap) : partnerId,
				sent_count: sent.length,
				received_count: received.length,
				total_count: allMsgs.length,
				msg_types: msgTypes,
			};
		})
		.sort((a, b) => b.total_count - a.total_count);
};

/** Enrich an AgentNode with link-based data (messages, tasks, idle, partners). Pure. */
export const enrichNodeWithLinks = (
	node: AgentNode,
	links: readonly LinkEvent[],
	nameMap?: ReadonlyMap<string, string>,
): AgentNode => {
	const messages = extractAgentMessages(node.session_id, links, nameMap);
	const taskEvents = extractAgentTasks(node.session_id, links);
	const idlePeriods = extractAgentIdlePeriods(node.session_id, links);
	const communicationPartners = extractAgentCommunicationPartners(node.session_id, links, nameMap);

	const enrichedChildren = node.children.map((child) => enrichNodeWithLinks(child, links, nameMap));

	return {
		...node,
		children: enrichedChildren,
		...(messages.length > 0 ? { messages } : {}),
		...(taskEvents.length > 0 ? { task_events: taskEvents } : {}),
		...(idlePeriods.length > 0 ? { idle_periods: idlePeriods } : {}),
		...(communicationPartners.length > 0 ? { communication_partners: communicationPartners } : {}),
	};
};

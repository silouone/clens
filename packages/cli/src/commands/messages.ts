import { readLinks } from "../session/read";
import type { LinkEvent, MessageLink, SpawnLink, TaskCompleteLink, TaskLink, TeammateIdleLink } from "../types";
import { filterLinksForSession, sanitizeAgentName } from "../utils";

type CoordinationLink = MessageLink | TeammateIdleLink | TaskCompleteLink | SpawnLink | TaskLink;

const TIME_GROUP_GAP_MS = 30_000; // 30 seconds

const isCoordinationLink = (l: LinkEvent): l is CoordinationLink =>
	l.type === "msg_send" ||
	l.type === "teammate_idle" ||
	l.type === "task_complete" ||
	l.type === "spawn" ||
	(l.type === "task" && l.action === "assign" && typeof l.subject === "string" && l.subject.length > 0);

export const getMessagesData = (
	sessionId: string,
	projectDir: string,
): readonly CoordinationLink[] => {
	const links = readLinks(projectDir);

	if (links.length === 0) return [];

	const sessionLinks = filterLinksForSession(sessionId, links);
	return sessionLinks
		.filter(isCoordinationLink)
		.sort((a, b) => a.t - b.t);
};

const formatLink = (link: CoordinationLink): string => {
	const time = new Date(link.t).toLocaleTimeString("en-US", { hour12: false });
	switch (link.type) {
		case "msg_send": {
			const summary = link.summary ? `"${link.summary}"` : `[${link.msg_type}]`;
			const fromName = sanitizeAgentName(link.from, link.from);
			const toName = sanitizeAgentName(link.to, link.to);
			return `${time}  ${fromName.padEnd(16)}→ ${toName.padEnd(16)}${summary}`;
		}
		case "teammate_idle":
			return `${time}  ${link.teammate.padEnd(14)}   [idle]`;
		case "task_complete":
			return `${time}  ${link.agent.padEnd(14)}   completed: ${link.subject ?? link.task_id}`;
		case "spawn":
			return `${time}  [spawn] ${link.agent_name ?? link.agent_type} (${link.agent_type})`;
		case "task":
			return `${time}  [assign] ${link.owner ?? "?"} ← "${link.subject}"`;
	}
};

/** Insert blank lines between groups separated by > 30s gaps. */
const groupByTimeWindows = (links: readonly CoordinationLink[]): string => {
	if (links.length === 0) return "";

	const result = links.reduce<readonly string[]>((acc, link, idx) => {
		const line = formatLink(link);
		if (idx === 0) return [line];
		const gap = link.t - links[idx - 1].t;
		return gap > TIME_GROUP_GAP_MS ? [...acc, "", line] : [...acc, line];
	}, []);

	return result.join("\n");
};

export const renderMessages = (sessionId: string, projectDir: string): string => {
	const coordinationLinks = getMessagesData(sessionId, projectDir);

	if (coordinationLinks.length === 0) {
		const links = readLinks(projectDir);
		if (links.length === 0) {
			return "No inter-agent data found (_links.jsonl missing).";
		}
		return "No inter-agent messages found.";
	}

	return groupByTimeWindows(coordinationLinks);
};

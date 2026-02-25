import { readLinks } from "../session/read";
import type { MessageLink, TaskCompleteLink, TeammateIdleLink } from "../types";
import { filterLinksForSession, sanitizeAgentName } from "../utils";

type CoordinationLink = MessageLink | TeammateIdleLink | TaskCompleteLink;

export const getMessagesData = (
	sessionId: string,
	projectDir: string,
): readonly CoordinationLink[] => {
	const links = readLinks(projectDir);

	if (links.length === 0) return [];

	const sessionLinks = filterLinksForSession(sessionId, links);
	return sessionLinks
		.filter(
			(l): l is CoordinationLink =>
				l.type === "msg_send" || l.type === "teammate_idle" || l.type === "task_complete",
		)
		.sort((a, b) => a.t - b.t);
};

export const renderMessages = (sessionId: string, projectDir: string): string => {
	const coordinationLinks = getMessagesData(sessionId, projectDir);

	if (coordinationLinks.length === 0) {
		const links = readLinks(projectDir);
		if (links.length === 0) {
			return "No inter-agent data found (_links.jsonl missing).";
		}
		const sessionLinks = filterLinksForSession(sessionId, links);
		const spawnCount = sessionLinks.filter((l) => l.type === "spawn").length;
		const taskCompleteCount = sessionLinks.filter((l) => l.type === "task_complete").length;
		if (spawnCount > 0) {
			return [
				`Session used subagent coordination (${spawnCount} agents, ${taskCompleteCount} task completions).`,
				"No direct messages (SendMessage) detected.",
				"Task-based coordination visible in: clens agents <session-id>",
			].join("\n");
		}
		return "No inter-agent messages found.";
	}

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
		}
	};

	return coordinationLinks.map(formatLink).join("\n");
};


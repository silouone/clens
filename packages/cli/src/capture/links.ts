import { appendFileSync, mkdirSync } from "node:fs";
import type {
	ConfigChangeLink,
	LinkEvent,
	MessageLink,
	SessionEndLink,
	SpawnLink,
	StopLink,
	TaskCompleteLink,
	TaskLink,
	TeamLink,
	TeammateIdleLink,
	WorktreeCreateLink,
	WorktreeRemoveLink,
} from "../types";

const LINK_TOOLS = new Set(["SendMessage", "TaskCreate", "TaskUpdate", "TeamCreate"]);

const ALWAYS_LINK_EVENTS = new Set([
	"SubagentStart",
	"SubagentStop",
	"SessionEnd",
	"TeammateIdle",
	"TaskCompleted",
	"ConfigChange",
	"WorktreeCreate",
	"WorktreeRemove",
]);

export const isLinkEvent = (event: string, input: Record<string, unknown>): boolean => {
	if (ALWAYS_LINK_EVENTS.has(event)) return true;
	if (event === "PreToolUse" && typeof input.tool_name === "string") {
		return LINK_TOOLS.has(input.tool_name);
	}
	return false;
};

export const extractLinkEvent = (event: string, input: Record<string, unknown>): LinkEvent => {
	const t = Date.now();
	const sid = (input.session_id as string) || "unknown";

	switch (event) {
		case "SubagentStart": {
			return {
				t,
				type: "spawn",
				parent_session: sid,
				agent_id: (input.agent_id as string) || "",
				agent_type: (input.agent_type as string) || "",
				agent_name: input.agent_name as string | undefined,
			} satisfies SpawnLink;
		}
		case "SubagentStop": {
			return {
				t,
				type: "stop",
				parent_session: sid,
				agent_id: (input.agent_id as string) || "",
				transcript_path: input.agent_transcript_path as string | undefined,
			} satisfies StopLink;
		}
		case "SessionEnd": {
			return {
				t,
				type: "session_end",
				session: sid,
				reason: input.reason as string | undefined,
			} satisfies SessionEndLink;
		}
		case "TeammateIdle": {
			return {
				t,
				type: "teammate_idle",
				teammate: (input.agent_name as string) || (input.agent_id as string) || "",
				session_id: sid,
				team: input.team_name as string | undefined,
			} satisfies TeammateIdleLink;
		}
		case "TaskCompleted": {
			return {
				t,
				type: "task_complete",
				task_id: (input.task_id as string) || "",
				agent: (input.agent_name as string) || sid,
				session_id: sid,
				subject: input.subject as string | undefined,
			} satisfies TaskCompleteLink;
		}
		case "ConfigChange": {
			return {
				t,
				type: "config_change",
				session: sid,
				key: input.key as string | undefined,
			} satisfies ConfigChangeLink;
		}
		case "WorktreeCreate": {
			return {
				t,
				type: "worktree_create",
				session: sid,
				worktree_name: (input.name as string) || (input.worktree_name as string) || undefined,
				branch: input.branch as string | undefined,
			} satisfies WorktreeCreateLink;
		}
		case "WorktreeRemove": {
			return {
				t,
				type: "worktree_remove",
				session: sid,
				worktree_name: (input.name as string) || (input.worktree_name as string) || undefined,
			} satisfies WorktreeRemoveLink;
		}
		case "PreToolUse": {
			const toolName = input.tool_name as string;
			const toolInput = (input.tool_input || {}) as Record<string, unknown>;

			if (toolName === "SendMessage") {
				return {
					t,
					type: "msg_send",
					msg_id: toolInput.msg_id as string | undefined,
					session_id: sid,
					from: (toolInput.from as string) || sid,
					from_name: (input.agent_name as string) || undefined,
					to: (toolInput.recipient as string) || (toolInput.to as string) || "",
					msg_type: (toolInput.type as string) || "message",
					summary: toolInput.summary as string | undefined,
					content_hash: toolInput.content ? simpleHash(toolInput.content as string) : undefined,
				} satisfies MessageLink;
			}

			if (toolName === "TaskCreate") {
				return {
					t,
					type: "task",
					action: "create",
					task_id: (toolInput.taskId as string) || "",
					session_id: sid,
					agent: sid,
					subject: toolInput.subject as string | undefined,
				} satisfies TaskLink;
			}

			if (toolName === "TaskUpdate") {
				const action = toolInput.status ? ("status_change" as const) : ("assign" as const);
				return {
					t,
					type: "task",
					action,
					task_id: (toolInput.taskId as string) || "",
					session_id: sid,
					agent: sid,
					owner: toolInput.owner as string | undefined,
					status: toolInput.status as string | undefined,
				} satisfies TaskLink;
			}

			if (toolName === "TeamCreate") {
				return {
					t,
					type: "team",
					team_name: (toolInput.team_name as string) || "",
					leader_session: sid,
				} satisfies TeamLink;
			}

			// Fallback (should not reach due to isLinkEvent guard)
			return { t, type: "session_end", session: sid } satisfies SessionEndLink;
		}
		default: {
			return { t, type: "session_end", session: sid } satisfies SessionEndLink;
		}
	}
};

export const appendLink = (projectDir: string, linkEvent: LinkEvent): void => {
	const linksDir = `${projectDir}/.clens/sessions`;
	mkdirSync(linksDir, { recursive: true });
	const linksPath = `${linksDir}/_links.jsonl`;
	appendFileSync(linksPath, `${JSON.stringify(linkEvent)}\n`);
};

const simpleHash = (str: string): string => {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0;
	}
	return hash.toString(16);
};

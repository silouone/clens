// Link event types — single source of truth for runtime + type-level
export const LINK_EVENT_TYPE_VALUES = [
	"spawn",
	"stop",
	"msg_send",
	"task",
	"team",
	"teammate_idle",
	"task_complete",
	"session_end",
	"config_change",
	"worktree_create",
	"worktree_remove",
] as const;

export type LinkEventType = (typeof LINK_EVENT_TYPE_VALUES)[number];

export interface BaseLinkEvent {
	readonly t: number;
	readonly type: LinkEventType;
}

export interface SpawnLink extends BaseLinkEvent {
	readonly type: "spawn";
	readonly parent_session: string;
	readonly agent_id: string;
	readonly agent_type: string;
	readonly agent_name?: string;
}

export interface StopLink extends BaseLinkEvent {
	readonly type: "stop";
	readonly parent_session: string;
	readonly agent_id: string;
	readonly transcript_path?: string;
}

export interface MessageLink extends BaseLinkEvent {
	readonly type: "msg_send";
	readonly msg_id?: string;
	readonly session_id: string;
	readonly from: string;         // session UUID of sender
	readonly from_name?: string;   // agent name of sender
	readonly to: string;           // recipient agent name
	readonly to_id?: string;       // recipient session UUID if resolvable
	readonly msg_type: string;
	readonly summary?: string;
	readonly content_hash?: string;
}

export interface TaskLink extends BaseLinkEvent {
	readonly type: "task";
	readonly action: "create" | "assign" | "status_change";
	readonly task_id: string;
	readonly session_id: string;
	readonly agent?: string;
	readonly subject?: string;
	readonly owner?: string;
	readonly status?: string;
}

export interface TeamLink extends BaseLinkEvent {
	readonly type: "team";
	readonly team_name: string;
	readonly leader_session: string;
}

export interface TeammateIdleLink extends BaseLinkEvent {
	readonly type: "teammate_idle";
	readonly teammate: string;
	readonly session_id?: string;
	readonly team?: string;
}

export interface TaskCompleteLink extends BaseLinkEvent {
	readonly type: "task_complete";
	readonly task_id: string;
	readonly agent: string;
	readonly session_id?: string;
	readonly subject?: string;
}

export interface SessionEndLink extends BaseLinkEvent {
	readonly type: "session_end";
	readonly session: string;
	readonly reason?: string;
}

export interface ConfigChangeLink extends BaseLinkEvent {
	readonly type: "config_change";
	readonly session: string;
	readonly key?: string;
}

export interface WorktreeCreateLink extends BaseLinkEvent {
	readonly type: "worktree_create";
	readonly session: string;
	readonly worktree_name?: string;
	readonly branch?: string;
}

export interface WorktreeRemoveLink extends BaseLinkEvent {
	readonly type: "worktree_remove";
	readonly session: string;
	readonly worktree_name?: string;
}

export type LinkEvent =
	| SpawnLink
	| StopLink
	| MessageLink
	| TaskLink
	| TeamLink
	| TeammateIdleLink
	| TaskCompleteLink
	| SessionEndLink
	| ConfigChangeLink
	| WorktreeCreateLink
	| WorktreeRemoveLink;

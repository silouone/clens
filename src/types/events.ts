// All 17 hook event types
export const HOOK_EVENTS = [
	"SessionStart",
	"SessionEnd",
	"UserPromptSubmit",
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
	"PermissionRequest",
	"Notification",
	"SubagentStart",
	"SubagentStop",
	"Stop",
	"TeammateIdle",
	"TaskCompleted",
	"PreCompact",
	"ConfigChange",
	"WorktreeCreate",
	"WorktreeRemove",
] as const;
export type HookEventType = (typeof HOOK_EVENTS)[number];

/** Event types that Claude Code broadcasts to ALL session files, not just the originating session. */
export const BROADCAST_EVENTS: ReadonlySet<HookEventType> = new Set([
	"ConfigChange",
	"Notification",
] as const);

export interface BaseHookInput {
	readonly session_id: string;
	readonly transcript_path: string;
	readonly cwd: string;
	readonly permission_mode: string;
	readonly hook_event_name: string;
}

export interface ToolEvent extends BaseHookInput {
	readonly tool_name: string;
	readonly tool_input: Readonly<Record<string, unknown>>;
	readonly tool_use_id: string;
}

export interface PostToolEvent extends ToolEvent {
	readonly tool_response: Readonly<Record<string, unknown>>;
}

export interface FailureEvent extends ToolEvent {
	readonly error: string;
	readonly is_interrupt?: boolean;
}

export interface AgentEvent extends BaseHookInput {
	readonly agent_id: string;
	readonly agent_type: string;
	readonly agent_name?: string;
	readonly agent_transcript_path?: string;
	readonly last_assistant_message?: string;
}

export interface SessionStartContext {
	readonly project_dir: string;
	readonly cwd: string;
	readonly git_branch: string | null;
	readonly git_remote: string | null;
	readonly git_commit: string | null;
	readonly git_worktree: string | null;
	readonly team_name: string | null;
	readonly task_list_dir: string | null;
	readonly claude_entrypoint: string | null;
	readonly model: string | null;
	readonly agent_type: string | null;
	readonly source?: "startup" | "resume" | "clear" | "compact";
	readonly trigger?: "manual" | "auto";
}

export interface StoredEvent {
	readonly t: number; // timestamp ms
	readonly event: HookEventType;
	readonly sid: string; // session_id
	readonly context?: SessionStartContext;
	readonly data: Readonly<Record<string, unknown>>;
}

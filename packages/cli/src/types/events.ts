// All 18 hook event types
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
	"InstructionsLoaded",
] as const;
export type HookEventType = (typeof HOOK_EVENTS)[number];

/** Event types that Claude Code broadcasts to ALL session files, not just the originating session. */
export const BROADCAST_EVENTS: ReadonlySet<HookEventType> = new Set([
	"ConfigChange",
	"Notification",
] as const);

/**
 * Active permission posture reported on (almost) every hook payload except
 * SessionStart (`events.ts:34`, availability audit). Closed set per
 * `cc-hooks.md:446`; an unrecognized raw value is dropped at extraction time.
 */
export const PERMISSION_MODES = [
	"default",
	"plan",
	"acceptEdits",
	"dontAsk",
	"bypassPermissions",
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Type guard for a recognized permission mode. */
export const isPermissionMode = (value: unknown): value is PermissionMode =>
	typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);

/**
 * `CLAUDE_CODE_EFFORT_LEVEL` (low/medium/high), present on every tool/stop event
 * (undocumented-but-real per the availability audit). Captured raw in `data` —
 * lifted into typed config by `extractSessionConfig`.
 */
export const EFFORT_LEVELS = ["low", "medium", "high"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Type guard for a recognized effort level. */
export const isEffortLevel = (value: unknown): value is EffortLevel =>
	typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);

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
	/** `CLAUDE_CODE_EFFORT_LEVEL` carried on tool events (raw; may be absent). */
	readonly effort?: string;
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

/** settings.json scope a captured value was resolved from (highest precedence first). */
export type SettingsScope = "managed" | "local" | "project" | "user";

/**
 * Point-in-time snapshot of the resolved `settings.json` config (CFG-3, tier B).
 * Captured once at SessionStart inside `enrichSessionStart` — NEVER on the hot
 * path. Every field is optional; an unset key is simply absent (never fabricated
 * to "default"). `settings_source` distinguishes the SessionStart snapshot from a
 * later distill-time "current" read that may have drifted.
 */
export interface SettingsSnapshot {
	readonly settings_source: "session_start" | "current";
	readonly captured_at: number;
	readonly output_style?: string;
	readonly output_style_scope?: SettingsScope;
	readonly status_line?: { readonly type: string; readonly command_name?: string };
	readonly plugins_enabled?: readonly string[];
	readonly permission_default_mode?: string;
	readonly hooks_configured?: readonly string[];
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
	/** Resolved settings.json snapshot (CFG-3); absent if the read failed/empty. */
	readonly settings_snapshot?: SettingsSnapshot;
}

export interface StoredEvent {
	readonly t: number; // timestamp ms
	readonly event: HookEventType;
	readonly sid: string; // session_id
	readonly context?: SessionStartContext;
	readonly data: Readonly<Record<string, unknown>>;
}

export interface InstructionsLoadedEvent extends BaseHookInput {
	readonly file_path: string;
	readonly memory_type: "User" | "Project" | "Local" | "Managed";
	readonly load_reason: "session_start" | "nested_traversal" | "path_glob_match" | "include";
	readonly globs?: readonly string[];
	readonly trigger_file_path?: string;
	readonly parent_file_path?: string;
}

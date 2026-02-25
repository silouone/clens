import type { HookEventType } from "./events";

// Export types
export interface ExportManifest {
	readonly version: string;
	readonly exported_at: string;
	readonly session_id: string;
	readonly session_name?: string;
	readonly project_dir: string;
	readonly agents: ReadonlyArray<{
		readonly session_id: string;
		readonly agent_type: string;
		readonly agent_name?: string;
		readonly event_count: number;
		readonly duration_ms: number;
	}>;
	readonly tasks?: ReadonlyArray<{
		readonly task_id: string;
		readonly subject: string;
		readonly status: string;
	}>;
	readonly messages_count: number;
	readonly git_branch?: string;
	readonly git_commit?: string;
}

// Config types
export interface DelegatedHooks {
	readonly [eventType: string]: readonly string[];
}

export interface ClensConfig {
	readonly capture: boolean;
	readonly events?: readonly HookEventType[];
}

// Session summary for list command
export interface SessionSummary {
	readonly session_id: string;
	readonly session_name?: string;
	readonly start_time: number;
	readonly end_time?: number;
	readonly duration_ms: number;
	readonly event_count: number;
	readonly git_branch?: string;
	readonly team_name?: string;
	readonly source?: string;
	readonly end_reason?: string;
	readonly status: "complete" | "incomplete";
	readonly file_size_bytes: number;
	readonly agent_count?: number;    // 0 = single-agent, >0 = multi-agent
	readonly is_distilled?: boolean;  // true if .clens/distilled/{sid}.json exists
	readonly has_spec?: boolean;      // true if distilled data has plan_drift
}

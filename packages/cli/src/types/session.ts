import type { FeatureFlag } from "./distill";
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

export type PricingTier = "api" | "max" | "auto";

export interface ClensConfig {
	readonly capture: boolean;
	readonly events?: readonly HookEventType[];
	readonly pricing?: PricingTier;
}

// A session is "complete" only when it ended cleanly (last meaningful event is
// SessionEnd). If it didn't end but its last event is recent it's "active";
// otherwise it's gone quiet and is "idle". See bug B6 (Stop ⇒ complete was wrong).
export const SESSION_STATUSES = ["complete", "active", "idle"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** A session whose last event is older than this is considered idle, not active. */
export const ACTIVE_THRESHOLD_MS = 600_000; // 10 minutes

/**
 * Derive a session's live status from its last event.
 * @param lastEventIsSessionEnd whether the last *meaningful* event is SessionEnd
 * @param lastEventTime epoch ms of the last event
 * @param now epoch ms reference point (injected for testability)
 */
export const deriveSessionStatus = (
	lastEventIsSessionEnd: boolean,
	lastEventTime: number,
	now: number = Date.now(),
): SessionStatus =>
	lastEventIsSessionEnd
		? "complete"
		: now - lastEventTime <= ACTIVE_THRESHOLD_MS
			? "active"
			: "idle";

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
	// "complete" iff last meaningful event is SessionEnd. Otherwise "active" iff
	// the last event is within ACTIVE_THRESHOLD_MS of now, else "idle". A Stop
	// event no longer implies complete — it fires after every turn (bug B6).
	readonly status: SessionStatus;
	readonly file_size_bytes: number;
	readonly agent_count?: number;    // 0 = single-agent, >0 = multi-agent
	readonly is_distilled?: boolean;  // true if .clens/distilled/{sid}.json exists
	readonly has_spec?: boolean;      // true if distilled data has plan_drift
	readonly is_subagent?: boolean;   // true if spawned by another session
	readonly features?: readonly FeatureFlag[]; // harness features used (loop/goal/workflow)
}

// --- Global Config Types ---

/** How --global discovers and groups sessions across the filesystem. */
export type GlobalMode = "repository" | "project";

export interface GlobalConfig {
	readonly global_mode: GlobalMode;
}

// --- Project Registry Types ---

export interface ProjectEntry {
	readonly id: string;        // kebab-case slug, e.g. "agent-observability-project"
	readonly path: string;      // absolute path to project root
	readonly name: string;      // display name (basename of path by default)
	readonly added_at: number;  // timestamp
}

export interface ProjectRegistry {
	readonly version: 1;
	readonly projects: readonly ProjectEntry[];
}

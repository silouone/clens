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

// --- Session naming / color flag types ---

/**
 * Closed palette of session color flags. `none` means unflagged; any other value
 * marks the session as flagged (bookmarked) so it pops out in lists.
 */
export const COLOR_NAMES = ["none", "red", "amber", "green", "blue", "violet", "gray"] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

/** Type guard for a valid color palette value. */
export const isColorName = (value: unknown): value is ColorName =>
	typeof value === "string" && (COLOR_NAMES as readonly string[]).includes(value);

/** Provenance of a session's resolved display name (highest precedence first). */
export type NameSource = "label" | "custom_title" | "computed" | "id";

/**
 * cLens-owned per-session metadata, stored in the `.clens/session-meta.json`
 * sidecar keyed by session id. Independent of raw/distilled artifacts so it
 * survives `clens clean` and re-distill.
 */
export interface SessionMeta {
	readonly label?: string;
	readonly color?: ColorName;
	readonly updated_at: number;
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
	// --- Naming / color flag (resolved at list time, never recomputed by surfaces) ---
	readonly display_name?: string;   // resolved name by precedence (label>custom_title>computed>id)
	readonly name_source?: NameSource; // provenance of display_name
	readonly label?: string;          // user-entered custom label (sidecar), if any
	readonly color?: ColorName;       // user color flag (sidecar); non-"none" = flagged
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

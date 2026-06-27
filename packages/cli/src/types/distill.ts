import type { SessionConfig, SessionSummary } from "./session";
import type { TranscriptReasoning, TranscriptUserMessage } from "./transcript";

// Distill types
export interface StatsResult {
	readonly total_events: number;
	readonly duration_ms: number;
	/** Wall-clock span (last event t - first event t); duration_ms is idle-trimmed. */
	readonly wall_duration_ms?: number;
	readonly events_by_type: Readonly<Record<string, number>>;
	readonly tools_by_name: Readonly<Record<string, number>>;
	readonly tool_call_count: number;
	readonly failure_count: number;
	readonly failure_rate: number;
	readonly unique_files: readonly string[];
	readonly model?: string;
	readonly cost_estimate?: CostEstimate;
	readonly token_usage?: TokenUsage;
	readonly failures_by_tool?: Readonly<Record<string, number>>;
}

export interface BacktrackResult {
	readonly type: "failure_retry" | "iteration_struggle" | "debugging_loop";
	readonly tool_name: string;
	readonly file_path?: string;
	readonly attempts: number;
	readonly start_t: number;
	readonly end_t: number;
	readonly tool_use_ids: readonly string[];
	readonly error_message?: string;
	readonly command?: string;
}

interface BaseDecisionPoint {
	readonly t: number;
}

export interface TimingGapDecision extends BaseDecisionPoint {
	readonly type: "timing_gap";
	readonly gap_ms: number;
	readonly classification: "user_idle" | "session_pause" | "agent_thinking";
}

export interface ToolPivotDecision extends BaseDecisionPoint {
	readonly type: "tool_pivot";
	readonly from_tool: string;
	readonly to_tool: string;
	readonly after_failure: boolean;
}

export interface PhaseBoundaryDecision extends BaseDecisionPoint {
	readonly type: "phase_boundary";
	readonly phase_name: string;
	readonly phase_index: number;
}

/** @deprecated No longer emitted by extractAgentDecisions — kept for backward compatibility. */
export interface AgentSpawnDecision extends BaseDecisionPoint {
	readonly type: "agent_spawn";
	readonly agent_id: string;
	readonly agent_name: string;
	readonly agent_type: string;
	readonly parent_session: string;
}

export interface TaskDelegationDecision extends BaseDecisionPoint {
	readonly type: "task_delegation";
	readonly task_id: string;
	readonly agent_name: string;
	readonly subject?: string;
}

/** @deprecated No longer emitted by extractAgentDecisions — kept for backward compatibility. */
export interface TaskCompletionDecision extends BaseDecisionPoint {
	readonly type: "task_completion";
	readonly task_id: string;
	readonly agent_name: string;
	readonly subject?: string;
}

/** AgentSpawnDecision and TaskCompletionDecision remain in the union for deserialization of previously-distilled data. */
export type DecisionPoint =
	| TimingGapDecision
	| ToolPivotDecision
	| PhaseBoundaryDecision
	| AgentSpawnDecision
	| TaskDelegationDecision
	| TaskCompletionDecision;

export interface FileMapEntry {
	readonly file_path: string;
	readonly reads: number;
	readonly edits: number;
	readonly writes: number;
	readonly errors: number;
	readonly tool_use_ids: readonly string[];
	readonly source?: "tool" | "bash";
}

export interface FileMapResult {
	readonly files: readonly FileMapEntry[];
}

export interface GitDiffHunk {
	readonly commit_hash: string;
	readonly file_path: string;
	readonly additions: number;
	readonly deletions: number;
	readonly matched_tool_use_id?: string;
}

export interface WorkingTreeChange {
	readonly file_path: string;
	readonly status: "modified" | "added" | "deleted" | "renamed";
	readonly additions?: number;
	readonly deletions?: number;
}

export interface GitDiffResult {
	readonly commits: readonly string[];
	readonly hunks: readonly GitDiffHunk[];
	readonly working_tree_changes?: readonly WorkingTreeChange[];
	readonly staged_changes?: readonly WorkingTreeChange[];
}

export interface PhaseInfo {
	readonly name: string;
	readonly start_t: number;
	readonly end_t: number;
	readonly tool_types: readonly string[];
	readonly description: string;
}

export interface DistilledSummary {
	readonly narrative: string;
	readonly phases: readonly PhaseInfo[];
	readonly key_metrics: {
		readonly duration_human: string;
		readonly tool_calls: number;
		readonly failures: number;
		readonly files_modified: number;
		readonly backtrack_count: number;
		readonly active_duration_human?: string;
		readonly active_duration_ms?: number;
		readonly abandoned_edits?: number;
		readonly edit_chains_count?: number;
	};
	readonly top_errors?: readonly {
		readonly tool_name: string;
		readonly count: number;
		readonly sample_message?: string;
	}[];
	readonly task_summary?: readonly {
		readonly task_id: string;
		readonly agent: string;
		readonly subject?: string;
		readonly t: number;
	}[];
	readonly agent_workload?: readonly {
		readonly name: string;
		readonly id: string;
		readonly tool_calls: number;
		readonly files_modified: number;
		readonly duration_ms: number;
	}[];
}

export interface TimelineEntry {
	readonly t: number;
	readonly type:
		| "user_prompt"
		| "thinking"
		| "tool_call"
		| "tool_result"
		| "failure"
		| "backtrack"
		| "phase_boundary"
		| "teammate_idle"
		| "task_complete"
		| "agent_spawn"
		| "agent_stop"
		| "task_create"
		| "task_assign"
		| "msg_send";
	readonly tool_name?: string;
	readonly tool_use_id?: string;
	readonly content_preview?: string;
	readonly phase_index?: number;
	readonly teammate_name?: string;
	readonly agent_id?: string;
	readonly agent_name?: string;
	readonly task_id?: string;
	readonly task_subject?: string;
	readonly msg_from?: string;
	readonly msg_to?: string;
}

/**
 * How `estimated_cost_usd` was derived (cost-truth tiers; see analytics-truth spec):
 * - "measured"  — taken verbatim from a captured `total_cost_usd`/`costUSD` (>0).
 * - "estimated" — computed from real token counts × API price table.
 * - "heuristic" — computed from event/tool-call magic numbers (no real tokens).
 */
export const COST_BASES = ["measured", "estimated", "heuristic"] as const;
export type CostBasis = (typeof COST_BASES)[number];

export interface CostEstimate {
	readonly model: string;
	readonly estimated_input_tokens: number;
	readonly estimated_output_tokens: number;
	readonly estimated_cost_usd: number;
	readonly cache_read_tokens?: number;
	readonly cache_creation_tokens?: number;
	readonly is_estimated: boolean;
	readonly pricing_tier?: string;
	/**
	 * Provenance of `estimated_cost_usd`. Optional because CostEstimate values
	 * persisted before the cost-truth work lack it; readers derive a fallback
	 * (measured-absent ⇒ estimated/heuristic from `is_estimated`).
	 */
	readonly cost_basis?: CostBasis;
	/**
	 * Version of the pricing table `estimated_cost_usd` was (re-)priced against
	 * (see `PRICING_VERSION` in distill/stats.ts). Distilled costs are frozen at
	 * distill-time rates; readers re-price token-grounded estimates against the
	 * current table for display and stamp this. Absent ⇒ value is at frozen
	 * distill-time pricing. Never present on verbatim measured costs.
	 */
	readonly pricing_version?: string;
}

export interface TokenUsage {
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_read_tokens: number;
	readonly cache_creation_tokens: number;
}

export interface AgentStats {
	readonly tool_call_count: number;
	readonly failure_count: number;
	readonly tools_by_name: Readonly<Record<string, number>>;
	readonly unique_files: readonly string[];
	readonly token_usage?: TokenUsage;
}

export type CommunicationEdgeType = "message" | "task_complete" | "idle_notify" | "task_assign";

export interface CommunicationEdge {
	readonly from_id: string; // agent session UUID
	readonly from_name: string; // human-readable agent name
	readonly to_id: string; // agent session UUID
	readonly to_name: string; // human-readable agent name
	readonly from: string; // alias for from_name (backward compat)
	readonly to: string; // alias for to_name (backward compat)
	readonly count: number;
	readonly msg_types: readonly string[];
	readonly edge_type?: CommunicationEdgeType;
}

export interface AgentNode {
	readonly session_id: string;
	readonly agent_type: string;
	readonly agent_name?: string;
	readonly duration_ms: number;
	readonly tool_call_count: number;
	readonly children: readonly AgentNode[];
	readonly tasks_completed?: number;
	readonly idle_count?: number;
	readonly model?: string;
	readonly transcript_path?: string;
	readonly task_prompt?: string;
	readonly stats?: AgentStats;
	readonly file_map?: FileMapResult;
	readonly cost_estimate?: CostEstimate;
	readonly messages?: readonly AgentMessage[];
	readonly task_events?: readonly AgentTaskEvent[];
	readonly idle_periods?: readonly AgentIdlePeriod[];
	readonly communication_partners?: readonly AgentCommunicationPartner[];
	readonly edit_chains?: EditChainsResult;
	readonly backtracks?: readonly BacktrackResult[];
	readonly reasoning?: readonly TranscriptReasoning[];
	readonly context_consumption?: ContextConsumption;
}

export interface AggregatedTeamData {
	readonly stats: StatsResult;
	readonly file_map: FileMapResult;
	readonly edit_chains: EditChainsResult;
	readonly backtracks: readonly BacktrackResult[];
	readonly reasoning: readonly TranscriptReasoning[];
	readonly cost_estimate?: CostEstimate;
}

export interface TeamMetrics {
	readonly agent_count: number;
	readonly task_completed_count: number;
	readonly idle_event_count: number;
	readonly teammate_names: readonly string[];
	readonly tasks: ReadonlyArray<{
		readonly task_id: string;
		readonly agent: string;
		readonly subject?: string;
		readonly status?: "completed";
		readonly t: number;
	}>;
	readonly idle_transitions: ReadonlyArray<{
		readonly teammate: string;
		readonly t: number;
	}>;
	readonly utilization_ratio?: number;
}

export interface EditStep {
	readonly tool_use_id: string;
	readonly t: number;
	readonly tool_name: "Edit" | "Write" | "Read";
	readonly outcome: "success" | "failure" | "info";
	readonly old_string_preview?: string;
	readonly new_string_preview?: string;
	readonly old_string_lines?: number;
	readonly new_string_lines?: number;
	readonly content_lines?: number;
	readonly error_preview?: string;
	readonly thinking_preview?: string;
	readonly thinking_intent?: "planning" | "debugging" | "research" | "deciding" | "general";
	readonly backtrack_type?: "failure_retry" | "iteration_struggle" | "debugging_loop";
}

export interface EditChain {
	readonly file_path: string;
	readonly steps: readonly EditStep[];
	readonly total_edits: number;
	readonly total_failures: number;
	readonly total_reads: number;
	readonly effort_ms: number;
	readonly has_backtrack: boolean;
	readonly surviving_edit_ids: readonly string[];
	readonly abandoned_edit_ids: readonly string[];
	readonly agent_name?: string;
}

export interface DiffLine {
	readonly type: "add" | "remove" | "context";
	readonly content: string;
	readonly agent_name?: string;
	readonly line_number?: number;
}

export interface FileDiffAttribution {
	readonly file_path: string;
	readonly lines: readonly DiffLine[];
	readonly total_additions: number;
	readonly total_deletions: number;
}

export interface EditChainsResult {
	readonly chains: readonly EditChain[];
	readonly net_changes?: readonly WorkingTreeChange[];
	readonly diff_attribution?: readonly FileDiffAttribution[];
	/** Git-based unified diffs with line numbers/context. May be stale if repo changed since session. */
	readonly git_enriched_diffs?: readonly FileDiffAttribution[];
}

// --- Journey Types ---

export type PhaseType =
	| "prime"
	| "brainstorm"
	| "plan"
	| "build"
	| "review"
	| "test"
	| "commit"
	| "exploration"
	| "orchestrated_build"
	| "freeform"
	| "abort";

export type LifecycleType =
	| "prime-plan-build"
	| "prime-build"
	| "build-only"
	| "single-session"
	| "ad-hoc";

export type TransitionTrigger = "clear" | "compact_manual" | "compact_auto";

export interface JourneyPhase {
	readonly session_id: string;
	readonly phase_type: PhaseType;
	readonly prompt?: string;
	readonly spec_ref?: string;
	readonly source: "startup" | "clear" | "compact";
	readonly duration_ms: number;
	readonly event_count: number;
}

export interface PhaseTransition {
	readonly from_session: string;
	readonly to_session: string;
	readonly gap_ms: number;
	readonly trigger: TransitionTrigger;
	readonly git_changed: boolean;
	readonly prompt_shift: string;
}

export interface PlanDriftReport {
	readonly spec_path: string;
	readonly expected_files: readonly string[];
	readonly actual_files: readonly string[];
	readonly unexpected_files: readonly string[];
	readonly missing_files: readonly string[];
	readonly drift_score: number;
}

export interface CumulativeStats {
	readonly total_duration_ms: number;
	readonly total_events: number;
	readonly total_tool_calls: number;
	readonly total_failures: number;
	readonly phase_count: number;
	readonly retry_count: number;
}

export interface Journey {
	readonly id: string;
	readonly phases: readonly JourneyPhase[];
	readonly transitions: readonly PhaseTransition[];
	readonly spec_ref?: string;
	readonly lifecycle_type: LifecycleType;
	readonly cumulative_stats: CumulativeStats;
	readonly plan_drift?: PlanDriftReport;
}

// --- Communication Sequence Types ---

export interface CommunicationSequenceEntry {
	readonly t: number;
	readonly from_id: string; // agent session UUID
	readonly from_name: string; // human-readable agent name
	readonly to_id: string; // agent session UUID
	readonly to_name: string; // human-readable agent name
	readonly from: string; // alias for from_name (backward compat)
	readonly to: string; // alias for to_name (backward compat)
	readonly msg_type: string;
	readonly summary?: string;
	readonly content_preview?: string;
	readonly edge_type?: CommunicationEdgeType;
}

export interface ConversationGroup {
	readonly participants: readonly [string, string];
	readonly messages: readonly CommunicationSequenceEntry[];
}

export interface AgentLifetime {
	readonly agent_id: string;
	readonly agent_name?: string;
	readonly start_t: number;
	readonly end_t: number;
	readonly agent_type: string;
}

// --- Agent Enrichment Types ---

export interface AgentMessage {
	readonly t: number;
	readonly direction: "sent" | "received";
	readonly partner: string;
	readonly msg_type: string;
	readonly summary?: string;
}

export interface AgentTaskEvent {
	readonly t: number;
	readonly action: "create" | "assign" | "status_change" | "complete";
	readonly task_id: string;
	readonly subject?: string;
	readonly status?: string;
	readonly owner?: string;
}

export interface AgentIdlePeriod {
	readonly t: number;
	readonly teammate: string;
}

export interface AgentCommunicationPartner {
	readonly name: string;
	readonly sent_count: number;
	readonly received_count: number;
	readonly total_count: number;
	readonly msg_types: readonly string[];
}

export interface AgentDistillResult {
	readonly stats: AgentStats;
	readonly file_map: FileMapResult;
	readonly model: string | undefined;
	readonly token_usage: TokenUsage;
	readonly cost_estimate: CostEstimate | undefined;
	readonly task_prompt?: string;
	readonly edit_chains?: EditChainsResult;
	readonly backtracks?: readonly BacktrackResult[];
	readonly reasoning?: readonly TranscriptReasoning[];
	readonly context_consumption?: ContextConsumption;
}

export interface ActiveDurationResult {
	readonly active_ms: number;
	readonly idle_ms: number;
	readonly pause_ms: number;
}

// --- Work Unit Types ---

export type WorkUnitSessionRole = "creator" | "consumer" | "modifier";

export interface WorkUnitSession {
	readonly session_id: string;
	readonly session_name?: string;
	readonly phase: PhaseType | "other";
	readonly role: WorkUnitSessionRole;
	readonly start_time: number;
	readonly duration_ms: number;
	readonly git_branch?: string;
}

export type WorkUnitLinkType = "spec" | "branch_time";

export interface WorkUnit {
	readonly id: string;
	readonly link_type: WorkUnitLinkType;
	readonly spec_path?: string;
	readonly git_branch?: string;
	readonly sessions: readonly WorkUnitSession[];
	readonly lifecycle: "prime-plan-build" | "prime-build" | "plan-build" | "plan-build-review" | "multi-build" | "ad-hoc";
	readonly total_duration_ms: number;
	readonly date_range: { readonly start: number; readonly end: number };
}

export interface WorkUnitIndex {
	readonly version: 1;
	readonly updated_at: number;
	readonly units: readonly WorkUnit[];
}

export interface TaskRecord {
	readonly task_id: string;
	readonly subject: string;
	readonly description?: string;
	readonly active_form?: string;
	readonly status: "pending" | "in_progress" | "completed";
	readonly owner?: string;
	readonly blocked_by?: readonly string[];
	readonly created_at: number;
	readonly completed_at?: number;
	readonly created_by: string;
}

export interface TaskListResult {
	readonly tasks: readonly TaskRecord[];
	readonly total_count: number;
	readonly completed_count: number;
	readonly completion_rate: number;
}

export interface ContextConsumptionPoint {
	readonly t: number;
	readonly turn_index: number;
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_read_tokens: number;
	readonly cache_creation_tokens: number;
	readonly total_context_tokens: number;
	readonly context_pct: number;
	readonly is_compaction: boolean;
}

export interface ContextConsumption {
	readonly points: readonly ContextConsumptionPoint[];
	readonly peak_context_pct: number;
	readonly peak_context_tokens: number;
	readonly final_context_pct: number;
	readonly compaction_count: number;
	readonly context_velocity_per_min: number;
	readonly model_context_window: number;
	readonly turn_count: number;
}

export interface DistilledSession {
	readonly session_id: string;
	readonly session_name?: string;
	readonly start_time?: number;
	readonly stats: StatsResult;
	readonly backtracks: readonly BacktrackResult[];
	readonly decisions: readonly DecisionPoint[];
	readonly file_map: FileMapResult;
	readonly git_diff: GitDiffResult;
	readonly complete: boolean;
	readonly reasoning: readonly TranscriptReasoning[];
	readonly user_messages: readonly TranscriptUserMessage[];
	readonly transcript_path?: string;
	readonly summary?: DistilledSummary;
	readonly timeline?: readonly TimelineEntry[];
	readonly agents?: readonly AgentNode[];
	readonly cost_estimate?: CostEstimate;
	readonly team_metrics?: TeamMetrics;
	readonly communication_graph?: readonly CommunicationEdge[];
	readonly edit_chains?: EditChainsResult;
	readonly comm_sequence?: readonly CommunicationSequenceEntry[];
	readonly agent_lifetimes?: readonly AgentLifetime[];
	readonly plan_drift?: PlanDriftReport;
	readonly task_list?: TaskListResult;
	readonly context_consumption?: ContextConsumption;
	readonly feature_usage?: FeatureUsage;
	/**
	 * Effective session configuration (permission mode, effort, MCP servers) lifted
	 * purely from the event stream. Optional only for back-compat with distills
	 * written before this field shipped; `extractSessionConfig` always returns an
	 * object for freshly distilled sessions.
	 */
	readonly session_config?: SessionConfig;
	/**
	 * Resolved pricing tier this session was distilled (and priced) with. Surfaced so a
	 * cache/staleness layer can detect when the configured tier has changed since distill
	 * and the cached cost figures are stale (tier-change-never-recomputes). "auto" is
	 * resolved to a concrete "api"/"max" at distill time, so only those two appear here.
	 */
	readonly pricing_tier?: "api" | "max";
	/**
	 * Distill schema version stamped at write time. A freshness check treats a cached
	 * distilled artifact as stale when this differs from the current `DISTILL_SCHEMA_VERSION`,
	 * so bumping the version forces a re-distill even when the raw session mtime is unchanged.
	 */
	readonly schema_version?: number;
}

// --- Global Mode Types ---

export interface GlobalSessionSummary extends SessionSummary {
	readonly project_id: string;
	readonly project_name: string;
	/**
	 * Directory containing the `.clens/sessions/<id>.jsonl` that owns this session.
	 * Equals `project.path` in project mode; the nested capture dir in repository
	 * mode (where a session may live below the git root, e.g. `gitRoot/packages/web`).
	 * Used to route per-session distill to the correct (possibly nested) capture dir.
	 */
	readonly capture_dir: string;
}

export interface GlobalWorkUnit extends WorkUnit {
	readonly project_id: string;
	readonly project_name: string;
}

// --- Feature Usage Types (loop / goal / workflow) ---

export type FeatureFlag = "loop" | "goal" | "workflow";

export interface LoopWakeup {
	readonly t: number;
	readonly delay_seconds: number;
	readonly reason?: string;
}

export interface LoopUsage {
	readonly wakeup_count: number;
	readonly total_scheduled_wait_s: number;
	readonly autonomous: boolean;
	readonly skill_invocations: number;
	readonly wakeups: readonly LoopWakeup[];
}

export interface GoalUsage {
	readonly goals: readonly string[];
}

export interface WorkflowRun {
	readonly t: number;
	readonly name?: string;
	readonly description?: string;
}

export interface WorkflowUsage {
	readonly invocation_count: number;
	readonly runs: readonly WorkflowRun[];
}

export interface FeatureUsage {
	readonly flags: readonly FeatureFlag[];
	readonly loop?: LoopUsage;
	readonly goal?: GoalUsage;
	readonly workflow?: WorkflowUsage;
}

// --- Analytics Summary Types ---

export interface AnalyticsSummaryRow {
	readonly session_id: string;
	readonly date: string; // "2026-03-15" (LOCAL calendar day; see B18)
	readonly duration_ms: number;
	readonly model?: string;
	/** API-equivalent value at full list price (never multiplied by subscription factor). */
	readonly cost_usd: number;
	/**
	 * How `cost_usd` was derived. Optional because rows persisted before the cost-truth
	 * work lack it; readers default to deriving from `is_estimated`.
	 */
	readonly cost_basis?: CostBasis;
	/**
	 * Portion of `cost_usd` that is genuinely measured (cost_basis === "measured" ⇒
	 * equals cost_usd; otherwise 0). Optional for the same back-compat reason.
	 */
	readonly measured_cost_usd?: number;
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_read_tokens: number;
	readonly cache_creation_tokens: number;
	readonly is_estimated: boolean;
	readonly tool_call_count: number;
	readonly failure_count: number;
	/**
	 * Per-tool invocation counts (denominator for tool failure rates; see B11).
	 * Optional because summary rows persisted before B11 lack it; readers default to {}.
	 */
	readonly tools_by_name?: Readonly<Record<string, number>>;
	readonly failures_by_tool: Readonly<Record<string, number>>;
	readonly agent_count: number;
	readonly agent_types: readonly {
		readonly type: string;
		readonly count: number;
		readonly cost: number;
		readonly duration_ms: number;
		readonly tool_calls: number;
		readonly failure_count: number;
	}[];
	readonly backtrack_count: number;
	readonly backtracks_by_type: Readonly<Record<string, number>>;
	readonly backtrack_files: readonly string[];
	readonly reasoning_by_intent: Readonly<Record<string, number>>;
	readonly edit_chain_count: number;
	/**
	 * Sum of edits across all chains; divided by edit_chain_count gives the real mean
	 * chain length (see B19). Optional because rows persisted before B19 lack it;
	 * readers fall back to edit_chain_count.
	 */
	readonly edit_chain_links?: number;
	readonly abandoned_edits: number;
	readonly surviving_edits: number;
	readonly drift_score?: number;
	readonly unexpected_files?: number;
	readonly decision_types: Readonly<Record<string, number>>;
	readonly top_errors: readonly {
		readonly tool: string;
		readonly message: string;
		readonly count: number;
	}[];
}

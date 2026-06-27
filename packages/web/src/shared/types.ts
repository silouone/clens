/**
 * Single import source for all clens types used in the SPA.
 *
 * Usage: import type { SessionSummary, DistilledSession } from "../shared/types";
 */
import type { ClensConfig } from "clens";

export type {
	// Session
	SessionSummary,
	SessionStatus,

	// Naming / color flag (session-naming-flags) — SessionSummary already carries
	// display_name / name_source / label / color; these mirror the supporting types
	// so client + server can type rename/color controls without re-deriving them.
	NameSource,
	ColorName,
	SessionMeta,

	// Distill results
	DistilledSession,
	BacktrackResult,
	FileMapEntry,
	FileMapResult,
	GitDiffResult,
	WorkingTreeChange,
	AgentNode,
	CommunicationEdge,
	EditChain,
	EditChainsResult,
	EditStep,
	DiffLine,
	FileDiffAttribution,
	PhaseInfo,
	CostEstimate,
	TokenUsage,
	TimelineEntry,
	PlanDriftReport,

	// Communication
	CommunicationSequenceEntry,
	AgentLifetime,

	// Events
	StoredEvent,

	// Links
	LinkEvent,
	SpawnLink,
	StopLink,
	MessageLink,
	LinkEventType,

	// Conversation
	AgentMessageEntry,
	ConversationEntry,

	// Risk
	FileRiskScore,
	RiskLevel,

	// Transcript
	TranscriptReasoning,
	TranscriptUserMessage,

	// Distill extras
	ContextConsumption,
	ContextConsumptionPoint,
	FeatureFlag,
	FeatureUsage,
	LoopUsage,
	LoopWakeup,
	GoalUsage,
	WorkflowRun,
	WorkflowUsage,
	DistilledSummary,
	TeamMetrics,
	DecisionPoint,
	TaskRecord,
	TaskListResult,

	// Work Units
	WorkUnit,
	WorkUnitIndex,
	WorkUnitSession,
	WorkUnitSessionRole,
	WorkUnitLinkType,

	// Config
	ClensConfig,
	PricingTier,

	// Project Registry
	ProjectEntry,
	ProjectRegistry,

	// Global mode
	GlobalSessionSummary,
	GlobalWorkUnit,

	// Analytics
	AnalyticsSummaryRow,
} from "clens";

/**
 * Runtime color-flag palette + guard (session-naming-flags). Re-exported as
 * VALUES (not just types) so the client palette and the server PATCH validator
 * share a single source of truth with the CLI.
 */
export { COLOR_NAMES, isColorName } from "clens/src/types";

// ── Subscription plan (analytics-truth-and-brush) ───────────────────
//
// `config.plan` replaces the old `config.pricing` (PricingTier) "tier" model.
// The dashboard reports honest paid-vs-value-vs-ROI: `paid_usd` is derived from
// the flat monthly subscription rate, while `value_usd` stays the API-equivalent
// list-price total. `api` means pay-as-you-go (paid == value, roi == 1).

export type SubscriptionPlan = "pro" | "max5x" | "max20x" | "api";

/** Flat monthly subscription cost in USD per plan. `api` is 0 (pay-as-you-go). */
export const PLAN_MONTHLY_USD: Readonly<Record<SubscriptionPlan, number>> = {
	pro: 20,
	max5x: 100,
	max20x: 200,
	api: 0,
} as const;

/** Closed set of valid plan identifiers (runtime guard source of truth). */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
	"pro",
	"max5x",
	"max20x",
	"api",
] as const;

/** Plan used when neither `config.plan` nor a legacy `config.pricing` is present. */
export const DEFAULT_SUBSCRIPTION_PLAN: SubscriptionPlan = "max20x";

export const isSubscriptionPlan = (value: unknown): value is SubscriptionPlan =>
	typeof value === "string" && SUBSCRIPTION_PLANS.includes(value as SubscriptionPlan);

/**
 * Map a legacy `config.pricing` tier ("api" | "max" | "auto") onto the new plan
 * model so existing configs keep working without a migration:
 *   - `max`  → `max20x` (Silou's actual subscription)
 *   - `auto` → `max20x` (best-guess default for the old auto-detect tier)
 *   - `api`  → `api`    (pay-as-you-go)
 * Returns the default plan for anything unrecognized.
 */
export const planFromLegacyPricing = (pricing: unknown): SubscriptionPlan => {
	if (pricing === "api") return "api";
	if (pricing === "max" || pricing === "auto") return "max20x";
	return DEFAULT_SUBSCRIPTION_PLAN;
};

/**
 * Resolve the effective plan from a config-like object that may carry either the
 * new `plan` field or the legacy `pricing` field (new wins; legacy is mapped).
 */
export const resolvePlan = (config: {
	readonly plan?: unknown;
	readonly pricing?: unknown;
}): SubscriptionPlan =>
	isSubscriptionPlan(config.plan)
		? config.plan
		: config.pricing !== undefined
			? planFromLegacyPricing(config.pricing)
			: DEFAULT_SUBSCRIPTION_PLAN;

/**
 * Project config as seen by the web layer. Extends the CLI `ClensConfig` with the
 * new `plan` field (the CLI type still carries the legacy `pricing` for back-compat;
 * we read `pricing` to migrate, write `plan` going forward).
 */
export type WebClensConfig = ClensConfig & {
	readonly plan?: SubscriptionPlan;
};

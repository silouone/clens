import { createResource, createRoot, createSignal } from "solid-js";
import { isValidDayKey, localDayKey, matchesLocalDay } from "./analytics-day";
import { authHeaders } from "./api";
import { selectedProjectId } from "./project-store";

// ── Types (matching server response) ──────────────────────────────

export type AnalyticsRange = "7d" | "30d" | "90d" | "all";

/** Analysis coverage for the window: distilled (analyzed) vs all raw sessions (B10). */
export interface Population {
	readonly analyzed: number;
	readonly total: number;
	/** Window sessions present raw but not yet analyzed (distilled) — "N pending" (NUM-8). */
	readonly pending: number;
}

export interface DailyUsageMetrics {
	readonly date: string;
	readonly session_count: number;
	readonly total_cost_usd: number;
	readonly total_input_tokens: number;
	readonly total_output_tokens: number;
	readonly cache_read_tokens: number;
	readonly cache_creation_tokens: number;
	/** Cache-read share, or `null` when no fresh input was captured (n/a, AC9). */
	readonly cache_hit_rate: number | null;
	readonly avg_duration_ms: number;
	readonly median_duration_ms: number;
	readonly avg_agent_count: number;
	readonly total_tool_calls: number;
	readonly total_failures: number;
}

export interface UsageTotals {
	readonly sessions: number;
	/** API-equivalent value at full list price (retained for back-compat; == value_usd). */
	readonly cost_usd: number;
	/** API-equivalent value at full list price (Σ cost_usd). */
	readonly value_usd: number;
	/** Subscription cash paid over the window: rate × (D / 30), or value for `api`. */
	readonly paid_usd: number;
	/** value_usd / paid_usd (1 for `api`; 0 when paid is 0 and plan isn't `api`). */
	readonly roi: number;
	/** Σ cost_usd for sessions whose cost_basis === "measured". */
	readonly measured_cost_usd: number;
	/** measured_cost_usd / value_usd (0 when value 0) — drives the "X% estimated" badge. */
	readonly measured_fraction: number;
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_read_tokens: number;
	readonly cache_creation_tokens: number;
	/** Cache-read share, or `null` when no fresh input was captured (n/a, AC9). */
	readonly cache_hit_rate: number | null;
	readonly avg_duration_ms: number;
	readonly median_duration_ms: number;
	readonly avg_agents_per_session: number;
	readonly total_tool_calls: number;
	readonly total_failures: number;
	readonly failure_rate: number;
	readonly sessions_with_cost: number;
}

export interface ModelBreakdown {
	readonly model: string;
	readonly session_count: number;
	readonly cost_usd: number;
	readonly tokens: number;
	readonly avg_duration_ms: number;
}

export interface AgentTypeBreakdown {
	readonly agent_type: string;
	readonly spawn_count: number;
	readonly sessions_appeared_in: number;
	readonly avg_tool_calls: number;
	readonly avg_cost_usd: number;
	readonly avg_duration_ms: number;
	readonly avg_failure_rate: number;
}

export interface UsageResponse {
	readonly population: Population;
	readonly daily: readonly DailyUsageMetrics[];
	readonly totals: UsageTotals;
	readonly previous_totals: UsageTotals;
	readonly by_model: readonly ModelBreakdown[];
	readonly by_agent_type: readonly AgentTypeBreakdown[];
}

export interface DailyInsightsMetrics {
	readonly date: string;
	readonly backtrack_count: number;
	readonly backtracks_by_type: Record<string, number>;
	readonly reasoning_by_intent: Record<string, number>;
	readonly decision_types: Record<string, number>;
	readonly avg_edit_chain_length: number;
	readonly abandoned_edit_rate: number;
	readonly failure_rate: number;
}

export interface InsightsTotals {
	readonly sessions: number;
	readonly backtrack_rate: number;
	readonly abandoned_edit_rate: number;
	readonly avg_drift_score: number;
	readonly sessions_with_drift: number;
	readonly reasoning_action_ratio: number;
	readonly reasoning_distribution: Record<string, number>;
	readonly decision_type_distribution: Record<string, number>;
}

export interface ToolErrorEntry {
	readonly tool_name: string;
	readonly total_calls: number;
	readonly total_failures: number;
	readonly failure_rate: number;
	readonly sample_errors: readonly string[];
}

export interface PlanDriftPoint {
	readonly session_id: string;
	readonly date: string;
	readonly drift_score: number;
	readonly unexpected_file_count: number;
}

export interface WorstSession {
	readonly session_id: string;
	readonly date: string;
	readonly backtrack_count: number;
	readonly cost_usd: number;
	readonly duration_ms: number;
}

export interface InsightsResponse {
	readonly population: Population;
	readonly daily: readonly DailyInsightsMetrics[];
	readonly totals: InsightsTotals;
	readonly previous_totals: InsightsTotals;
	readonly tool_errors: readonly ToolErrorEntry[];
	readonly top_backtrack_files: readonly { readonly file: string; readonly count: number }[];
	readonly top_error_patterns: readonly {
		readonly pattern: string;
		readonly count: number;
		readonly tools: readonly string[];
	}[];
	readonly plan_drift_points: readonly PlanDriftPoint[];
	readonly worst_sessions: readonly WorstSession[];
}

// ── Shared signals ────────────────────────────────────────────────

const [analyticsRange, setAnalyticsRange] = createSignal<AnalyticsRange>("30d");
const [focusedDate, setFocusedDate] = createSignal<string | undefined>();

/**
 * Inline time-range brush selection (analytics-truth-and-brush). When set, every
 * usage + insights widget re-scopes to exactly [from..to] (inclusive local days)
 * and the preset chips render as "Custom". Cleared returns to the active preset.
 */
export interface CustomRange {
	readonly from: string;
	readonly to: string;
}

const [customRange, setCustomRangeSignal] = createSignal<CustomRange | undefined>();

/** Set the custom brush window. Bounds are normalized so a right-to-left drag still works. */
const setCustomRange = (range: CustomRange): void => {
	setCustomRangeSignal(range.from <= range.to ? range : { from: range.to, to: range.from });
};

/** Clear the brush window, returning the dashboard to the active preset. */
const clearCustomRange = (): void => {
	setCustomRangeSignal(undefined);
};

// Local-day filter helpers (B22) live in ./analytics-day so they can be unit-tested
// without loading this store's module-level Solid resources. Re-exported below.

// ── Fetchers ──────────────────────────────────────────────────────

type FetchParams = {
	readonly range: AnalyticsRange;
	readonly project: string | undefined;
	readonly custom: CustomRange | undefined;
};

const analyticsParams = (): FetchParams => ({
	range: analyticsRange(),
	project: selectedProjectId(),
	custom: customRange(),
});

const buildQuery = (endpoint: string, params: FetchParams): string => {
	const qs = new URLSearchParams({ range: params.range });
	if (params.project) qs.set("project", params.project);
	// A custom brush window overrides the preset: thread from/to so the server scopes
	// the current window to [from,to] inclusive and the previous to the preceding span.
	if (params.custom) {
		qs.set("from", params.custom.from);
		qs.set("to", params.custom.to);
	}
	return `/api/analytics/${endpoint}?${qs.toString()}`;
};

const fetchUsage = async (params: FetchParams): Promise<UsageResponse | undefined> => {
	try {
		const res = await fetch(buildQuery("usage", params), { headers: authHeaders() });
		if (!res.ok) return undefined;
		const body = await res.json();
		return body.data as UsageResponse;
	} catch {
		return undefined;
	}
};

const fetchInsights = async (params: FetchParams): Promise<InsightsResponse | undefined> => {
	try {
		const res = await fetch(buildQuery("insights", params), { headers: authHeaders() });
		if (!res.ok) return undefined;
		const body = await res.json();
		return body.data as InsightsResponse;
	} catch {
		return undefined;
	}
};

// ── Resources ─────────────────────────────────────────────────────

// createRoot owns these app-lifetime resources so their computations have a reactive
// owner — clears the SolidJS "computations created outside createRoot" warnings at
// module load (FE-31). The root is never disposed (stores live for the app's life).
const [usageData, { refetch: refetchUsage }] = createRoot(() =>
	createResource(analyticsParams, fetchUsage),
);
const [insightsData, { refetch: refetchInsights }] = createRoot(() =>
	createResource(analyticsParams, fetchInsights),
);

// ── Derived selectors ─────────────────────────────────────────────

const dailyUsage = () => usageData()?.daily ?? [];
const usageTotals = () => usageData()?.totals;
const usagePreviousTotals = () => usageData()?.previous_totals;
const usagePopulation = () => usageData()?.population;
const modelBreakdown = () => usageData()?.by_model ?? [];
const agentTypeBreakdown = () => usageData()?.by_agent_type ?? [];

const dailyInsights = () => insightsData()?.daily ?? [];
const insightsTotals = () => insightsData()?.totals;
const insightsPreviousTotals = () => insightsData()?.previous_totals;
const insightsPopulation = () => insightsData()?.population;
const toolErrors = () => insightsData()?.tool_errors ?? [];
const topBacktrackFiles = () => insightsData()?.top_backtrack_files ?? [];
const topErrorPatterns = () => insightsData()?.top_error_patterns ?? [];
const planDriftPoints = () => insightsData()?.plan_drift_points ?? [];
const worstSessions = () => insightsData()?.worst_sessions ?? [];

// ── Delta helpers ─────────────────────────────────────────────────

export type DeltaResult = {
	readonly value: number;
	readonly direction: "up" | "down" | "flat";
};

const computeDelta = (current: number, previous: number): DeltaResult => {
	if (previous === 0) return { value: 0, direction: "flat" as const };
	const pct = ((current - previous) / previous) * 100;
	return {
		value: Math.abs(pct),
		direction: pct > 1 ? ("up" as const) : pct < -1 ? ("down" as const) : ("flat" as const),
	};
};

const computePpDelta = (current: number, previous: number): DeltaResult => {
	const diff = (current - previous) * 100; // percentage points
	return {
		value: Math.abs(diff),
		direction: diff > 0.5 ? ("up" as const) : diff < -0.5 ? ("down" as const) : ("flat" as const),
	};
};

// ── Refetch ───────────────────────────────────────────────────────

const refetchAnalytics = () => {
	refetchUsage();
	refetchInsights();
};

// ── Header stats (all-time, project-aware) ───────────────────────

export interface HeaderStats {
	readonly totalSessions: number;
	readonly todaySessions: number;
	readonly totalEvents: number;
	readonly avgDurationMs: number;
	readonly totalCostUsd: number;
	/** Sessions that carried a non-zero cost — drives the header "-" guard so a
	 *  $0.00 total is never rendered (NUM-21). */
	readonly sessionsWithCost: number;
}

const fetchHeaderStats = async (): Promise<HeaderStats> => {
	const project = selectedProjectId();
	const qs = new URLSearchParams({ range: "all" });
	if (project) qs.set("project", project);
	try {
		const res = await fetch(`/api/analytics/usage?${qs.toString()}`, { headers: authHeaders() });
		if (!res.ok)
			return {
				totalSessions: 0,
				todaySessions: 0,
				totalEvents: 0,
				avgDurationMs: 0,
				totalCostUsd: 0,
				sessionsWithCost: 0,
			};
		const body = await res.json();
		const t = body.data?.totals as UsageTotals | undefined;
		if (!t)
			return {
				totalSessions: 0,
				todaySessions: 0,
				totalEvents: 0,
				avgDurationMs: 0,
				totalCostUsd: 0,
				sessionsWithCost: 0,
			};
		// "today" count from daily array — daily rows are keyed by LOCAL calendar day
		// (analytics-summary.localDayKey), so match on the local current day, not UTC.
		const daily = (body.data?.daily ?? []) as readonly DailyUsageMetrics[];
		const today = localDayKey(Date.now());
		const todayRow = daily.find((d) => d.date === today);
		return {
			totalSessions: t.sessions,
			todaySessions: todayRow?.session_count ?? 0,
			totalEvents: t.total_tool_calls,
			avgDurationMs: t.avg_duration_ms,
			totalCostUsd: t.cost_usd,
			sessionsWithCost: t.sessions_with_cost,
		};
	} catch {
		return {
			totalSessions: 0,
			todaySessions: 0,
			totalEvents: 0,
			avgDurationMs: 0,
			totalCostUsd: 0,
			sessionsWithCost: 0,
		};
	}
};

/** Reactive key: re-fetches when project changes. */
const headerStatsKey = () => selectedProjectId() ?? "__all__";

const [headerStats, { refetch: refetchHeaderStats }] = createRoot(() =>
	createResource(headerStatsKey, fetchHeaderStats),
);

// ── Rebuild ───────────────────────────────────────────────────────

const [isRebuilding, setIsRebuilding] = createSignal(false);

const rebuildAnalytics = async (): Promise<number> => {
	setIsRebuilding(true);
	try {
		const res = await fetch("/api/analytics/rebuild", { method: "POST", headers: authHeaders() });
		if (!res.ok) return 0;
		const body = await res.json();
		// Refetch all stores after rebuild
		refetchUsage();
		refetchInsights();
		refetchHeaderStats();
		return (body.data?.rebuilt as number) ?? 0;
	} catch {
		return 0;
	} finally {
		setIsRebuilding(false);
	}
};

export {
	agentTypeBreakdown,
	analyticsRange,
	clearCustomRange,
	computeDelta,
	computePpDelta,
	customRange,
	dailyInsights,
	dailyUsage,
	focusedDate,
	headerStats,
	insightsData,
	insightsPopulation,
	insightsPreviousTotals,
	insightsTotals,
	isRebuilding,
	isValidDayKey,
	localDayKey,
	matchesLocalDay,
	modelBreakdown,
	planDriftPoints,
	rebuildAnalytics,
	refetchAnalytics,
	refetchHeaderStats,
	refetchInsights,
	refetchUsage,
	setAnalyticsRange,
	setCustomRange,
	setFocusedDate,
	toolErrors,
	topBacktrackFiles,
	topErrorPatterns,
	usageData,
	usagePopulation,
	usagePreviousTotals,
	usageTotals,
	worstSessions,
};

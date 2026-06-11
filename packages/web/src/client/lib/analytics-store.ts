import { createMemo, createResource, createSignal } from "solid-js";
import { selectedProjectId } from "./project-store";

// ── Types (matching server response) ──────────────────────────────

export type AnalyticsRange = "7d" | "30d" | "90d" | "all";

export interface DailyUsageMetrics {
	readonly date: string;
	readonly session_count: number;
	readonly total_cost_usd: number;
	readonly total_input_tokens: number;
	readonly total_output_tokens: number;
	readonly cache_read_tokens: number;
	readonly cache_creation_tokens: number;
	readonly cache_hit_rate: number;
	readonly avg_duration_ms: number;
	readonly median_duration_ms: number;
	readonly avg_agent_count: number;
	readonly total_tool_calls: number;
	readonly total_failures: number;
}

export interface UsageTotals {
	readonly sessions: number;
	readonly cost_usd: number;
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_read_tokens: number;
	readonly cache_creation_tokens: number;
	readonly cache_hit_rate: number;
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
	readonly agent_quality_score: number;
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
	readonly daily: readonly DailyInsightsMetrics[];
	readonly totals: InsightsTotals;
	readonly previous_totals: InsightsTotals;
	readonly tool_errors: readonly ToolErrorEntry[];
	readonly top_backtrack_files: readonly { readonly file: string; readonly count: number }[];
	readonly top_error_patterns: readonly { readonly pattern: string; readonly count: number; readonly tools: readonly string[] }[];
	readonly plan_drift_points: readonly PlanDriftPoint[];
	readonly worst_sessions: readonly WorstSession[];
}

// ── Shared signals ────────────────────────────────────────────────

const [analyticsRange, setAnalyticsRange] = createSignal<AnalyticsRange>("30d");
const [focusedDate, setFocusedDate] = createSignal<string | undefined>();

// ── Fetchers ──────────────────────────────────────────────────────

type FetchParams = { readonly range: AnalyticsRange; readonly project: string | undefined };

const analyticsParams = (): FetchParams => ({
	range: analyticsRange(),
	project: selectedProjectId(),
});

const buildQuery = (endpoint: string, params: FetchParams): string => {
	const qs = new URLSearchParams({ range: params.range });
	if (params.project) qs.set("project", params.project);
	return `/api/analytics/${endpoint}?${qs.toString()}`;
};

const fetchUsage = async (params: FetchParams): Promise<UsageResponse | undefined> => {
	try {
		const res = await fetch(buildQuery("usage", params));
		if (!res.ok) return undefined;
		const body = await res.json();
		return body.data as UsageResponse;
	} catch {
		return undefined;
	}
};

const fetchInsights = async (params: FetchParams): Promise<InsightsResponse | undefined> => {
	try {
		const res = await fetch(buildQuery("insights", params));
		if (!res.ok) return undefined;
		const body = await res.json();
		return body.data as InsightsResponse;
	} catch {
		return undefined;
	}
};

// ── Resources ─────────────────────────────────────────────────────

const [usageData, { refetch: refetchUsage }] = createResource(analyticsParams, fetchUsage);
const [insightsData, { refetch: refetchInsights }] = createResource(analyticsParams, fetchInsights);

// ── Derived selectors ─────────────────────────────────────────────

const dailyUsage = () => usageData()?.daily ?? [];
const usageTotals = () => usageData()?.totals;
const usagePreviousTotals = () => usageData()?.previous_totals;
const modelBreakdown = () => usageData()?.by_model ?? [];
const agentTypeBreakdown = () => usageData()?.by_agent_type ?? [];

const dailyInsights = () => insightsData()?.daily ?? [];
const insightsTotals = () => insightsData()?.totals;
const insightsPreviousTotals = () => insightsData()?.previous_totals;
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
		direction: pct > 1 ? "up" as const : pct < -1 ? "down" as const : "flat" as const,
	};
};

const computePpDelta = (current: number, previous: number): DeltaResult => {
	const diff = (current - previous) * 100; // percentage points
	return {
		value: Math.abs(diff),
		direction: diff > 0.5 ? "up" as const : diff < -0.5 ? "down" as const : "flat" as const,
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
}

const fetchHeaderStats = async (): Promise<HeaderStats> => {
	const project = selectedProjectId();
	const qs = new URLSearchParams({ range: "all" });
	if (project) qs.set("project", project);
	try {
		const res = await fetch(`/api/analytics/usage?${qs.toString()}`);
		if (!res.ok) return { totalSessions: 0, todaySessions: 0, totalEvents: 0, avgDurationMs: 0, totalCostUsd: 0 };
		const body = await res.json();
		const t = body.data?.totals as UsageTotals | undefined;
		if (!t) return { totalSessions: 0, todaySessions: 0, totalEvents: 0, avgDurationMs: 0, totalCostUsd: 0 };
		// "today" count from daily array
		const daily = (body.data?.daily ?? []) as readonly DailyUsageMetrics[];
		const today = new Date().toISOString().slice(0, 10);
		const todayRow = daily.find((d) => d.date === today);
		return {
			totalSessions: t.sessions,
			todaySessions: todayRow?.session_count ?? 0,
			totalEvents: t.total_tool_calls,
			avgDurationMs: t.avg_duration_ms,
			totalCostUsd: t.cost_usd,
		};
	} catch {
		return { totalSessions: 0, todaySessions: 0, totalEvents: 0, avgDurationMs: 0, totalCostUsd: 0 };
	}
};

/** Reactive key: re-fetches when project changes. */
const headerStatsKey = () => selectedProjectId() ?? "__all__";

const [headerStats, { refetch: refetchHeaderStats }] = createResource(headerStatsKey, fetchHeaderStats);

// ── Rebuild ───────────────────────────────────────────────────────

const [isRebuilding, setIsRebuilding] = createSignal(false);

const rebuildAnalytics = async (): Promise<number> => {
	setIsRebuilding(true);
	try {
		const res = await fetch("/api/analytics/rebuild", { method: "POST" });
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
	analyticsRange,
	setAnalyticsRange,
	focusedDate,
	setFocusedDate,
	usageData,
	insightsData,
	refetchUsage,
	refetchInsights,
	refetchAnalytics,
	dailyUsage,
	usageTotals,
	usagePreviousTotals,
	modelBreakdown,
	agentTypeBreakdown,
	dailyInsights,
	insightsTotals,
	insightsPreviousTotals,
	toolErrors,
	topBacktrackFiles,
	topErrorPatterns,
	planDriftPoints,
	worstSessions,
	computeDelta,
	computePpDelta,
	rebuildAnalytics,
	isRebuilding,
	headerStats,
	refetchHeaderStats,
};

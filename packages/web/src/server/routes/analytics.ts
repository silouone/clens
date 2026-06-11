import { Hono } from "hono"
import { closeSync, openSync, readSync, readdirSync } from "node:fs"
import { readAnalyticsSummary, rebuildAnalyticsSummary } from "@clens/cli/src/distill/analytics-summary"
import type { AnalyticsSummaryRow, ProjectEntry } from "@clens/cli"
import { createLogger } from "../logger"

const log = createLogger("analytics")

// ── Types ──────────────────────────────────────────────────────────

type Range = "7d" | "30d" | "90d" | "all"

/**
 * Coverage of the window: how many sessions were actually analyzed (distilled, and
 * thus reflected in every metric below) vs how many raw sessions exist in the window.
 * Without this the UI silently aggregates only distilled sessions and presents them
 * as the whole population (B10).
 */
interface Population {
	readonly analyzed: number
	readonly total: number
}

interface DailyUsageMetrics {
	readonly date: string
	readonly session_count: number
	readonly total_cost_usd: number
	readonly total_input_tokens: number
	readonly total_output_tokens: number
	readonly cache_read_tokens: number
	readonly cache_creation_tokens: number
	readonly cache_hit_rate: number
	readonly avg_duration_ms: number
	readonly median_duration_ms: number
	readonly avg_agent_count: number
	readonly total_tool_calls: number
	readonly total_failures: number
}

interface UsageTotals {
	readonly sessions: number
	readonly cost_usd: number
	readonly input_tokens: number
	readonly output_tokens: number
	readonly cache_read_tokens: number
	readonly cache_creation_tokens: number
	readonly cache_hit_rate: number
	readonly avg_duration_ms: number
	readonly median_duration_ms: number
	readonly avg_agents_per_session: number
	readonly total_tool_calls: number
	readonly total_failures: number
	readonly failure_rate: number
	readonly sessions_with_cost: number
}

interface ModelBreakdown {
	readonly model: string
	readonly session_count: number
	readonly cost_usd: number
	readonly tokens: number
	readonly avg_duration_ms: number
}

interface AgentTypeBreakdown {
	readonly agent_type: string
	readonly spawn_count: number
	readonly sessions_appeared_in: number
	readonly avg_tool_calls: number
	readonly avg_cost_usd: number
	readonly avg_duration_ms: number
	readonly avg_failure_rate: number
}

interface UsageResponse {
	readonly population: Population
	readonly daily: readonly DailyUsageMetrics[]
	readonly totals: UsageTotals
	readonly previous_totals: UsageTotals
	readonly by_model: readonly ModelBreakdown[]
	readonly by_agent_type: readonly AgentTypeBreakdown[]
}

interface DailyInsightsMetrics {
	readonly date: string
	readonly backtrack_count: number
	readonly backtracks_by_type: Record<string, number>
	readonly reasoning_by_intent: Record<string, number>
	readonly decision_types: Record<string, number>
	readonly avg_edit_chain_length: number
	readonly abandoned_edit_rate: number
	readonly failure_rate: number
}

interface InsightsTotals {
	readonly sessions: number
	readonly backtrack_rate: number
	readonly abandoned_edit_rate: number
	readonly avg_drift_score: number
	readonly sessions_with_drift: number
	readonly reasoning_action_ratio: number
	readonly reasoning_distribution: Record<string, number>
	readonly decision_type_distribution: Record<string, number>
	readonly agent_quality_score: number
}

interface ToolErrorEntry {
	readonly tool_name: string
	readonly total_calls: number
	readonly total_failures: number
	readonly failure_rate: number
	readonly sample_errors: readonly string[]
}

interface PlanDriftPoint {
	readonly session_id: string
	readonly date: string
	readonly drift_score: number
	readonly unexpected_file_count: number
}

interface WorstSession {
	readonly session_id: string
	readonly date: string
	readonly backtrack_count: number
	readonly cost_usd: number
	readonly duration_ms: number
}

interface InsightsResponse {
	readonly population: Population
	readonly daily: readonly DailyInsightsMetrics[]
	readonly totals: InsightsTotals
	readonly previous_totals: InsightsTotals
	readonly tool_errors: readonly ToolErrorEntry[]
	readonly top_backtrack_files: readonly { readonly file: string; readonly count: number }[]
	readonly top_error_patterns: readonly { readonly pattern: string; readonly count: number; readonly tools: readonly string[] }[]
	readonly plan_drift_points: readonly PlanDriftPoint[]
	readonly worst_sessions: readonly WorstSession[]
}

// ── Helpers ────────────────────────────────────────────────────────

const RANGE_DAYS: Readonly<Record<Range, number | undefined>> = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
	all: undefined,
} as const

const parseRange = (value: string | undefined): Range =>
	value === "7d" || value === "30d" || value === "90d" || value === "all" ? value : "30d"

// Row dates are LOCAL calendar days ("YYYY-MM-DD", see analytics-summary.localDayKey).
// Window boundaries must therefore also be computed in LOCAL time so comparisons line
// up with the day a session was actually bucketed under (B18).
const localDayString = (d: Date): string => {
	const year = d.getFullYear()
	const month = `${d.getMonth() + 1}`.padStart(2, "0")
	const day = `${d.getDate()}`.padStart(2, "0")
	return `${year}-${month}-${day}`
}

const dateNDaysAgo = (n: number): string => {
	const d = new Date()
	d.setDate(d.getDate() - n)
	return localDayString(d)
}

const median = (values: readonly number[]): number => {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const filterByRange = (
	rows: readonly AnalyticsSummaryRow[],
	range: Range,
): { readonly current: readonly AnalyticsSummaryRow[]; readonly previous: readonly AnalyticsSummaryRow[] } => {
	const days = RANGE_DAYS[range]
	if (!days) return { current: rows, previous: [] }

	// Current window is exactly N local days: [today-(N-1) .. today] inclusive.
	// Previous window is the immediately preceding N days: [today-(2N-1) .. today-N].
	// Using dateNDaysAgo(days) for the cutoff would include today-N too, yielding an
	// (N+1)-day current window compared against an N-day previous one (B18).
	const cutoff = dateNDaysAgo(days - 1)
	const previousCutoff = dateNDaysAgo(days * 2 - 1)
	const current = rows.filter((r) => r.date >= cutoff)
	const previous = rows.filter((r) => r.date >= previousCutoff && r.date < cutoff)
	return { current, previous }
}

/**
 * Count raw session files (the source of truth, not just distilled ones) whose
 * local start day falls inside the current window. Pairs with the analyzed count
 * to expose analysis coverage (B10).
 */
const countRawSessionsInWindow = (startTimes: readonly number[], range: Range): number => {
	const days = RANGE_DAYS[range]
	if (!days) return startTimes.length
	const cutoff = dateNDaysAgo(days - 1)
	return startTimes.filter((ms) => localDayString(new Date(ms)) >= cutoff).length
}

const computePopulation = (
	rawStartTimes: readonly number[],
	analyzedRows: readonly AnalyticsSummaryRow[],
	range: Range,
): Population => ({
	analyzed: analyzedRows.length,
	total: countRawSessionsInWindow(rawStartTimes, range),
})

// ── Usage metrics computation ──────────────────────────────────────

const groupByDate = (rows: readonly AnalyticsSummaryRow[]): ReadonlyMap<string, readonly AnalyticsSummaryRow[]> => {
	const map = new Map<string, AnalyticsSummaryRow[]>()
	rows.forEach((r) => {
		const existing = map.get(r.date) ?? []
		map.set(r.date, [...existing, r])
	})
	return map
}

const computeDailyUsage = (byDate: ReadonlyMap<string, readonly AnalyticsSummaryRow[]>): readonly DailyUsageMetrics[] =>
	[...byDate.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, rows]) => {
			const totalInput = rows.reduce((s, r) => s + r.input_tokens, 0)
			const totalCacheRead = rows.reduce((s, r) => s + r.cache_read_tokens, 0)
			const cacheHitDenom = totalInput + totalCacheRead
			return {
				date,
				session_count: rows.length,
				total_cost_usd: rows.reduce((s, r) => s + r.cost_usd, 0),
				total_input_tokens: totalInput,
				total_output_tokens: rows.reduce((s, r) => s + r.output_tokens, 0),
				cache_read_tokens: totalCacheRead,
				cache_creation_tokens: rows.reduce((s, r) => s + r.cache_creation_tokens, 0),
				cache_hit_rate: cacheHitDenom > 0 ? totalCacheRead / cacheHitDenom : 0,
				avg_duration_ms: rows.length > 0 ? rows.reduce((s, r) => s + r.duration_ms, 0) / rows.length : 0,
				median_duration_ms: median(rows.map((r) => r.duration_ms)),
				avg_agent_count: rows.length > 0 ? rows.reduce((s, r) => s + r.agent_count, 0) / rows.length : 0,
				total_tool_calls: rows.reduce((s, r) => s + r.tool_call_count, 0),
				total_failures: rows.reduce((s, r) => s + r.failure_count, 0),
			}
		})

const computeUsageTotals = (rows: readonly AnalyticsSummaryRow[]): UsageTotals => {
	if (rows.length === 0) {
		return {
			sessions: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0,
			cache_read_tokens: 0, cache_creation_tokens: 0, cache_hit_rate: 0,
			avg_duration_ms: 0, median_duration_ms: 0, avg_agents_per_session: 0,
			total_tool_calls: 0, total_failures: 0, failure_rate: 0, sessions_with_cost: 0,
		}
	}

	const totalInput = rows.reduce((s, r) => s + r.input_tokens, 0)
	const totalCacheRead = rows.reduce((s, r) => s + r.cache_read_tokens, 0)
	const cacheHitDenom = totalInput + totalCacheRead
	const totalToolCalls = rows.reduce((s, r) => s + r.tool_call_count, 0)
	const totalFailures = rows.reduce((s, r) => s + r.failure_count, 0)

	return {
		sessions: rows.length,
		cost_usd: rows.reduce((s, r) => s + r.cost_usd, 0),
		input_tokens: totalInput,
		output_tokens: rows.reduce((s, r) => s + r.output_tokens, 0),
		cache_read_tokens: totalCacheRead,
		cache_creation_tokens: rows.reduce((s, r) => s + r.cache_creation_tokens, 0),
		cache_hit_rate: cacheHitDenom > 0 ? totalCacheRead / cacheHitDenom : 0,
		avg_duration_ms: rows.reduce((s, r) => s + r.duration_ms, 0) / rows.length,
		median_duration_ms: median(rows.map((r) => r.duration_ms)),
		avg_agents_per_session: rows.reduce((s, r) => s + r.agent_count, 0) / rows.length,
		total_tool_calls: totalToolCalls,
		total_failures: totalFailures,
		failure_rate: totalToolCalls > 0 ? totalFailures / totalToolCalls : 0,
		sessions_with_cost: rows.filter((r) => r.cost_usd > 0).length,
	}
}

const computeModelBreakdown = (rows: readonly AnalyticsSummaryRow[]): readonly ModelBreakdown[] => {
	const byModel = new Map<string, { count: number; cost: number; tokens: number; duration: number }>()
	rows.forEach((r) => {
		const model = r.model ?? "unknown"
		const existing = byModel.get(model) ?? { count: 0, cost: 0, tokens: 0, duration: 0 }
		byModel.set(model, {
			count: existing.count + 1,
			cost: existing.cost + r.cost_usd,
			tokens: existing.tokens + r.input_tokens + r.output_tokens,
			duration: existing.duration + r.duration_ms,
		})
	})
	return [...byModel.entries()]
		.map(([model, data]) => ({
			model,
			session_count: data.count,
			cost_usd: data.cost,
			tokens: data.tokens,
			avg_duration_ms: data.count > 0 ? data.duration / data.count : 0,
		}))
		.sort((a, b) => b.cost_usd - a.cost_usd)
}

const computeAgentTypeBreakdown = (rows: readonly AnalyticsSummaryRow[]): readonly AgentTypeBreakdown[] => {
	const byType = new Map<string, {
		spawn_count: number
		sessions: Set<string>
		total_tool_calls: number
		total_cost: number
		total_duration: number
		total_failures: number
		total_entries: number
	}>()

	rows.forEach((r) => {
		r.agent_types.forEach((a) => {
			const existing = byType.get(a.type) ?? {
				spawn_count: 0, sessions: new Set<string>(),
				total_tool_calls: 0, total_cost: 0, total_duration: 0,
				total_failures: 0, total_entries: 0,
			}
			existing.spawn_count += a.count
			existing.sessions.add(r.session_id)
			existing.total_tool_calls += a.tool_calls
			existing.total_cost += a.cost
			existing.total_duration += a.duration_ms
			existing.total_failures += a.failure_count
			existing.total_entries += 1
			byType.set(a.type, existing)
		})
	})

	return [...byType.entries()]
		.map(([agent_type, data]) => ({
			agent_type,
			spawn_count: data.spawn_count,
			sessions_appeared_in: data.sessions.size,
			avg_tool_calls: data.total_entries > 0 ? data.total_tool_calls / data.total_entries : 0,
			avg_cost_usd: data.total_entries > 0 ? data.total_cost / data.total_entries : 0,
			avg_duration_ms: data.total_entries > 0 ? data.total_duration / data.total_entries : 0,
			avg_failure_rate: data.total_tool_calls > 0 ? data.total_failures / data.total_tool_calls : 0,
		}))
		.sort((a, b) => b.spawn_count - a.spawn_count)
}

const computeUsageMetrics = (
	rows: readonly AnalyticsSummaryRow[],
	range: Range,
	rawStartTimes: readonly number[],
): UsageResponse => {
	const { current, previous } = filterByRange(rows, range)
	const byDate = groupByDate(current)
	return {
		population: computePopulation(rawStartTimes, current, range),
		daily: computeDailyUsage(byDate),
		totals: computeUsageTotals(current),
		previous_totals: computeUsageTotals(previous),
		by_model: computeModelBreakdown(current),
		by_agent_type: computeAgentTypeBreakdown(current),
	}
}

// ── Insights metrics computation ───────────────────────────────────

const computeDailyInsights = (byDate: ReadonlyMap<string, readonly AnalyticsSummaryRow[]>): readonly DailyInsightsMetrics[] =>
	[...byDate.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, rows]) => {
			const totalToolCalls = rows.reduce((s, r) => s + r.tool_call_count, 0)
			const totalFailures = rows.reduce((s, r) => s + r.failure_count, 0)
			const totalChains = rows.reduce((s, r) => s + r.edit_chain_count, 0)
			// Real mean chain length = total edits across all chains / number of chains.
			// (edit_chain_links may be absent on summary rows written before B19; fall back
			// to the chain count so a stale row reports a mean of 1 rather than crashing.)
			const totalChainLinks = rows.reduce((s, r) => s + (r.edit_chain_links ?? r.edit_chain_count), 0)
			const totalAbandoned = rows.reduce((s, r) => s + r.abandoned_edits, 0)
			const totalSurviving = rows.reduce((s, r) => s + r.surviving_edits, 0)
			const editTotal = totalAbandoned + totalSurviving

			// Merge records by type
			const mergeRecords = (key: keyof Pick<AnalyticsSummaryRow, "backtracks_by_type" | "reasoning_by_intent" | "decision_types">) =>
				rows.reduce<Record<string, number>>(
					(acc, r) => Object.entries(r[key]).reduce(
						(a, [k, v]) => ({ ...a, [k]: (a[k] ?? 0) + v }),
						acc,
					),
					{},
				)

			return {
				date,
				backtrack_count: rows.reduce((s, r) => s + r.backtrack_count, 0),
				backtracks_by_type: mergeRecords("backtracks_by_type"),
				reasoning_by_intent: mergeRecords("reasoning_by_intent"),
				decision_types: mergeRecords("decision_types"),
				avg_edit_chain_length: totalChains > 0 ? totalChainLinks / totalChains : 0,
				abandoned_edit_rate: editTotal > 0 ? totalAbandoned / editTotal : 0,
				failure_rate: totalToolCalls > 0 ? totalFailures / totalToolCalls : 0,
			}
		})

const computeQualityScore = (totals: InsightsTotals): number => {
	const score = 100
		- (totals.abandoned_edit_rate * 50)
		- (totals.backtrack_rate * 10)
		- (Number.isNaN(totals.avg_drift_score) ? 0 : totals.avg_drift_score * 25)
	return Math.max(0, Math.min(100, score))
}

const computeInsightsTotals = (rows: readonly AnalyticsSummaryRow[]): InsightsTotals => {
	if (rows.length === 0) {
		return {
			sessions: 0, backtrack_rate: 0, abandoned_edit_rate: 0,
			avg_drift_score: Number.NaN, sessions_with_drift: 0,
			reasoning_action_ratio: 0,
			reasoning_distribution: {}, decision_type_distribution: {},
			agent_quality_score: 100,
		}
	}

	const totalBacktracks = rows.reduce((s, r) => s + r.backtrack_count, 0)
	const totalAbandoned = rows.reduce((s, r) => s + r.abandoned_edits, 0)
	const totalSurviving = rows.reduce((s, r) => s + r.surviving_edits, 0)
	const editTotal = totalAbandoned + totalSurviving

	const driftRows = rows.filter((r) => r.drift_score !== undefined)
	const avgDrift = driftRows.length > 0
		? driftRows.reduce((s, r) => s + (r.drift_score ?? 0), 0) / driftRows.length
		: Number.NaN

	const totalReasoning = rows.reduce((s, r) => s + Object.values(r.reasoning_by_intent).reduce((a, b) => a + b, 0), 0)
	const totalToolCalls = rows.reduce((s, r) => s + r.tool_call_count, 0)
	const totalFailures = rows.reduce((s, r) => s + r.failure_count, 0)

	// Merge distributions
	const reasoningDist = rows.reduce<Record<string, number>>(
		(acc, r) => Object.entries(r.reasoning_by_intent).reduce(
			(a, [k, v]) => ({ ...a, [k]: (a[k] ?? 0) + v }),
			acc,
		),
		{},
	)
	const decisionDist = rows.reduce<Record<string, number>>(
		(acc, r) => Object.entries(r.decision_types).reduce(
			(a, [k, v]) => ({ ...a, [k]: (a[k] ?? 0) + v }),
			acc,
		),
		{},
	)

	const failureRate = totalToolCalls > 0 ? totalFailures / totalToolCalls : 0
	const backtrackRate = rows.length > 0 ? totalBacktracks / rows.length : 0
	const abandonedEditRate = editTotal > 0 ? totalAbandoned / editTotal : 0

	const partialTotals: InsightsTotals = {
		sessions: rows.length,
		backtrack_rate: backtrackRate,
		abandoned_edit_rate: abandonedEditRate,
		avg_drift_score: avgDrift,
		sessions_with_drift: driftRows.length,
		reasoning_action_ratio: totalToolCalls > 0 ? totalReasoning / totalToolCalls : 0,
		reasoning_distribution: reasoningDist,
		decision_type_distribution: decisionDist,
		agent_quality_score: 0, // computed below
	}

	// Quality score uses failure_rate from usage computation
	const score = 100
		- (failureRate * 100)
		- (backtrackRate * 10)
		- (abandonedEditRate * 50)
		- (Number.isNaN(avgDrift) ? 0 : avgDrift * 25)

	return {
		...partialTotals,
		agent_quality_score: Math.max(0, Math.min(100, score)),
	}
}

const computeToolErrors = (rows: readonly AnalyticsSummaryRow[]): readonly ToolErrorEntry[] => {
	const byTool = new Map<string, { calls: number; failures: number; errors: Set<string> }>()

	rows.forEach((r) => {
		// Calls come from tools_by_name — without them the per-tool failure_rate
		// denominator is always 0, so every rate rendered as 0 (B11). Rows written
		// before B11 lack tools_by_name; those tools simply report calls=0 / rate n/a.
		Object.entries(r.tools_by_name ?? {}).forEach(([tool, callCount]) => {
			const existing = byTool.get(tool) ?? { calls: 0, failures: 0, errors: new Set<string>() }
			byTool.set(tool, { ...existing, calls: existing.calls + callCount })
		})
		Object.entries(r.failures_by_tool).forEach(([tool, failCount]) => {
			const existing = byTool.get(tool) ?? { calls: 0, failures: 0, errors: new Set<string>() }
			byTool.set(tool, { ...existing, failures: existing.failures + failCount })
		})
		// Also add top_errors samples
		r.top_errors.forEach((e) => {
			const existing = byTool.get(e.tool) ?? { calls: 0, failures: 0, errors: new Set<string>() }
			if (e.message) existing.errors.add(e.message.slice(0, 80))
			byTool.set(e.tool, existing)
		})
	})

	return [...byTool.entries()]
		.filter(([, data]) => data.failures > 0)
		.map(([tool_name, data]) => ({
			tool_name,
			total_calls: data.calls,
			total_failures: data.failures,
			failure_rate: data.calls > 0 ? data.failures / data.calls : 0,
			sample_errors: [...data.errors].slice(0, 3),
		}))
		.sort((a, b) => b.total_failures - a.total_failures)
}

const computeErrorPatterns = (rows: readonly AnalyticsSummaryRow[]): readonly { readonly pattern: string; readonly count: number; readonly tools: readonly string[] }[] => {
	const patterns = new Map<string, { count: number; tools: Set<string> }>()

	rows.forEach((r) => {
		r.top_errors.forEach((e) => {
			const prefix = e.message.slice(0, 80).trim()
			if (!prefix) return
			const existing = patterns.get(prefix) ?? { count: 0, tools: new Set<string>() }
			existing.count += e.count
			existing.tools.add(e.tool)
			patterns.set(prefix, existing)
		})
	})

	return [...patterns.entries()]
		.map(([pattern, data]) => ({ pattern, count: data.count, tools: [...data.tools] }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10)
}

const computeInsightsMetrics = (
	rows: readonly AnalyticsSummaryRow[],
	range: Range,
	rawStartTimes: readonly number[],
): InsightsResponse => {
	const { current, previous } = filterByRange(rows, range)
	const byDate = groupByDate(current)

	const planDriftPoints: readonly PlanDriftPoint[] = current
		.flatMap((r): readonly PlanDriftPoint[] =>
			r.drift_score === undefined
				? []
				: [{
					session_id: r.session_id,
					date: r.date,
					drift_score: r.drift_score,
					unexpected_file_count: r.unexpected_files ?? 0,
				}],
		)

	// Worst sessions by backtrack count
	const worstSessions: readonly WorstSession[] = [...current]
		.sort((a, b) => b.backtrack_count - a.backtrack_count)
		.slice(0, 5)
		.map((r) => ({
			session_id: r.session_id,
			date: r.date,
			backtrack_count: r.backtrack_count,
			cost_usd: r.cost_usd,
			duration_ms: r.duration_ms,
		}))

	// Top backtrack files
	const fileCounts = new Map<string, number>()
	current.forEach((r) => {
		r.backtrack_files.forEach((f) => {
			fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1)
		})
	})
	const topBacktrackFiles = [...fileCounts.entries()]
		.map(([file, count]) => ({ file, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 10)

	return {
		population: computePopulation(rawStartTimes, current, range),
		daily: computeDailyInsights(byDate),
		totals: computeInsightsTotals(current),
		previous_totals: computeInsightsTotals(previous),
		tool_errors: computeToolErrors(current),
		top_backtrack_files: topBacktrackFiles,
		top_error_patterns: computeErrorPatterns(current),
		plan_drift_points: planDriftPoints,
		worst_sessions: worstSessions,
	}
}

// ── In-memory cache ────────────────────────────────────────────────

type CacheEntry<T> = { readonly data: T; readonly timestamp: number }

const cache = new Map<string, CacheEntry<unknown>>()
const CACHE_TTL_MS = 60_000 // 1 minute

const getCached = <T>(key: string): T | undefined => {
	const entry = cache.get(key) as CacheEntry<T> | undefined
	if (!entry) return undefined
	if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
		cache.delete(key)
		return undefined
	}
	return entry.data
}

const setCache = <T>(key: string, data: T): void => {
	cache.set(key, { data, timestamp: Date.now() })
}

/** Invalidate all analytics caches (call after distill). */
export const invalidateAnalyticsCache = (): void => {
	cache.clear()
}

// ── Route factories ────────────────────────────────────────────────

const loadRows = (projectDir: string): readonly AnalyticsSummaryRow[] => {
	const cacheKey = `rows:${projectDir}`
	const cached = getCached<readonly AnalyticsSummaryRow[]>(cacheKey)
	if (cached) return cached
	const rows = readAnalyticsSummary(projectDir)
	// Only cache non-empty results to avoid caching missing data
	if (rows.length > 0) setCache(cacheKey, rows)
	return rows
}

/** First-line `.t` of one session file, reading only the head chunk (cheap). */
const readFirstEventTime = (filePath: string): number | undefined => {
	try {
		const fd = openSync(filePath, "r")
		try {
			const buf = Buffer.alloc(16384)
			const bytesRead = readSync(fd, buf, 0, 16384, 0)
			const head = buf.toString("utf-8", 0, bytesRead)
			const firstLine = head.slice(0, head.indexOf("\n") === -1 ? head.length : head.indexOf("\n"))
			const parsed: unknown = JSON.parse(firstLine)
			const t = parsed && typeof parsed === "object" ? (parsed as { t?: unknown }).t : undefined
			return typeof t === "number" ? t : undefined
		} finally {
			closeSync(fd)
		}
	} catch {
		return undefined
	}
}

/**
 * Start times of every RAW session (distilled or not). Source of truth for the
 * population "total" so analytics can report coverage rather than passing off the
 * distilled subset as the whole (B10). Reads only each file's head chunk — a full
 * listSessions() parse here made the two analytics endpoints scan every byte of
 * every session. Cached on the same TTL as the rows; empty results are cached too
 * (an empty project is a valid answer, not a cache miss).
 */
const loadRawStartTimes = (projectDir: string): readonly number[] => {
	const cacheKey = `rawStarts:${projectDir}`
	const cached = getCached<readonly number[]>(cacheKey)
	if (cached) return cached
	const sessionsDir = `${projectDir}/.clens/sessions`
	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl")
		} catch {
			return []
		}
	})()
	const starts = files.flatMap((f) => {
		const t = readFirstEventTime(`${sessionsDir}/${f}`)
		return t === undefined ? [] : [t]
	})
	setCache(cacheKey, starts)
	return starts
}

export const createAnalyticsRoute = (projectDir: string) => {
	const app = new Hono()

	app.get("/usage", (c) => {
		const range = parseRange(c.req.query("range"))
		log.info(`GET /api/analytics/usage range=${range}`)
		const rows = loadRows(projectDir)
		const data = computeUsageMetrics(rows, range, loadRawStartTimes(projectDir))
		return c.json({ data })
	})

	app.get("/insights", (c) => {
		const range = parseRange(c.req.query("range"))
		log.info(`GET /api/analytics/insights range=${range}`)
		const rows = loadRows(projectDir)
		const data = computeInsightsMetrics(rows, range, loadRawStartTimes(projectDir))
		return c.json({ data })
	})

	// POST /rebuild — force-rebuild analytics-summary.jsonl from distilled/*.json
	app.post("/rebuild", (c) => {
		log.info("POST /api/analytics/rebuild")
		invalidateAnalyticsCache()
		const count = rebuildAnalyticsSummary(projectDir)
		log.info(`Rebuilt analytics summary: ${count} sessions`)
		return c.json({ data: { rebuilt: count } })
	})

	return app
}

export const createGlobalAnalyticsRoute = (projects: readonly ProjectEntry[], fallbackDir: string) => {
	const app = new Hono()

	const effectiveDirsFor = (projectFilter?: string): readonly string[] => {
		const dirs = projectFilter
			? projects.filter((p) => p.id === projectFilter).map((p) => p.path)
			: projects.map((p) => p.path)
		return dirs.length > 0 ? dirs : [fallbackDir]
	}

	const loadAllRows = (projectFilter?: string): readonly AnalyticsSummaryRow[] =>
		effectiveDirsFor(projectFilter).flatMap((dir) => loadRows(dir))

	const loadAllRawStartTimes = (projectFilter?: string): readonly number[] =>
		effectiveDirsFor(projectFilter).flatMap((dir) => loadRawStartTimes(dir))

	app.get("/usage", (c) => {
		const range = parseRange(c.req.query("range"))
		const project = c.req.query("project")
		log.info(`GET /api/analytics/usage range=${range} project=${project ?? "all"}`)
		const rows = loadAllRows(project)
		const data = computeUsageMetrics(rows, range, loadAllRawStartTimes(project))
		return c.json({ data })
	})

	app.get("/insights", (c) => {
		const range = parseRange(c.req.query("range"))
		const project = c.req.query("project")
		log.info(`GET /api/analytics/insights range=${range} project=${project ?? "all"}`)
		const rows = loadAllRows(project)
		const data = computeInsightsMetrics(rows, range, loadAllRawStartTimes(project))
		return c.json({ data })
	})

	// POST /rebuild — force-rebuild analytics from all projects
	app.post("/rebuild", (c) => {
		log.info("POST /api/analytics/rebuild (global)")
		invalidateAnalyticsCache()
		const dirs = projects.map((p) => p.path)
		const effectiveDirs = dirs.length > 0 ? dirs : [fallbackDir]
		let total = 0
		effectiveDirs.forEach((dir) => { total += rebuildAnalyticsSummary(dir) })
		log.info(`Rebuilt analytics summary: ${total} sessions across ${effectiveDirs.length} projects`)
		return c.json({ data: { rebuilt: total } })
	})

	return app
}

import { createMemo, For, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { RefreshCw, RotateCcw } from "lucide-solid";
import {
	analyticsRange,
	setAnalyticsRange,
	usageData,
	refetchUsage,
	dailyUsage,
	usageTotals,
	usagePreviousTotals,
	modelBreakdown,
	agentTypeBreakdown,
	computeDelta,
	computePpDelta,
	rebuildAnalytics,
	isRebuilding,
	usagePopulation,
	isValidDayKey,
	type AnalyticsRange,
	type DeltaResult,
	type DailyUsageMetrics,
} from "../lib/analytics-store";
import { formatDuration } from "../lib/format";
import { BarChart } from "../components/charts/BarChart";
import { LineChart } from "../components/charts/LineChart";
import { StackedArea } from "../components/charts/StackedArea";
import { DonutChart } from "../components/charts/DonutChart";
import { HorizontalBar } from "../components/charts/HorizontalBar";
import { ChartTooltip, TOKEN_COLORS, CHART_COLORS, formatCompact } from "../components/charts";
import { TelescopeIllustration } from "../components/ui/EmptyState";
import { ProjectDropdown } from "../components/ProjectDropdown";

// ── Range selector ──────────────────────────────────────────────────

const RANGES: readonly AnalyticsRange[] = ["7d", "30d", "90d", "all"] as const;

const RangeSelector: Component = () => (
	<div class="flex items-center gap-1">
		<For each={RANGES}>
			{(r) => (
				<button
					onClick={() => setAnalyticsRange(r)}
					class="instrument-microcaps rounded-none border px-2.5 py-1 text-[10px] transition"
					classList={{
						"text-primary bg-surface-muted border-brand-500": analyticsRange() === r,
						"text-muted border-clens hover:text-secondary hover:bg-surface-hover": analyticsRange() !== r,
					}}
				>
					{r === "all" ? "All" : r}
				</button>
			)}
		</For>
	</div>
);

// ── KPI Card ────────────────────────────────────────────────────────

type KpiCardProps = {
	readonly label: string;
	readonly value: string;
	readonly delta?: DeltaResult;
	readonly deltaLabel?: string;
	readonly tooltip?: string;
	readonly subtitle?: string;
};

const KpiCard: Component<KpiCardProps> = (props) => (
	<div class="rounded-none border border-clens bg-surface p-4" title={props.tooltip}>
		<div class="instrument-microcaps text-[10px] text-muted">{props.label}</div>
		<div class="mt-1 font-mono tabular-nums text-2xl font-semibold text-primary">{props.value}</div>
		<Show when={props.subtitle}>
			<div class="mt-0.5 text-xs text-muted">{props.subtitle}</div>
		</Show>
		<Show when={props.delta && props.delta.direction !== "flat"}>
			<div class="mt-1 flex items-center gap-1 text-xs">
				<span classList={{
					"text-success": props.delta?.direction === "up" && props.label !== "Total Cost",
					"text-danger": props.delta?.direction === "down" && props.label !== "Total Cost" || props.delta?.direction === "up" && props.label === "Total Cost",
					"text-success hidden2": props.delta?.direction === "down" && props.label === "Total Cost",
				}}>
					{props.delta?.direction === "up" ? "+" : "-"}
					{props.delta?.value.toFixed(1)}
					{props.deltaLabel ?? "%"}
				</span>
				<span class="instrument-microcaps text-[10px] text-muted">vs prev</span>
			</div>
		</Show>
	</div>
);

// ── Section header ──────────────────────────────────────────────────

const SectionHeader: Component<{ readonly title: string }> = (props) => (
	<h3 class="instrument-microcaps text-[11px] text-muted mb-2">{props.title}</h3>
);

// ── Empty state ─────────────────────────────────────────────────────

const EmptyState: Component = () => (
	<div class="flex flex-col items-center justify-center py-20 text-center">
		<TelescopeIllustration class="h-16 w-16 text-muted mb-4" />
		<h2 class="instrument-microcaps text-sm text-secondary">No analytics data yet</h2>
		<p class="mt-2 text-sm text-muted max-w-md">
			If you have distilled sessions, click rebuild to extract analytics data.
		</p>
		<button
			onClick={() => rebuildAnalytics()}
			disabled={isRebuilding()}
			class="instrument-microcaps mt-4 rounded-none border border-brand-500 bg-brand-500 px-4 py-2 text-[10px] text-surface hover:bg-brand-600 transition disabled:opacity-50"
		>
			{isRebuilding() ? "Rebuilding..." : "Rebuild Analytics"}
		</button>
		<p class="mt-3 text-xs text-muted">
			Or run <code class="rounded-none border border-clens bg-surface-inset px-1.5 py-0.5 font-mono text-xs">clens distill --all</code> to distill and generate analytics.
		</p>
	</div>
);

// ── Main page ───────────────────────────────────────────────────────

export const UsagePage: Component = () => {
	const navigate = useNavigate();

	// Navigate to the session list filtered to the clicked day. The list consumes
	// the `date` query param and keeps only sessions whose start_time falls on that
	// LOCAL calendar day (B22 — previously this param went nowhere). `agents=all`
	// is set so single-day drill-downs aren't silently narrowed by the default
	// top-level-only filter.
	const navigateToDate = (d: unknown) => {
		const datum = d as DailyUsageMetrics;
		if (!isValidDayKey(datum.date)) return;
		navigate(`/?date=${encodeURIComponent(datum.date)}&agents=all`);
	};

	const totals = usageTotals;
	const prevTotals = usagePreviousTotals;
	const population = usagePopulation;
	const isLoading = () => usageData.loading;
	const isEmpty = () => !isLoading() && (totals()?.sessions ?? 0) === 0;

	// Comparison deltas are meaningless when the previous window held no sessions —
	// a "+X vs prev" against an empty baseline misleads (B10). Gate every delta on a
	// non-empty previous window.
	const hasPrevBaseline = createMemo(() => (prevTotals()?.sessions ?? 0) > 0);

	// Cost has no signal when nothing in the window is priced — show an em dash, not
	// a fake "$0.00" (B10).
	const hasCost = createMemo(() => (totals()?.sessions_with_cost ?? 0) > 0);

	// KPI deltas
	const costDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline() ? computeDelta(totals()!.cost_usd, prevTotals()!.cost_usd) : undefined,
	);
	const sessionDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline() ? computeDelta(totals()!.sessions, prevTotals()!.sessions) : undefined,
	);
	const cacheDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline() ? computePpDelta(totals()!.cache_hit_rate, prevTotals()!.cache_hit_rate) : undefined,
	);
	const durationDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline() ? computeDelta(totals()!.avg_duration_ms, prevTotals()!.avg_duration_ms) : undefined,
	);

	// "n of m sessions analyzed" — analyzed = distilled (drives every metric),
	// total = all raw sessions in the window (B10).
	const coverageLabel = createMemo(() => {
		const p = population();
		if (!p) return undefined;
		return `${p.analyzed} of ${p.total} sessions analyzed`;
	});

	// Model breakdown donut segments
	const modelSegments = createMemo(() =>
		modelBreakdown().map((m, i) => ({
			label: m.model,
			value: m.cost_usd,
			color: [CHART_COLORS.blue, CHART_COLORS.violet, CHART_COLORS.emerald, CHART_COLORS.amber, CHART_COLORS.pink][i % 5],
		})),
	);

	return (
		<div class="mx-auto max-w-7xl px-4 py-6">
			<ChartTooltip />

			{/* Header */}
			<div class="flex items-center justify-between mb-6">
				<h1 class="text-xl font-semibold text-primary">Usage</h1>
					<div class="instrument-ruler mt-1.5 w-40" />
				<div class="flex items-center gap-3">
					<ProjectDropdown />
					<RangeSelector />
					<button
						onClick={() => rebuildAnalytics()}
						disabled={isRebuilding()}
						class="rounded-none border border-clens p-1.5 text-muted hover:text-secondary hover:bg-surface-hover hover:border-brand-500 transition disabled:opacity-50"
						title="Rebuild analytics from distilled sessions"
					>
						<RotateCcw class="h-4 w-4" classList={{ "animate-spin": isRebuilding() }} />
					</button>
					<button
						onClick={() => refetchUsage()}
						class="rounded-none border border-clens p-1.5 text-muted hover:text-secondary hover:bg-surface-hover hover:border-brand-500 transition"
						title="Refresh"
					>
						<RefreshCw class="h-4 w-4" />
					</button>
				</div>
			</div>

			{/* Loading */}
			<Show when={isLoading()}>
				<div class="flex items-center justify-center py-20">
					<div class="h-6 w-6 animate-spin rounded-none border-2 border-brand-500 border-t-transparent" />
				</div>
			</Show>

			{/* Empty state */}
			<Show when={isEmpty()}>
				<EmptyState />
			</Show>

			{/* Content */}
			<Show when={!isLoading() && !isEmpty()}>
				{/* KPI Cards */}
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
					<KpiCard
						label="Total Cost"
						value={hasCost() ? `$${(totals()?.cost_usd ?? 0).toFixed(2)}` : "—"}
						delta={hasCost() ? costDelta() : undefined}
						tooltip={hasCost()
							? `Cost data available for ${totals()?.sessions_with_cost ?? 0}/${totals()?.sessions ?? 0} sessions`
							: "no priced sessions"}
					/>
					<KpiCard
						label="Total Sessions"
						value={String(totals()?.sessions ?? 0)}
						delta={sessionDelta()}
						subtitle={coverageLabel()}
					/>
					<KpiCard
						label="Cache Hit Rate"
						value={`${((totals()?.cache_hit_rate ?? 0) * 100).toFixed(0)}%`}
						delta={cacheDelta()}
						deltaLabel="pp"
					/>
					<KpiCard
						label="Avg Duration"
						value={formatDuration(totals()?.avg_duration_ms ?? 0)}
						delta={durationDelta()}
					/>
				</div>

				{/* Token Composition */}
				<div class="mb-6 rounded-none border border-clens bg-surface p-4">
					<SectionHeader title="Token Composition" />
					<StackedArea
						data={dailyUsage()}
						x={(d) => d.date}
						height={220}
						ariaLabel="Daily token composition stacked area chart"
						series={[
							{ key: "cache_read", label: "Cache Read", color: TOKEN_COLORS.cache_read },
							{ key: "input", label: "Input", color: TOKEN_COLORS.input },
							{ key: "output", label: "Output", color: TOKEN_COLORS.output },
							{ key: "cache_create", label: "Cache Create", color: TOKEN_COLORS.cache_create },
						]}
						getValue={(d, key) => {
							const map: Record<string, number> = {
								cache_read: d.cache_read_tokens,
								input: d.total_input_tokens,
								output: d.total_output_tokens,
								cache_create: d.cache_creation_tokens,
							};
							return map[key] ?? 0;
						}}
						tooltipLabel={(d) =>
							`${d.date}: ${formatCompact(d.total_input_tokens + d.total_output_tokens + d.cache_read_tokens + d.cache_creation_tokens)} tokens`
						}
						onClickPoint={(d) => navigateToDate(d)}
					/>
				</div>

				{/* Cost Trend */}
				<div class="mb-6 rounded-none border border-clens bg-surface p-4">
					<SectionHeader title="Cost Trend" />
					<LineChart
						data={dailyUsage()}
						x={(d) => d.date}
						y={(d) => d.total_cost_usd}
						height={180}
						color={CHART_COLORS.pink}
						fillArea
						ariaLabel="Daily cost trend line chart"
						formatY={(v) => `$${v.toFixed(2)}`}
						tooltipLabel={(d) => `${d.date}: $${d.total_cost_usd.toFixed(2)}`}
						onClickPoint={(d) => navigateToDate(d)}
					/>
				</div>

				{/* Session Volume + Cache Efficiency (side by side) */}
				<div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Session Volume" />
						<BarChart
							data={dailyUsage()}
							x={(d) => d.date}
							y={(d) => d.session_count}
							height={180}
							color={CHART_COLORS.blue}
							ariaLabel="Daily session count bar chart"
							tooltipLabel={(d) =>
								`${d.date}: ${d.session_count} sessions, median ${formatDuration(d.median_duration_ms)}`
							}
							onClickPoint={(d) => navigateToDate(d)}
						/>
					</div>
					<div class="rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Cache Efficiency" />
						<LineChart
							data={dailyUsage()}
							x={(d) => d.date}
							y={(d) => d.cache_hit_rate * 100}
							height={180}
							color={CHART_COLORS.emerald}
							fillArea
							ariaLabel="Cache hit rate area chart"
							formatY={(v) => `${v.toFixed(0)}%`}
							tooltipLabel={(d) => `${d.date}: ${(d.cache_hit_rate * 100).toFixed(1)}% cache hit rate`}
						/>
					</div>
				</div>

				{/* Agent Types */}
				<Show when={agentTypeBreakdown().length > 0}>
					<div class="mb-6 rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Agent Types" />
						<div class="overflow-x-auto">
							<table class="w-full text-xs">
								<thead>
									<tr class="text-left text-muted border-b border-clens">
										<th class="instrument-microcaps py-2 pr-4 text-[10px]">Type</th>
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Spawns</th>
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Sessions</th>
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Avg Cost</th>
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Avg Duration</th>
										<th class="instrument-microcaps py-2 text-[10px] text-right">Fail Rate</th>
									</tr>
								</thead>
								<tbody>
									<For each={agentTypeBreakdown()}>
										{(a) => (
											<tr class="border-b border-clens/50 hover:bg-surface-hover cursor-pointer transition">
												<td class="py-2 pr-4 font-medium text-primary">{a.agent_type}</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">{a.spawn_count}</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">{a.sessions_appeared_in}</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">${a.avg_cost_usd.toFixed(2)}</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">{formatDuration(a.avg_duration_ms)}</td>
												<td class="py-2 text-right font-mono tabular-nums text-secondary">{(a.avg_failure_rate * 100).toFixed(1)}%</td>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
					</div>
				</Show>

				{/* Model Breakdown */}
				<Show when={modelSegments().length > 0}>
					<div class="mb-6 rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Model Breakdown" />
						<DonutChart
							segments={modelSegments()}
							ariaLabel="Model cost breakdown donut chart"
							centerLabel="Total"
							centerValue={`$${(totals()?.cost_usd ?? 0).toFixed(2)}`}
							formatValue={(v) => `$${v.toFixed(2)}`}
						/>
					</div>
				</Show>
			</Show>
		</div>
	);
};

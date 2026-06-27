import { createMemo, For, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { RefreshCw, RotateCcw, X } from "lucide-solid";
import {
	analyticsRange,
	setAnalyticsRange,
	customRange,
	setCustomRange,
	clearCustomRange,
	insightsData,
	refetchInsights,
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
	insightsPopulation,
	isValidDayKey,
	type AnalyticsRange,
	type DeltaResult,
	type DailyInsightsMetrics,
} from "../lib/analytics-store";
import { formatShortDate } from "../components/charts/shared";
import { formatDuration } from "../lib/format";
import { BarChart } from "../components/charts/BarChart";
import { StackedArea } from "../components/charts/StackedArea";
import { StackedBar } from "../components/charts/StackedBar";
import { DonutChart } from "../components/charts/DonutChart";
import { ScatterPlot } from "../components/charts/ScatterPlot";
import { ChartTooltip, BACKTRACK_COLORS, REASONING_COLORS, CHART_COLORS, formatCompact } from "../components/charts";
import { TelescopeIllustration } from "../components/ui/EmptyState";
import { ProjectDropdown } from "../components/ProjectDropdown";

// ── Range selector ──────────────────────────────────────────────────

const RANGES: readonly AnalyticsRange[] = ["7d", "30d", "90d", "all"] as const;

// A custom brush window (set by dragging a time chart) takes precedence over the
// preset chips and re-scopes every Insights number/chart via the shared store.
// While it is active no preset is "selected"; clicking one clears the brush.
const RangeSelector: Component = () => {
	const isCustom = createMemo(() => customRange() !== undefined);
	const selectPreset = (r: AnalyticsRange) => {
		clearCustomRange();
		setAnalyticsRange(r);
	};
	return (
		<div class="flex items-center gap-1">
			<For each={RANGES}>
				{(r) => (
					<button
						onClick={() => selectPreset(r)}
						class="instrument-microcaps rounded-none border px-2.5 py-1 text-[10px] transition"
						classList={{
							"text-primary bg-surface-muted border-brand-500": !isCustom() && analyticsRange() === r,
							"text-muted border-clens hover:text-secondary hover:bg-surface-hover": isCustom() || analyticsRange() !== r,
						}}
					>
						{r === "all" ? "All" : r}
					</button>
				)}
			</For>
		</div>
	);
};

// ── Custom range chip (AC8) ─────────────────────────────────────────
//
// When a brush window is active, surface the resolved dates and a control to
// clear back to the active preset. Mirrors the Usage page so brushing on either
// tab reads identically.
const CustomRangeChip: Component = () => (
	<Show when={customRange()}>
		{(range) => (
			<div class="instrument-microcaps flex items-center gap-1.5 rounded-none border border-brand-500 bg-surface-muted px-2.5 py-1 text-[10px] text-primary">
				<span class="h-1.5 w-1.5 shrink-0 bg-brand-500" />
				<span>Custom</span>
				<span class="font-mono tabular-nums text-secondary normal-case tracking-normal">
					{formatShortDate(range().from)}–{formatShortDate(range().to)}
				</span>
				<button
					onClick={() => clearCustomRange()}
					class="ml-0.5 -mr-0.5 text-muted transition-colors hover:text-danger"
					title="Clear custom range"
					aria-label="Clear custom range"
				>
					<X class="h-3 w-3" />
				</button>
			</div>
		)}
	</Show>
);

// ── KPI Card ────────────────────────────────────────────────────────

type KpiCardProps = {
	readonly label: string;
	readonly value: string;
	readonly delta?: DeltaResult;
	readonly deltaLabel?: string;
	readonly invertColor?: boolean; // true = "down is good" (e.g., backtrack rate)
	readonly subtitle?: string;
	readonly muted?: boolean; // dim the value when it represents "no reading" rather than a real datum
	readonly valueTitle?: string; // native tooltip for the value (e.g. explaining a "—")
};

const KpiCard: Component<KpiCardProps> = (props) => (
	<div class="group rounded-none border border-clens bg-surface p-4 transition-colors hover:border-brand-500/60 hover:bg-surface-hover">
		<div class="instrument-microcaps text-[10px] text-muted">{props.label}</div>
		<div
			title={props.valueTitle}
			class="mt-1 font-mono tabular-nums text-2xl font-semibold"
			classList={{
				"text-primary": !props.muted,
				"text-muted": props.muted,
				"cursor-help": Boolean(props.valueTitle),
			}}
		>
			{props.value}
		</div>
		<Show when={props.subtitle}>
			<div class="mt-0.5 text-xs text-muted">{props.subtitle}</div>
		</Show>
		<Show when={props.delta && props.delta.direction !== "flat"}>
			<div class="mt-1 flex items-center gap-1 text-xs">
				<span classList={{
					"text-success": (props.invertColor
						? props.delta?.direction === "down"
						: props.delta?.direction === "up"),
					"text-danger": (props.invertColor
						? props.delta?.direction === "up"
						: props.delta?.direction === "down"),
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
	<div class="mb-3 flex items-center gap-2">
		<span class="h-1.5 w-1.5 shrink-0 bg-brand-500/70" />
		<h3 class="instrument-microcaps text-[11px] text-secondary">{props.title}</h3>
	</div>
);

// ── Highlights ──────────────────────────────────────────────────────

const Highlights: Component = () => {
	const totals = insightsTotals;
	const prev = insightsPreviousTotals;
	const files = topBacktrackFiles;

	const sentences = createMemo(() => {
		const t = totals();
		const p = prev();
		if (!t || !p) return [];
		const result: string[] = [];

		// Backtrack trend
		if (p.backtrack_rate > 0) {
			const change = ((t.backtrack_rate - p.backtrack_rate) / p.backtrack_rate) * 100;
			const dir = change < -5 ? "down" : change > 5 ? "up" : "steady";
			if (dir !== "steady") {
				result.push(`Backtracks ${dir} ${Math.abs(change).toFixed(0)}% vs last period.`);
			}
		}

		// Edit survival
		if (t.abandoned_edit_rate < 1) {
			const survival = ((1 - t.abandoned_edit_rate) * 100).toFixed(0);
			result.push(`Edit survival at ${survival}%.`);
		}

		// Hotspot file
		const topFile = files()[0];
		if (topFile) {
			const basename = topFile.file.split("/").pop() ?? topFile.file;
			result.push(`${basename} remains a hotspot with ${topFile.count} backtracks.`);
		}

		// Quality score — only surface when we actually have a positive reading;
		// a "0/100" headline reads as a catastrophic failure rather than "no data".
		if (t.agent_quality_score > 0) {
			result.push(`Quality score: ${t.agent_quality_score.toFixed(0)}/100.`);
		}

		return result;
	});

	return (
		<Show when={sentences().length > 0}>
			<div class="mb-6 rounded-none border-l-2 border-brand-500 bg-surface-inset p-4 text-sm text-secondary italic">
				{sentences().join(" ")}
			</div>
		</Show>
	);
};

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

// ── Decision patterns bucketing ─────────────────────────────────────

type BucketedDecision = {
	readonly label: string;
	readonly timing_gap: number;
	readonly tool_pivot: number;
	readonly phase_boundary: number;
	readonly task_delegation: number;
};

const bucketDecisions = (
	daily: readonly DailyInsightsMetrics[],
	range: AnalyticsRange,
): readonly BucketedDecision[] => {
	// Weekly buckets for 30d+ ranges, daily for 7d
	const useWeekly = range !== "7d";
	if (!useWeekly) {
		return daily.map((d) => ({
			label: d.date,
			timing_gap: d.decision_types["timing_gap"] ?? 0,
			tool_pivot: d.decision_types["tool_pivot"] ?? 0,
			phase_boundary: d.decision_types["phase_boundary"] ?? 0,
			task_delegation: d.decision_types["task_delegation"] ?? 0,
		}));
	}

	// Group by ISO week
	const weeks = new Map<string, BucketedDecision>();
	daily.forEach((d) => {
		const date = new Date(d.date);
		const weekStart = new Date(date);
		weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
		const key = weekStart.toISOString().slice(0, 10);
		const existing = weeks.get(key) ?? {
			label: key, timing_gap: 0, tool_pivot: 0, phase_boundary: 0, task_delegation: 0,
		};
		weeks.set(key, {
			label: key,
			timing_gap: existing.timing_gap + (d.decision_types["timing_gap"] ?? 0),
			tool_pivot: existing.tool_pivot + (d.decision_types["tool_pivot"] ?? 0),
			phase_boundary: existing.phase_boundary + (d.decision_types["phase_boundary"] ?? 0),
			task_delegation: existing.task_delegation + (d.decision_types["task_delegation"] ?? 0),
		});
	});

	return [...weeks.values()].sort((a, b) => a.label.localeCompare(b.label));
};

// ── Main page ───────────────────────────────────────────────────────

export const InsightsPage: Component = () => {
	const navigate = useNavigate();

	const totals = insightsTotals;
	const prevTotals = insightsPreviousTotals;
	const population = insightsPopulation;
	const isLoading = () => insightsData.loading;
	const isEmpty = () => !isLoading() && (totals()?.sessions ?? 0) === 0;

	// Hide "vs prev" deltas when the previous window held no sessions — comparing
	// against an empty baseline is misleading (B10).
	const hasPrevBaseline = createMemo(() => (prevTotals()?.sessions ?? 0) > 0);

	// "n of m sessions analyzed" coverage line near the KPIs (B10).
	const coverageLabel = createMemo(() => {
		const p = population();
		if (!p) return undefined;
		return `${p.analyzed} of ${p.total} sessions analyzed`;
	});

	// KPI deltas
	const backtrackDelta = createMemo(() => {
		const t = totals();
		const p = prevTotals();
		return t && p && hasPrevBaseline() ? computeDelta(t.backtrack_rate, p.backtrack_rate) : undefined;
	});
	const editSurvival = createMemo(() => {
		const t = totals();
		return t ? ((1 - t.abandoned_edit_rate) * 100).toFixed(0) : "N/A";
	});
	const editSurvivalDelta = createMemo(() => {
		const t = totals();
		const p = prevTotals();
		if (!t || !p || !hasPrevBaseline()) return undefined;
		// invert: less abandoned = better
		return computePpDelta(1 - t.abandoned_edit_rate, 1 - p.abandoned_edit_rate);
	});
	const reasoningDelta = createMemo(() => {
		const t = totals();
		const p = prevTotals();
		return t && p && hasPrevBaseline() ? computeDelta(t.reasoning_action_ratio, p.reasoning_action_ratio) : undefined;
	});

	// Has edit chain data?
	const hasEditChains = createMemo(() =>
		dailyInsights().some((d) => d.avg_edit_chain_length > 0),
	);

	// Reasoning donut segments
	const reasoningSegments = createMemo(() => {
		const dist = totals()?.reasoning_distribution ?? {};
		return Object.entries(dist)
			.filter(([, v]) => v > 0)
			.map(([key, value]) => ({
				label: key,
				value,
				color: REASONING_COLORS[key] ?? CHART_COLORS.slate,
			}))
			.sort((a, b) => b.value - a.value);
	});

	// Decision patterns
	const decisionBuckets = createMemo(() =>
		bucketDecisions(dailyInsights(), analyticsRange()),
	);

	// Quality score — a raw "0/100" reads as a catastrophic grade rather than
	// "not yet measured". Treat a zero/absent score as no-reading and render a
	// neutral em-dash with an explanatory tooltip (no change to the data itself).
	const qualityScore = createMemo(() => totals()?.agent_quality_score ?? 0);
	const hasQualityScore = createMemo(() => qualityScore() > 0);

	// Top reasoning category insight
	const topReasoningInsight = createMemo(() => {
		const segs = reasoningSegments();
		if (segs.length === 0) return undefined;
		const total = segs.reduce((s, seg) => s + seg.value, 0);
		if (total === 0) return undefined;
		const top = segs[0];
		const pct = ((top.value / total) * 100).toFixed(0);
		return `Your agent spends ${pct}% of thinking time ${top.label}.`;
	});

	return (
		<div class="mx-auto max-w-7xl px-4 py-6">
			<ChartTooltip />

			{/* Header */}
			<div class="flex items-end justify-between mb-6">
				<div>
					<h1 class="text-xl font-semibold text-primary leading-none">Insights</h1>
					<div class="instrument-ruler mt-2 w-40" />
				</div>
				<div class="flex items-center gap-3">
					<ProjectDropdown />
					<CustomRangeChip />
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
						onClick={() => refetchInsights()}
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
						label="Quality Score"
						value={hasQualityScore() ? `${qualityScore().toFixed(0)}/100` : "—"}
						muted={!hasQualityScore()}
						valueTitle={hasQualityScore() ? undefined : "Quality score not yet available for this range — distill more sessions to populate it."}
						subtitle={coverageLabel()}
					/>
					<KpiCard
						label="Backtrack Rate"
						value={`${(totals()?.backtrack_rate ?? 0).toFixed(1)}/sess`}
						delta={backtrackDelta()}
						invertColor
					/>
					<KpiCard
						label="Edit Survival"
						value={hasEditChains() ? `${editSurvival()}%` : "N/A"}
						delta={hasEditChains() ? editSurvivalDelta() : undefined}
					/>
					<KpiCard
						label="Reasoning Ratio"
						value={(totals()?.reasoning_action_ratio ?? 0).toFixed(2)}
						delta={reasoningDelta()}
					/>
				</div>

				{/* Highlights */}
				<Highlights />

				{/* Edit Efficiency (only when edit chains exist) */}
				<Show when={hasEditChains()}>
					<div class="mb-6 rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Edit Efficiency" />
						<div class="mb-3 text-xs text-muted">
							<span class="font-mono tabular-nums text-secondary">{editSurvival()}%</span> of edits survive to final state
						</div>
						<BarChart
							data={dailyInsights()}
							x={(d) => d.date}
							y={(d) => d.avg_edit_chain_length}
							height={180}
							color={CHART_COLORS.violet}
							ariaLabel="Average edit chain length per day"
							tooltipLabel={(d) =>
								`${d.date}: ${d.avg_edit_chain_length.toFixed(1)} avg chain length, ${((1 - d.abandoned_edit_rate) * 100).toFixed(0)}% survival`
							}
							onBrushSelect={(r) => setCustomRange({ from: r.start, to: r.end })}
						/>
					</div>
				</Show>

				{/* Plan Drift (only when 5+ data points) */}
				<Show when={planDriftPoints().length >= 5}>
					<div class="mb-6 rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Plan Drift" />
						<ScatterPlot
							data={planDriftPoints()}
							x={(d) => d.date}
							y={(d) => d.drift_score}
							size={(d) => 3 + d.unexpected_file_count * 2}
							height={200}
							ariaLabel="Plan drift score scatter plot"
							tooltipLabel={(d) =>
								`${d.session_id.slice(0, 8)}: drift ${d.drift_score.toFixed(2)}, ${d.unexpected_file_count} unexpected files`
							}
							onClickPoint={(d) => {
								const point = d as { session_id: string };
								navigate(`/session/${point.session_id}`);
							}}
						/>
					</div>
				</Show>

				{/* Backtrack Trends */}
				<div class="mb-6 rounded-none border border-clens bg-surface p-4">
					<SectionHeader title="Backtrack Trends" />
					<StackedArea
						data={dailyInsights()}
						x={(d) => d.date}
						height={200}
						ariaLabel="Backtrack trends by type stacked area chart"
						series={[
							{ key: "failure_retry", label: "Failure Retry", color: BACKTRACK_COLORS.failure_retry },
							{ key: "iteration_struggle", label: "Iteration", color: BACKTRACK_COLORS.iteration_struggle },
							{ key: "debugging_loop", label: "Debug Loop", color: BACKTRACK_COLORS.debugging_loop },
						]}
						getValue={(d, key) => d.backtracks_by_type[key] ?? 0}
						tooltipLabel={(d) => `${d.date}: ${d.backtrack_count} backtracks`}
						onClickPoint={(d) => {
							const datum = d as DailyInsightsMetrics;
							if (!isValidDayKey(datum.date)) return;
							navigate(`/?date=${encodeURIComponent(datum.date)}&agents=all`);
						}}
						onBrushSelect={(r) => setCustomRange({ from: r.start, to: r.end })}
					/>
				</div>

				{/* Reasoning Distribution + Decision Patterns (side by side) */}
				<div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Reasoning Distribution" />
						<Show when={reasoningSegments().length > 0} fallback={
							<div class="instrument-microcaps py-10 text-center text-[10px] text-muted">No reasoning data</div>
						}>
							<DonutChart
								segments={reasoningSegments()}
								ariaLabel="Reasoning distribution donut chart"
								centerLabel="Turns"
								centerValue={formatCompact(reasoningSegments().reduce((s, seg) => s + seg.value, 0))}
							/>
							<Show when={topReasoningInsight()}>
								<div class="mt-3 border-t border-clens/60 pt-3 text-xs italic text-muted">{topReasoningInsight()}</div>
							</Show>
						</Show>
					</div>
					<div class="rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Decision Patterns" />
						<Show when={decisionBuckets().length > 0} fallback={
							<div class="instrument-microcaps py-10 text-center text-[10px] text-muted">No decision data</div>
						}>
							<StackedBar
								data={decisionBuckets()}
								x={(d) => d.label}
								height={200}
								ariaLabel="Decision patterns stacked bar chart"
								series={[
									{ key: "timing_gap", label: "Timing Gap", color: CHART_COLORS.blue },
									{ key: "tool_pivot", label: "Tool Pivot", color: CHART_COLORS.amber },
									{ key: "phase_boundary", label: "Phase Boundary", color: CHART_COLORS.emerald },
									{ key: "task_delegation", label: "Task Delegation", color: CHART_COLORS.violet },
								]}
								getValue={(d, key) => {
									const map: Record<string, number> = {
										timing_gap: d.timing_gap,
										tool_pivot: d.tool_pivot,
										phase_boundary: d.phase_boundary,
										task_delegation: d.task_delegation,
									};
									return map[key] ?? 0;
								}}
							/>
						</Show>
					</div>
				</div>

				{/* Tool Errors + Error Patterns (side by side) */}
				<Show when={toolErrors().length > 0 || topErrorPatterns().length > 0}>
					<div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
						<Show when={toolErrors().length > 0}>
							<div class="rounded-none border border-clens bg-surface p-4">
								<SectionHeader title="Tool Errors" />
								<div class="overflow-x-auto">
									<table class="w-full text-xs">
										<thead>
											<tr class="text-left text-muted border-b border-clens">
												<th class="instrument-microcaps py-2 pr-4 text-[10px]">Tool</th>
												<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Failures</th>
												<th class="instrument-microcaps py-2 text-[10px] text-right">Rate</th>
											</tr>
										</thead>
										<tbody>
											<For each={toolErrors()}>
												{(te) => (
													<tr class="border-b border-clens/50 transition-colors hover:bg-surface-hover">
														<td class="py-2 pr-4 font-medium text-primary">{te.tool_name}</td>
														<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">{te.total_failures}</td>
														<td class="py-2 text-right text-secondary">
															{te.failure_rate > 0 ? `${(te.failure_rate * 100).toFixed(1)}%` : "n/a"}
														</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</div>
						</Show>
						<Show when={topErrorPatterns().length > 0}>
							<div class="rounded-none border border-clens bg-surface p-4">
								<SectionHeader title="Error Patterns" />
								<div class="overflow-x-auto">
									<table class="w-full text-xs">
										<thead>
											<tr class="text-left text-muted border-b border-clens">
												<th class="instrument-microcaps py-2 pr-4 text-[10px]">Pattern</th>
												<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Count</th>
												<th class="instrument-microcaps py-2 text-[10px]">Tools</th>
											</tr>
										</thead>
										<tbody>
											<For each={topErrorPatterns()}>
												{(ep) => (
													<tr class="border-b border-clens/50 transition-colors hover:bg-surface-hover">
														<td class="py-2 pr-4 text-primary truncate max-w-48" title={ep.pattern}>
															{ep.pattern.slice(0, 50)}{ep.pattern.length > 50 ? "..." : ""}
														</td>
														<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">{ep.count}</td>
														<td class="py-2 text-muted">{ep.tools.join(", ")}</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</div>
						</Show>
					</div>
				</Show>

				{/* Worst Sessions + Hotspot Files (side by side) */}
				<div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
					<Show when={worstSessions().length > 0}>
						<div class="rounded-none border border-clens bg-surface p-4">
							<SectionHeader title="Worst Sessions" />
							<div class="overflow-x-auto">
								<table class="w-full text-xs">
									<thead>
										<tr class="text-left text-muted border-b border-clens">
											<th class="instrument-microcaps py-2 pr-4 text-[10px]">Session</th>
											<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Backtracks</th>
											<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Cost</th>
											<th class="instrument-microcaps py-2 text-[10px] text-right">Duration</th>
										</tr>
									</thead>
									<tbody>
										<For each={worstSessions()}>
											{(ws) => (
												<tr
													class="border-b border-clens/50 hover:bg-surface-hover cursor-pointer transition"
													onClick={() => navigate(`/session/${ws.session_id}`)}
												>
													<td class="py-2 pr-4 font-mono font-medium text-brand-500">
														{ws.session_id.slice(0, 8)}
													</td>
													<td class="py-2 pr-4 text-right font-mono tabular-nums text-danger font-medium">
														{ws.backtrack_count}
													</td>
													<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">
														${ws.cost_usd.toFixed(2)}
													</td>
													<td class="py-2 text-right font-mono tabular-nums text-secondary">
														{formatDuration(ws.duration_ms)}
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</div>
					</Show>
					<Show when={topBacktrackFiles().length > 0}>
						<div class="rounded-none border border-clens bg-surface p-4">
							<SectionHeader title="Hotspot Files" />
							<div class="overflow-x-auto">
								<table class="w-full text-xs">
									<thead>
										<tr class="text-left text-muted border-b border-clens">
											<th class="instrument-microcaps py-2 pr-4 text-[10px]">File Path</th>
											<th class="instrument-microcaps py-2 text-[10px] text-right">Backtracks</th>
										</tr>
									</thead>
									<tbody>
										<For each={topBacktrackFiles()}>
											{(f) => (
												<tr class="border-b border-clens/50 transition-colors hover:bg-surface-hover">
													<td class="py-2 pr-4 text-primary truncate max-w-64" title={f.file}>
														{f.file.split("/").slice(-2).join("/")}
													</td>
													<td class="py-2 text-right font-mono tabular-nums text-secondary">{f.count}</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</div>
					</Show>
				</div>
			</Show>
		</div>
	);
};

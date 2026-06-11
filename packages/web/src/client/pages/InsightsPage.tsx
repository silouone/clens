import { createMemo, For, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { RefreshCw, RotateCcw } from "lucide-solid";
import {
	analyticsRange,
	setAnalyticsRange,
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

const RangeSelector: Component = () => (
	<div class="flex items-center gap-1">
		<For each={RANGES}>
			{(r) => (
				<button
					onClick={() => setAnalyticsRange(r)}
					class="rounded-md px-2.5 py-1 text-xs font-medium transition"
					classList={{
						"text-primary bg-surface-muted": analyticsRange() === r,
						"text-muted hover:text-secondary hover:bg-surface-hover": analyticsRange() !== r,
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
	readonly invertColor?: boolean; // true = "down is good" (e.g., backtrack rate)
	readonly subtitle?: string;
};

const KpiCard: Component<KpiCardProps> = (props) => (
	<div class="rounded-lg border border-clens bg-surface p-4">
		<div class="text-xs text-muted">{props.label}</div>
		<div class="mt-1 text-2xl font-semibold text-primary">{props.value}</div>
		<Show when={props.subtitle}>
			<div class="mt-0.5 text-xs text-muted">{props.subtitle}</div>
		</Show>
		<Show when={props.delta && props.delta.direction !== "flat"}>
			<div class="mt-1 flex items-center gap-1 text-xs">
				<span classList={{
					"text-emerald-500": (props.invertColor
						? props.delta?.direction === "down"
						: props.delta?.direction === "up"),
					"text-red-500": (props.invertColor
						? props.delta?.direction === "up"
						: props.delta?.direction === "down"),
				}}>
					{props.delta?.direction === "up" ? "+" : "-"}
					{props.delta?.value.toFixed(1)}
					{props.deltaLabel ?? "%"}
				</span>
				<span class="text-muted">vs prev</span>
			</div>
		</Show>
	</div>
);

// ── Section header ──────────────────────────────────────────────────

const SectionHeader: Component<{ readonly title: string }> = (props) => (
	<h3 class="text-sm font-semibold text-secondary mb-2">{props.title}</h3>
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

		// Quality score
		result.push(`Quality score: ${t.agent_quality_score.toFixed(0)}/100.`);

		return result;
	});

	return (
		<Show when={sentences().length > 0}>
			<div class="mb-6 rounded-lg border border-clens bg-surface-muted p-4 text-sm text-secondary italic">
				{sentences().join(" ")}
			</div>
		</Show>
	);
};

// ── Empty state ─────────────────────────────────────────────────────

const EmptyState: Component = () => (
	<div class="flex flex-col items-center justify-center py-20 text-center">
		<TelescopeIllustration class="h-16 w-16 text-muted mb-4" />
		<h2 class="text-lg font-medium text-primary">No analytics data yet</h2>
		<p class="mt-2 text-sm text-muted max-w-md">
			If you have distilled sessions, click rebuild to extract analytics data.
		</p>
		<button
			onClick={() => rebuildAnalytics()}
			disabled={isRebuilding()}
			class="mt-4 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition disabled:opacity-50"
		>
			{isRebuilding() ? "Rebuilding..." : "Rebuild Analytics"}
		</button>
		<p class="mt-3 text-xs text-muted">
			Or run <code class="rounded bg-surface-muted px-1.5 py-0.5 text-xs">clens distill --all</code> to distill and generate analytics.
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
			<div class="flex items-center justify-between mb-6">
				<h1 class="text-xl font-semibold text-primary">Insights</h1>
				<div class="flex items-center gap-3">
					<ProjectDropdown />
					<RangeSelector />
					<button
						onClick={() => rebuildAnalytics()}
						disabled={isRebuilding()}
						class="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition disabled:opacity-50"
						title="Rebuild analytics from distilled sessions"
					>
						<RotateCcw class="h-4 w-4" classList={{ "animate-spin": isRebuilding() }} />
					</button>
					<button
						onClick={() => refetchInsights()}
						class="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition"
						title="Refresh"
					>
						<RefreshCw class="h-4 w-4" />
					</button>
				</div>
			</div>

			{/* Loading */}
			<Show when={isLoading()}>
				<div class="flex items-center justify-center py-20">
					<div class="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
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
						value={`${(totals()?.agent_quality_score ?? 0).toFixed(0)}/100`}
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
					<div class="mb-6 rounded-lg border border-clens bg-surface p-4">
						<SectionHeader title="Edit Efficiency" />
						<div class="mb-2 text-xs text-muted">
							{editSurvival()}% of edits survive to final state
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
						/>
					</div>
				</Show>

				{/* Plan Drift (only when 5+ data points) */}
				<Show when={planDriftPoints().length >= 5}>
					<div class="mb-6 rounded-lg border border-clens bg-surface p-4">
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
				<div class="mb-6 rounded-lg border border-clens bg-surface p-4">
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
					/>
				</div>

				{/* Reasoning Distribution + Decision Patterns (side by side) */}
				<div class="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
					<div class="rounded-lg border border-clens bg-surface p-4">
						<SectionHeader title="Reasoning Distribution" />
						<Show when={reasoningSegments().length > 0} fallback={
							<div class="text-xs text-muted py-4 text-center">No reasoning data available</div>
						}>
							<DonutChart
								segments={reasoningSegments()}
								ariaLabel="Reasoning distribution donut chart"
								centerLabel="Turns"
								centerValue={formatCompact(reasoningSegments().reduce((s, seg) => s + seg.value, 0))}
							/>
							<Show when={topReasoningInsight()}>
								<div class="mt-3 text-xs text-muted italic">{topReasoningInsight()}</div>
							</Show>
						</Show>
					</div>
					<div class="rounded-lg border border-clens bg-surface p-4">
						<SectionHeader title="Decision Patterns" />
						<Show when={decisionBuckets().length > 0} fallback={
							<div class="text-xs text-muted py-4 text-center">No decision data available</div>
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
							<div class="rounded-lg border border-clens bg-surface p-4">
								<SectionHeader title="Tool Errors" />
								<div class="overflow-x-auto">
									<table class="w-full text-xs">
										<thead>
											<tr class="text-left text-muted border-b border-clens">
												<th class="py-2 pr-4 font-medium">Tool</th>
												<th class="py-2 pr-4 font-medium text-right">Failures</th>
												<th class="py-2 font-medium text-right">Rate</th>
											</tr>
										</thead>
										<tbody>
											<For each={toolErrors()}>
												{(te) => (
													<tr class="border-b border-clens/50">
														<td class="py-2 pr-4 font-medium text-primary">{te.tool_name}</td>
														<td class="py-2 pr-4 text-right text-secondary">{te.total_failures}</td>
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
							<div class="rounded-lg border border-clens bg-surface p-4">
								<SectionHeader title="Error Patterns" />
								<div class="overflow-x-auto">
									<table class="w-full text-xs">
										<thead>
											<tr class="text-left text-muted border-b border-clens">
												<th class="py-2 pr-4 font-medium">Pattern</th>
												<th class="py-2 pr-4 font-medium text-right">Count</th>
												<th class="py-2 font-medium">Tools</th>
											</tr>
										</thead>
										<tbody>
											<For each={topErrorPatterns()}>
												{(ep) => (
													<tr class="border-b border-clens/50">
														<td class="py-2 pr-4 text-primary truncate max-w-48" title={ep.pattern}>
															{ep.pattern.slice(0, 50)}{ep.pattern.length > 50 ? "..." : ""}
														</td>
														<td class="py-2 pr-4 text-right text-secondary">{ep.count}</td>
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
						<div class="rounded-lg border border-clens bg-surface p-4">
							<SectionHeader title="Worst Sessions" />
							<div class="overflow-x-auto">
								<table class="w-full text-xs">
									<thead>
										<tr class="text-left text-muted border-b border-clens">
											<th class="py-2 pr-4 font-medium">Session</th>
											<th class="py-2 pr-4 font-medium text-right">Backtracks</th>
											<th class="py-2 pr-4 font-medium text-right">Cost</th>
											<th class="py-2 font-medium text-right">Duration</th>
										</tr>
									</thead>
									<tbody>
										<For each={worstSessions()}>
											{(ws) => (
												<tr
													class="border-b border-clens/50 hover:bg-surface-hover cursor-pointer transition"
													onClick={() => navigate(`/session/${ws.session_id}`)}
												>
													<td class="py-2 pr-4 font-medium text-brand-500">
														{ws.session_id.slice(0, 8)}
													</td>
													<td class="py-2 pr-4 text-right text-red-500 font-medium">
														{ws.backtrack_count}
													</td>
													<td class="py-2 pr-4 text-right text-secondary">
														${ws.cost_usd.toFixed(2)}
													</td>
													<td class="py-2 text-right text-secondary">
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
						<div class="rounded-lg border border-clens bg-surface p-4">
							<SectionHeader title="Hotspot Files" />
							<div class="overflow-x-auto">
								<table class="w-full text-xs">
									<thead>
										<tr class="text-left text-muted border-b border-clens">
											<th class="py-2 pr-4 font-medium">File Path</th>
											<th class="py-2 font-medium text-right">Backtracks</th>
										</tr>
									</thead>
									<tbody>
										<For each={topBacktrackFiles()}>
											{(f) => (
												<tr class="border-b border-clens/50">
													<td class="py-2 pr-4 text-primary truncate max-w-64" title={f.file}>
														{f.file.split("/").slice(-2).join("/")}
													</td>
													<td class="py-2 text-right text-secondary">{f.count}</td>
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

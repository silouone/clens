import { useNavigate } from "@solidjs/router";
import { RefreshCw, RotateCcw } from "lucide-solid";
import { type Component, createMemo, For, Show } from "solid-js";
import { CustomRangeChip } from "../components/CustomRangeChip";
import {
	CHART_COLORS,
	ChartEmpty,
	ChartTooltip,
	formatCompact,
	MODEL_OTHER,
	modelColor,
	TOKEN_COLORS,
} from "../components/charts";
import { BarChart } from "../components/charts/BarChart";
import { LineChart } from "../components/charts/LineChart";
import { StackedArea } from "../components/charts/StackedArea";
import type { BrushRange } from "../components/charts/shared";
import { ProjectDropdown } from "../components/ProjectDropdown";
import { TelescopeIllustration } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { Tooltip } from "../components/ui/Tooltip";
import {
	type AnalyticsRange,
	agentTypeBreakdown,
	analyticsRange,
	clearCustomRange,
	computeDelta,
	computePpDelta,
	customRange,
	type DailyUsageMetrics,
	type DeltaResult,
	dailyUsage,
	isRebuilding,
	isValidDayKey,
	modelBreakdown,
	rebuildAnalytics,
	refetchUsage,
	setAnalyticsRange,
	setCustomRange,
	usageData,
	usagePopulation,
	usagePreviousTotals,
	usageTotals,
} from "../lib/analytics-store";
import { formatDuration, modelDisplayName } from "../lib/format";

// ── Range selector ──────────────────────────────────────────────────

const RANGES: readonly AnalyticsRange[] = ["7d", "30d", "90d", "all"] as const;

// Selecting a preset always clears any active brush window (AC8): the preset and
// the custom window are mutually exclusive views of the same dashboard.
const selectPreset = (r: AnalyticsRange): void => {
	clearCustomRange();
	setAnalyticsRange(r);
};

const RangeSelector: Component = () => (
	<div class="flex flex-wrap items-center gap-1">
		<For each={RANGES}>
			{(r) => (
				<button
					type="button"
					onClick={() => selectPreset(r)}
					class="instrument-microcaps rounded-none border px-2.5 py-1 text-[10px] transition"
					classList={{
						// A preset reads as active only when no custom window overrides it.
						"text-primary bg-surface-muted border-brand-500":
							!customRange() && analyticsRange() === r,
						"text-muted border-clens hover:text-secondary hover:bg-surface-hover":
							Boolean(customRange()) || analyticsRange() !== r,
					}}
				>
					{r === "all" ? "All" : r}
				</button>
			)}
		</For>

		{/* Custom-window chip (AC8): visible only while a brush selection is active.
		    Shared component so Usage and Insights render the same date format. */}
		<CustomRangeChip />
	</div>
);

// ── KPI Card ────────────────────────────────────────────────────────

type KpiCardProps = {
	readonly label: string;
	readonly value: string;
	readonly delta?: DeltaResult;
	readonly deltaLabel?: string;
	readonly invertColor?: boolean; // true = "down is good" (e.g., paid cost)
	readonly tooltip?: string;
	readonly subtitle?: string;
	readonly badge?: string; // small INSTRUMENT pill (e.g. "49% estimated")
	readonly muted?: boolean; // dim the value when it represents "no reading"
};

const KpiCard: Component<KpiCardProps> = (props) => (
	<div
		class="group rounded-none border border-clens bg-surface p-4 transition-colors hover:border-strong hover:bg-surface-hover"
		title={props.tooltip}
		classList={{ "cursor-help": Boolean(props.tooltip) }}
	>
		<div class="instrument-microcaps text-[10px] text-muted">{props.label}</div>
		<div
			class="mt-1 font-mono tabular-nums text-2xl font-semibold"
			classList={{ "text-primary": !props.muted, "text-muted": props.muted }}
		>
			{props.value}
		</div>
		<Show when={props.badge}>
			<div class="instrument-microcaps mt-1.5 inline-flex items-center rounded-none border border-warning/50 px-1.5 py-0.5 text-[9px] text-warning">
				{props.badge}
			</div>
		</Show>
		<Show when={props.subtitle}>
			<div class="mt-0.5 text-xs text-muted">{props.subtitle}</div>
		</Show>
		<Show when={props.delta && props.delta.direction !== "flat"}>
			<div class="mt-1 flex items-center gap-1 text-xs">
				<span
					classList={{
						"text-success": props.invertColor
							? props.delta?.direction === "down"
							: props.delta?.direction === "up",
						"text-danger": props.invertColor
							? props.delta?.direction === "up"
							: props.delta?.direction === "down",
					}}
				>
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

const SectionHeader: Component<{ readonly title: string; readonly hint?: string }> = (props) => (
	<div class="mb-3 flex items-center gap-2">
		<span class="h-1.5 w-1.5 shrink-0 bg-brand-500/70" />
		<h3 class="instrument-microcaps text-[11px] text-secondary">{props.title}</h3>
		<Show when={props.hint}>
			<span class="text-[10px] text-muted">{props.hint}</span>
		</Show>
	</div>
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
			type="button"
			onClick={() => rebuildAnalytics()}
			disabled={isRebuilding()}
			class="instrument-microcaps mt-4 rounded-none border border-brand-500 bg-brand-500 px-4 py-2 text-[10px] text-surface hover:bg-brand-600 transition disabled:opacity-50"
		>
			{isRebuilding() ? "Rebuilding..." : "Rebuild Analytics"}
		</button>
		<p class="mt-3 text-xs text-muted">
			Or run{" "}
			<code class="rounded-none border border-clens bg-surface-inset px-1.5 py-0.5 font-mono text-xs">
				clens distill --all
			</code>{" "}
			to distill and generate analytics.
		</p>
	</div>
);

// ── Formatting helpers ──────────────────────────────────────────────

const fmtUsd = (n: number): string => `$${n.toFixed(2)}`;

// ROI reads as a multiplier ("5.1x"). Below 10x keep one decimal; above, round —
// "47x" not "47.0x". Zero (no paid baseline / no value) renders as a dash upstream.
const fmtRoi = (roi: number): string => `${roi < 10 ? roi.toFixed(1) : Math.round(roi)}x`;

// "X% estimated" badge text from measured_fraction (AC12). measured_fraction is
// the share backed by Claude's own measured cost; the inverse is estimated. Only
// surfaced when some of the window is NOT measured.
const estimatedPct = (measuredFraction: number): number => Math.round((1 - measuredFraction) * 100);

// ── Main page ───────────────────────────────────────────────────────

export const UsagePage: Component = () => {
	const navigate = useNavigate();

	// Navigate to the session list filtered to the clicked day. The list consumes
	// the `date` query param and keeps only sessions whose start_time falls on that
	// LOCAL calendar day (B22). `agents=all` is set so single-day drill-downs aren't
	// silently narrowed by the default top-level-only filter.
	const navigateToDate = (d: unknown) => {
		const datum = d as DailyUsageMetrics;
		if (!isValidDayKey(datum.date)) return;
		navigate(`/?date=${encodeURIComponent(datum.date)}&agents=all`);
	};

	// Brush → custom window (AC7): a completed drag on any time chart sets the
	// inclusive [from,to] window; the store re-fetches and every widget re-scopes.
	const onBrushSelect = (r: BrushRange) => setCustomRange({ from: r.start, to: r.end });

	const totals = usageTotals;
	const prevTotals = usagePreviousTotals;
	const population = usagePopulation;
	const isLoading = () => usageData.loading;
	const isEmpty = () => !isLoading() && (totals()?.sessions ?? 0) === 0;

	// Comparison deltas are meaningless when the previous window held no sessions —
	// a "+X vs prev" against an empty baseline misleads (B10). Gate every delta on a
	// non-empty previous window.
	const hasPrevBaseline = createMemo(() => (prevTotals()?.sessions ?? 0) > 0);

	// Value/paid/roi have no signal when nothing in the window is priced — show an
	// em dash, not a fake "$0.00" / "0.0x" (B10).
	const hasCost = createMemo(() => (totals()?.sessions_with_cost ?? 0) > 0);

	// Cache hit rate is `null` (n/a) when no fresh input was captured (AC9) — never
	// render a misleading 100%.
	const cacheNa = createMemo(() => totals()?.cache_hit_rate == null);

	// KPI deltas. value/paid track API-equivalent value (cost_usd === value_usd).
	const valueDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline()
			? computeDelta(totals()!.value_usd, prevTotals()!.value_usd)
			: undefined,
	);
	const paidDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline()
			? computeDelta(totals()!.paid_usd, prevTotals()!.paid_usd)
			: undefined,
	);
	const roiDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline()
			? computeDelta(totals()!.roi, prevTotals()!.roi)
			: undefined,
	);
	const sessionDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline()
			? computeDelta(totals()!.sessions, prevTotals()!.sessions)
			: undefined,
	);
	// Cache delta only when both windows have a real (non-null) reading.
	const cacheDelta = createMemo(() => {
		const t = totals();
		const p = prevTotals();
		if (!t || !p || !hasPrevBaseline()) return undefined;
		if (t.cache_hit_rate == null || p.cache_hit_rate == null) return undefined;
		return computePpDelta(t.cache_hit_rate, p.cache_hit_rate);
	});
	const durationDelta = createMemo(() =>
		totals() && prevTotals() && hasPrevBaseline()
			? computeDelta(totals()!.avg_duration_ms, prevTotals()!.avg_duration_ms)
			: undefined,
	);

	// Estimated-fraction badge (AC12): only when the window is not fully measured.
	const estimatedBadge = createMemo(() => {
		const t = totals();
		if (!t || !hasCost()) return undefined;
		const pct = estimatedPct(t.measured_fraction);
		return pct > 0 ? `${pct}% estimated` : undefined;
	});

	// "n of m sessions analyzed" — analyzed = distilled (drives every metric),
	// total = all raw sessions in the window (B10).
	const coverageLabel = createMemo(() => {
		const p = population();
		if (!p) return undefined;
		return `${p.analyzed} of ${p.total} sessions analyzed`;
	});

	// Model breakdown donut segments. Drop zero-cost models, give each remaining
	// model a distinct hue, and collapse the long tail past the top 8 into a single
	// "Other" slice so the legend stays readable.
	const MODEL_TOP_N = 8;
	const modelSegments = createMemo(() => {
		const models = modelBreakdown().filter((m) => m.cost_usd > 0);
		const head = models.slice(0, MODEL_TOP_N).map((m, i) => ({
			// Humanize the raw model id (NUM-6): "claude-fable-5" / "claude-opus-4-8[1m]"
			// → "Claude Fable 5" / "Claude Opus 4.8". Color stays index-keyed, so the
			// display label never affects the palette.
			label: modelDisplayName(m.model),
			value: m.cost_usd,
			color: modelColor(i),
		}));
		const tail = models.slice(MODEL_TOP_N);
		if (tail.length > 0) {
			head.push({
				label: `Other (${tail.length})`,
				value: tail.reduce((sum, m) => sum + m.cost_usd, 0),
				color: MODEL_OTHER,
			});
		}
		return head;
	});
	// Sum + max across the (already cost-sorted) segments — drive the ranked
	// readout's share % and proportional bar widths. A pie hides a heavy-tailed
	// cost split (1–2 models dominating, the rest slivers); ranked bars read it
	// at a glance.
	const modelTotalValue = createMemo(() => modelSegments().reduce((s, m) => s + m.value, 0));
	const modelMaxValue = createMemo(() => modelSegments().reduce((m, s) => Math.max(m, s.value), 0));

	return (
		<div class="mx-auto max-w-7xl px-4 py-6">
			<ChartTooltip />

			{/* Header */}
			<div class="flex items-center justify-between mb-6">
				<div>
					<h1 class="instrument-microcaps text-[13px] tracking-[0.14em] text-primary">Usage</h1>
					<div class="instrument-ruler mt-1.5 w-40" />
				</div>
				<div class="flex flex-wrap items-center justify-end gap-3">
					<ProjectDropdown />
					<RangeSelector />
					<button
						type="button"
						onClick={() => rebuildAnalytics()}
						disabled={isRebuilding()}
						class="rounded-none border border-clens p-1.5 text-muted hover:text-secondary hover:bg-surface-hover hover:border-strong transition disabled:opacity-50"
						title="Rebuild analytics from distilled sessions"
					>
						<RotateCcw class="h-4 w-4" classList={{ "animate-spin": isRebuilding() }} />
					</button>
					<button
						type="button"
						onClick={() => refetchUsage()}
						class="rounded-none border border-clens p-1.5 text-muted hover:text-secondary hover:bg-surface-hover hover:border-strong transition"
						title="Refresh"
					>
						<RefreshCw class="h-4 w-4" />
					</button>
				</div>
			</div>

			{/* Loading */}
			<Show when={isLoading()}>
				<div class="flex items-center justify-center py-20">
					<Spinner size="md" />
				</div>
			</Show>

			{/* Empty state */}
			<Show when={isEmpty()}>
				<EmptyState />
			</Show>

			{/* Content */}
			<Show when={!isLoading() && !isEmpty()}>
				{/* Cost truth: PAID (subscription) vs API VALUE vs ROI. The old single
				    "Total Cost" headline conflated value extracted with cash paid — this
				    splits them honestly and flags the estimated share (AC4, AC12). */}
				<div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
					<KpiCard
						label="Paid"
						value={hasCost() ? fmtUsd(totals()?.paid_usd ?? 0) : "—"}
						delta={hasCost() ? paidDelta() : undefined}
						invertColor
						muted={!hasCost()}
						tooltip="What you actually paid over this window — your flat subscription rate prorated to the window length (set your plan in Settings). For pay-as-you-go (API), this equals API value."
					/>
					<KpiCard
						label="API Value"
						value={hasCost() ? fmtUsd(totals()?.value_usd ?? 0) : "—"}
						delta={hasCost() ? valueDelta() : undefined}
						muted={!hasCost()}
						badge={estimatedBadge()}
						tooltip="API-equivalent value: what these sessions would cost at Anthropic's full list price. This is value extracted, not a bill. Some sessions are token-estimated rather than measured — see the estimated badge."
					/>
					<KpiCard
						label="ROI"
						value={hasCost() && (totals()?.roi ?? 0) > 0 ? fmtRoi(totals()?.roi ?? 0) : "—"}
						delta={hasCost() ? roiDelta() : undefined}
						muted={!hasCost() || (totals()?.roi ?? 0) === 0}
						tooltip="Return on subscription: API value ÷ amount paid. 5.1x means you extracted ~5× the list-price value of what you paid. Always 1x on pay-as-you-go (API) plans."
					/>
				</div>

				{/* Secondary KPIs */}
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
					<KpiCard
						label="Total Sessions"
						value={String(totals()?.sessions ?? 0)}
						delta={sessionDelta()}
						subtitle={coverageLabel()}
					/>
					<KpiCard
						label="Cache Hit Rate"
						value={cacheNa() ? "—" : `${((totals()?.cache_hit_rate ?? 0) * 100).toFixed(0)}%`}
						delta={cacheNa() ? undefined : cacheDelta()}
						deltaLabel="pp"
						muted={cacheNa()}
						tooltip={
							cacheNa()
								? "n/a — no fresh input tokens were captured this window, so cache-read share is undefined (not 100%)."
								: "Cache-read share: cache-read tokens ÷ (fresh input + cache-read). Higher means more context was served from cache."
						}
					/>
					<KpiCard
						label="Avg Active"
						value={formatDuration(totals()?.avg_duration_ms ?? 0)}
						delta={durationDelta()}
						invertColor
					/>
				</div>

				{/* Token Composition */}
				<div class="mb-6 rounded-none border border-clens bg-surface p-4">
					<SectionHeader title="Token Composition" hint="drag to zoom a range" />
					{/* No priced sessions ⇒ no token signal (every model-bearing session
					    gets a cost_estimate). Empty state, not a flat-zero stack (NUM-16). */}
					<Show
						when={hasCost()}
						fallback={
							<ChartEmpty
								height={220}
								ariaLabel="No token data"
								label="No priced sessions in range"
							/>
						}
					>
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
							onBrushSelect={onBrushSelect}
							onClickPoint={(d) => navigateToDate(d)}
						/>
					</Show>
				</div>

				{/* Cost Trend */}
				<div class="mb-6 rounded-none border border-clens bg-surface p-4">
					<SectionHeader title="Cost Trend" hint="drag to zoom a range" />
					{/* Gate on hasCost(): no priced sessions ⇒ empty state, not a
					    flat-zero cost series (NUM-16). */}
					<Show
						when={hasCost()}
						fallback={
							<ChartEmpty
								height={180}
								ariaLabel="No cost data"
								label="No priced sessions in range"
							/>
						}
					>
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
							onBrushSelect={onBrushSelect}
							onClickPoint={(d) => navigateToDate(d)}
						/>
					</Show>
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
							onBrushSelect={onBrushSelect}
							onClickPoint={(d) => navigateToDate(d)}
						/>
					</div>
					<div class="rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Cache Efficiency" />
						<LineChart
							data={dailyUsage()}
							x={(d) => d.date}
							y={(d) => (d.cache_hit_rate ?? 0) * 100}
							height={180}
							color={CHART_COLORS.emerald}
							fillArea
							ariaLabel="Cache hit rate area chart"
							formatY={(v) => `${v.toFixed(0)}%`}
							tooltipLabel={(d) =>
								d.cache_hit_rate == null
									? `${d.date}: n/a (no fresh input)`
									: `${d.date}: ${(d.cache_hit_rate * 100).toFixed(1)}% cache hit rate`
							}
							onBrushSelect={onBrushSelect}
						/>
					</div>
				</div>

				{/* Agent Types */}
				<Show when={agentTypeBreakdown().length > 0}>
					<div class="mb-6 rounded-none border border-clens bg-surface p-4">
						<SectionHeader title="Agent Types" />
						<div class="overflow-x-auto">
							<table class="w-full min-w-[40rem] text-xs">
								<thead>
									<tr class="text-left text-muted border-b border-clens">
										<th class="instrument-microcaps py-2 pr-4 text-[10px]">Type</th>
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Spawns</th>
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Sessions</th>
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">Avg Cost</th>
										{/* Agent duration_ms is idle-trimmed effective working time → "Active" */}
										<th class="instrument-microcaps py-2 pr-4 text-[10px] text-right">
											Avg Active
										</th>
										<th class="instrument-microcaps py-2 text-[10px] text-right">
											{/* Renamed from "Fail Rate" (AC10): this is tool-call error rate
											    (failures ÷ tool calls), NOT how often the agent failed to
											    spawn. A 1-spawn agent can't have a 3.1% spawn rate. */}
											<Tooltip content="Tool-call error rate: failed tool calls ÷ total tool calls for this agent type. Not a spawn-failure rate.">
												<span class="cursor-help border-b border-dotted border-muted">
													Tool Error Rate
												</span>
											</Tooltip>
										</th>
									</tr>
								</thead>
								<tbody>
									<For each={agentTypeBreakdown()}>
										{(a) => (
											<tr class="border-b border-clens/50 hover:bg-surface-hover transition">
												<td class="py-2 pr-4 font-medium text-primary">{a.agent_type}</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">
													{a.spawn_count}
												</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">
													{a.sessions_appeared_in}
												</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">
													${a.avg_cost_usd.toFixed(2)}
												</td>
												<td class="py-2 pr-4 text-right font-mono tabular-nums text-secondary">
													{formatDuration(a.avg_duration_ms)}
												</td>
												<td class="py-2 text-right font-mono tabular-nums text-secondary">
													{(a.avg_failure_rate * 100).toFixed(1)}%
												</td>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
					</div>
				</Show>

				{/* Model Breakdown — ranked cost readout. Replaces a donut: cost-by-model
				    is heavy-tailed (1–2 models ≈ all spend), so pie slivers were
				    illegible. Bars sorted by cost with share % read instantly. */}
				<Show when={modelSegments().length > 0}>
					<div class="mb-6 rounded-none border border-clens bg-surface p-4">
						<div class="mb-3 flex items-baseline justify-between gap-2">
							<SectionHeader title="Model Breakdown" />
							{/* Total = sum of the bars (cost by model), so rows and header
							    reconcile and the shares add to 100%. */}
							<div class="flex items-baseline gap-1.5">
								<span class="instrument-microcaps text-[10px] text-muted">Total</span>
								<span class="font-mono text-sm font-semibold tabular-nums text-primary">
									{fmtUsd(modelTotalValue())}
								</span>
							</div>
						</div>
						<div class="flex flex-col gap-1.5" role="img" aria-label="Model cost breakdown">
							<For each={modelSegments()}>
								{(seg) => {
									const sharePct = () => {
										const t = modelTotalValue();
										return t > 0 ? (seg.value / t) * 100 : 0;
									};
									const barPct = () => {
										const m = modelMaxValue();
										return m > 0 ? (seg.value / m) * 100 : 0;
									};
									return (
										<div class="group flex items-center gap-2.5">
											<span
												class="h-2.5 w-2.5 shrink-0 rounded-[2px]"
												style={{ "background-color": seg.color }}
											/>
											<span
												class="w-44 shrink-0 truncate instrument-microcaps text-[10px] text-secondary"
												title={seg.label}
											>
												{seg.label}
											</span>
											<div class="h-4 flex-1 overflow-hidden rounded-none border border-clens bg-surface-inset">
												<div
													class="h-full rounded-none transition-all group-hover:opacity-80"
													style={{ width: `${barPct()}%`, "background-color": seg.color }}
												/>
											</div>
											<span class="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-secondary">
												{fmtUsd(seg.value)}
											</span>
											<span class="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
												{sharePct().toFixed(0)}%
											</span>
										</div>
									);
								}}
							</For>
						</div>
					</div>
				</Show>
			</Show>
		</div>
	);
};

import { createMemo, Show, type Component } from "solid-js";
import { Widget } from "../../ui/Widget";
import { StatTile } from "../../ui/StatTile";
import { DonutChart, HorizontalBar, BACKTRACK_COLORS } from "../../charts";
import { CATEGORY } from "../../../lib/categories";
import { classifySeverity } from "../../../lib/format";
import type { WidgetProps } from "../types";

// ── RiskWidget [risk] — backtrack shape at a glance (R-C2, AC7) ───────
//
// Home for backtracks + failures (absorbs the old IssuesPanel). The dominant
// visual is the SHAPE of the backtracks — a donut keyed by BACKTRACK_COLORS
// over the three structural types — plus a by-tool breakdown, so a viewer reads
// "where did this run thrash?" without a flat list. Headline tiles carry the
// raw counts (total · failure rate · wasted attempts · abandoned edits). Each
// tile self-gates on a non-zero value (R-E1: no "0 of 0" noise) and the whole
// widget empty-states to a clean LED when there is no risk signal at all.
// Click-through → Backtracks tab (R-A5).

// The three structural backtrack types, in BACKTRACK_COLORS key order. A literal
// const tuple keeps `BACKTRACK_COLORS[t]` index-safe without an `as` cast.
const BT_TYPES = ["failure_retry", "iteration_struggle", "debugging_loop"] as const;

const SEVERITY_VAR: Readonly<Record<string, string>> = {
	low: "var(--clens-success)",
	moderate: "var(--clens-warning)",
	high: "var(--clens-danger)",
};

const humanizeType = (type: string): string => type.replace(/_/g, " ");

export const RiskWidget: Component<WidgetProps> = (props) => {
	const backtracks = () => props.session.backtracks;
	const total = () => backtracks().length;
	const failurePct = () => Math.round(props.session.stats.failure_rate * 100);
	const failureCount = () => props.session.stats.failure_count;
	const abandoned = () => props.session.summary?.key_metrics.abandoned_edits ?? 0;

	const wasted = createMemo(() =>
		backtracks().reduce((sum, bt) => sum + Math.max(0, bt.attempts - 1), 0),
	);

	// Backtracks grouped by structural type → donut segments (drop empties so a
	// type that never occurred is not a hollow colored shell).
	const byType = createMemo(() =>
		BT_TYPES.map((t) => ({
			label: humanizeType(t),
			value: backtracks().filter((bt) => bt.type === t).length,
			color: BACKTRACK_COLORS[t],
		}))
			.filter((seg) => seg.value > 0)
			.sort((a, b) => b.value - a.value),
	);

	// Backtracks grouped by tool, top offenders only.
	const byTool = createMemo(() => {
		const counts = backtracks().reduce<ReadonlyMap<string, number>>(
			(acc, bt) => new Map([...acc, [bt.tool_name, (acc.get(bt.tool_name) ?? 0) + 1]]),
			new Map(),
		);
		return [...counts]
			.map(([tool_name, count]) => ({ tool_name, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 4);
	});

	const severity = createMemo(() => classifySeverity(total()));
	const hasRisk = () => total() > 0 || abandoned() > 0 || failureCount() > 0;

	return (
		<Widget
			category="risk"
			title="Risk"
			span={4}
			onClick={() => props.onNavigate?.("backtracks")}
			headerRight={
				total() > 0 ? (
					<span class="flex items-center gap-1">
						<span
							class="instrument-led"
							style={{ "background-color": SEVERITY_VAR[severity().label] }}
						/>
						<span class="instrument-microcaps text-[9px] text-muted">
							{severity().label}
						</span>
					</span>
				) : undefined
			}
		>
			<Show
				when={hasRisk()}
				fallback={
					<div class="flex items-center gap-2 py-1">
						<span
							class="instrument-led"
							style={{ "background-color": "var(--clens-success)" }}
						/>
						<span class="text-xs text-secondary">
							Clean run — no backtracks or failures
						</span>
					</div>
				}
			>
				{/* Headline counts — each self-gates so a zero never renders. */}
				<div class="flex flex-wrap gap-1.5">
					<Show when={total() > 0}>
						<StatTile category="risk" label="Backtracks" value={total()} class="flex-1" />
					</Show>
					<Show when={failurePct() > 0}>
						<StatTile category="risk" label="Failure" value={`${failurePct()}%`} class="flex-1" />
					</Show>
					<Show when={wasted() > 0}>
						<StatTile category="risk" label="Wasted" value={wasted()} class="flex-1" />
					</Show>
					<Show when={abandoned() > 0}>
						<StatTile category="risk" label="Abandoned" value={abandoned()} class="flex-1" />
					</Show>
				</div>

				{/* Shape: backtracks by type (donut). Segment click preserves the
				    click-through (segment onClick stops propagation). */}
				<Show when={byType().length > 0}>
					<div class="mt-3">
						<DonutChart
							segments={byType()}
							size={120}
							centerLabel="Backtracks"
							centerValue={String(total())}
							formatValue={(v) => String(v)}
							ariaLabel="Backtracks by type"
							onClickPoint={() => props.onNavigate?.("backtracks")}
						/>
					</div>
				</Show>

				{/* Shape: backtracks by tool (top offenders). */}
				<Show when={byTool().length > 0}>
					<div class="mt-3">
						<span class="instrument-microcaps text-[10px] text-muted">By tool</span>
						<div class="mt-1.5">
							<HorizontalBar
								data={byTool()}
								label={(d) => d.tool_name}
								value={(d) => d.count}
								color={CATEGORY.risk.cssVar}
								ariaLabel="Backtracks by tool"
								tooltipLabel={(d) => `${d.tool_name}: ${d.count} backtracks`}
							/>
						</div>
					</div>
				</Show>
			</Show>
		</Widget>
	);
};

import { type Component, createMemo, For, Show } from "solid-js";
import { CATEGORY } from "../../../lib/categories";
import { Widget } from "../../ui/Widget";
import type { WidgetProps } from "../types";

// ── ReasoningWidget [agents] — Wave 1 ────────────────────────────────
//
// The cognitive footprint of the run: how much the agent(s) thought (captured
// thinking blocks) and how many structural decision points were detected, with
// a compact breakdown of those decisions by kind. Absorbs the headline figures
// of ThinkingBreakdown + DecisionsSection without their full prose.
//
// Honesty (R-D1): "decisions" are STRUCTURAL (timing gaps, tool pivots, phase
// boundaries, delegations) — heuristic markers, not semantic choices — so the
// label stays "Decision points", never "decisions made". Counts render in mono
// tabular numerals (R-C6) with thousands grouping for the large rich-fixture
// figures (e.g. 1,515 thinking blocks).
//
// Empty-state (R-E1): the host guards on `reasoning.length > 0`, but decisions
// can still be zero (sparse fixture) — the decision figure + breakdown are gated
// so we never render a lonely "0", and the layout collapses to the thinking
// figure alone. No click-through: reasoning/decisions have no sibling tab (the
// agents channel's `comms` target would mislead).

type DecisionPoint = WidgetProps["session"]["decisions"][number];

type DecisionRow = {
	readonly type: string;
	readonly label: string;
	readonly count: number;
	readonly pct: number;
};

// ── Pure helpers ─────────────────────────────────────────────────────

// Grouped thousands in deterministic en-US form so mono tabular numerals read
// the same regardless of host locale (full precision — not a compact axis label).
const groupNum = (n: number): string => n.toLocaleString("en-US");

// Human labels for the structural decision kinds (raw type humanized as a
// fallback so newly-added kinds still render rather than vanish).
const DECISION_LABELS: Readonly<Record<string, string>> = {
	tool_pivot: "Changed approach",
	timing_gap: "Timing gaps",
	task_delegation: "Task delegations",
	phase_boundary: "Phase boundaries",
	agent_spawn: "Agent spawns",
	task_completion: "Task completions",
};

const decisionLabel = (type: string): string => DECISION_LABELS[type] ?? type.replace(/_/g, " ");

// Aggregate decisions by `type` into bar rows, widest = the most frequent kind.
const buildDecisionRows = (decisions: readonly DecisionPoint[]): readonly DecisionRow[] => {
	if (decisions.length === 0) return [];
	const counts = decisions.reduce(
		(acc, d) => ({ ...acc, [d.type]: (acc[d.type] ?? 0) + 1 }),
		{} as Readonly<Record<string, number>>,
	);
	const maxCount = Math.max(...Object.values(counts));
	return Object.entries(counts)
		.map(([type, count]) => ({
			type,
			label: decisionLabel(type),
			count,
			pct: maxCount > 0 ? (count / maxCount) * 100 : 0,
		}))
		.sort((a, b) => b.count - a.count);
};

// ── Figure cell (no nested left-rule — the Widget already carries one) ─

const Figure: Component<{ readonly label: string; readonly value: string }> = (props) => (
	<div class="space-y-0.5">
		<div class="instrument-microcaps text-[10px] text-muted">{props.label}</div>
		<div class="font-mono text-2xl tabular-nums text-primary">{props.value}</div>
	</div>
);

// ── Component ─────────────────────────────────────────────────────────

export const ReasoningWidget: Component<WidgetProps> = (props) => {
	const thinking = () => props.session.reasoning.length;
	const decisions = () => props.session.decisions;
	const decisionCount = () => decisions().length;
	const decisionRows = createMemo(() => buildDecisionRows(decisions()));

	return (
		<Widget category="agents" title="Reasoning" span={6}>
			<div class="space-y-3">
				{/* Headline figures — decision figure gated so sparse never shows "0". */}
				<div class="grid grid-cols-2 gap-3">
					<Figure label="Thinking blocks" value={groupNum(thinking())} />
					<Show when={decisionCount() > 0}>
						<Figure label="Decision points" value={groupNum(decisionCount())} />
					</Show>
				</div>

				{/* Tiny breakdown by decision kind. */}
				<Show when={decisionRows().length > 0}>
					<div class="space-y-1.5 border-t border-clens pt-2">
						<For each={decisionRows()}>
							{(row) => (
								<div class="flex items-center gap-2 text-xs">
									<span class="w-28 shrink-0 truncate text-right capitalize text-muted">
										{row.label}
									</span>
									<div class="h-2 min-w-12 flex-1 rounded-none border border-clens bg-surface-inset">
										<div
											class="h-full rounded-none"
											style={{
												width: `${Math.max(row.pct, 4)}%`,
												"background-color": CATEGORY.agents.cssVar,
											}}
										/>
									</div>
									<span class="w-10 shrink-0 text-right font-mono tabular-nums text-muted">
										{groupNum(row.count)}
									</span>
								</div>
							)}
						</For>
					</div>
				</Show>
			</div>
		</Widget>
	);
};

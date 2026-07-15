import { type Component, createMemo, For, Show } from "solid-js";
import { CATEGORY } from "../../../lib/categories";
import { HorizontalBar } from "../../charts";
import { StatTile } from "../../ui/StatTile";
import { Widget } from "../../ui/Widget";
import type { WidgetProps } from "../types";

// ── AgentsWidget [agents] — Wave 1 (overview-moat-refactor) ──────────
//
// The harness/agents channel home. Renders for BOTH the multi-agent team case
// (agent count + message volume + agent-type shape) AND the single-agent
// loop/workflow case (the harness-flags row + workflow/loop/goal counts) so a
// configured run "gets a home" even with zero spawned subagents — Wave-0 flag
// #4. Click-through jumps to the Communication tab.
//
// HONESTY (R-D4 / R-E1): every figure is per-tile Show-guarded, so a zero count
// is omitted (no "0 of 0" noise) rather than fabricated, and the whole widget
// self-hides when it has neither a real stat nor an active harness flag (no
// empty colored shell). Agent count uses the B15 source-of-truth: the recursive
// agents-tree size (what the session list recomputes), falling back to
// agent_lifetimes / team_metrics so it never diverges from the list.

// Minimal structural view of an agent tree node — only the fields the recursion
// touches, so we don't couple to the full AgentNode shape. AgentNode satisfies
// it structurally.
type TreeAgent = {
	readonly agent_type: string;
	readonly children: readonly TreeAgent[];
};

type AgentTypeCount = {
	readonly type: string;
	readonly count: number;
};

// Flatten an agent forest to the agent_type of every node (root + descendants).
const flattenTypes = (nodes: readonly TreeAgent[]): readonly string[] =>
	nodes.flatMap((n) => [n.agent_type, ...flattenTypes(n.children)]);

// Count occurrences per type, sorted high→low (the agent-type "shape").
const groupTypes = (types: readonly string[]): readonly AgentTypeCount[] => {
	const counts = types.reduce<Map<string, number>>((acc, t) => {
		acc.set(t, (acc.get(t) ?? 0) + 1);
		return acc;
	}, new Map());
	return [...counts.entries()]
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => b.count - a.count);
};

export const AgentsWidget: Component<WidgetProps> = (props) => {
	// All agent types from the most authoritative source present (tree → lifetimes).
	// Count and the type-shape chart both derive from this one list so they agree.
	const agentTypes = createMemo<readonly string[]>(() => {
		const s = props.session;
		if (s.agents && s.agents.length > 0) return flattenTypes(s.agents);
		if (s.agent_lifetimes && s.agent_lifetimes.length > 0)
			return s.agent_lifetimes.map((l) => l.agent_type);
		return [];
	});

	const agentCount = () => {
		const fromTree = agentTypes().length;
		return fromTree > 0 ? fromTree : (props.session.team_metrics?.agent_count ?? 0);
	};
	const commCount = () => props.session.comm_sequence?.length ?? 0;
	const workflowRuns = () => props.session.feature_usage?.workflow?.invocation_count ?? 0;
	const loopWakeups = () => props.session.feature_usage?.loop?.wakeup_count ?? 0;
	const goalCount = () => props.session.feature_usage?.goal?.goals.length ?? 0;
	const flags = () => props.session.feature_usage?.flags ?? [];

	// Only the figures that are genuinely present — no zero-count noise (R-E1/D4).
	const stats = createMemo(() =>
		[
			{ label: "Agents", value: agentCount() },
			{ label: "Messages", value: commCount() },
			{ label: "Workflow", value: workflowRuns() },
			{ label: "Loop wakeups", value: loopWakeups() },
			{ label: "Goals", value: goalCount() },
		].filter((s) => s.value > 0),
	);

	const typeBreakdown = createMemo(() => groupTypes(agentTypes()));
	const topTypes = () => typeBreakdown().slice(0, 5);

	// Self-hide when there is neither a real stat nor an active harness flag, so a
	// non-agent / unconfigured session shows no empty agents shell. The flags row
	// is what gives a zero-count loop/workflow session its "home".
	const visible = () => stats().length > 0 || flags().length > 0;

	return (
		<Show when={visible()}>
			<Widget
				category="agents"
				title="Agents"
				span={4}
				onClick={() => props.onNavigate?.("comms")}
				headerRight={
					<Show when={flags().length > 0}>
						<div class="flex items-center gap-1.5">
							<For each={flags()}>
								{(flag) => (
									<span
										class="instrument-microcaps text-[9px]"
										style={{ color: CATEGORY.agents.cssVar }}
									>
										{flag}
									</span>
								)}
							</For>
						</div>
					</Show>
				}
			>
				<div class="space-y-3">
					<Show
						when={stats().length > 0}
						fallback={
							<p class="instrument-microcaps text-[10px] text-muted">
								Harness configured — no agent activity captured
							</p>
						}
					>
						<div class="grid grid-cols-2 gap-1.5">
							<For each={stats()}>
								{(s) => <StatTile category="agents" label={s.label} value={s.value} />}
							</For>
						</div>
					</Show>

					<Show when={typeBreakdown().length >= 2}>
						<div>
							<div class="instrument-microcaps mb-1 text-[10px] text-muted">Agent types</div>
							<HorizontalBar
								data={topTypes()}
								label={(d) => d.type}
								value={(d) => d.count}
								color={CATEGORY.agents.cssVar}
								barHeight={16}
								ariaLabel="Agent type distribution"
							/>
						</div>
					</Show>
				</div>
			</Widget>
		</Show>
	);
};

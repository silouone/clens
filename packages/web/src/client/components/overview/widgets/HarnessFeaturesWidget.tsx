import { Repeat, Target, Workflow } from "lucide-solid";
import { type Component, For, Show } from "solid-js";
import type { DetectionSource, GoalEntry, LoopWakeup, WorkflowRun } from "../../../../shared/types";
import { formatDuration } from "../../../lib/format";
import { Widget } from "../../ui/Widget";
import type { WidgetProps } from "../types";

// ── HarnessFeaturesWidget [agents] ───────────────────────────────────
//
// Restores the loop / goal / workflow signal the overview-moat refactor dropped
// (it ported Config + Task Plan but left the old "Harness Features" card on the
// floor, orphaning its component). The Loop/Goal/Workflow blocks below are the
// same INSTRUMENT-styled JSX from that retired component, re-wrapped in the bento
// Widget shell.
//
// Honesty (cLens invariant): goal entries now carry a `source`. A semantic guess
// ("inferred") is visually flagged with an amber LED micro-tag so it is never
// presented as a hard fact. Host Show-guards on feature_usage, but we keep a
// self-sufficient empty state so the widget never paints an empty colored shell.

const MAX_WAKEUPS_SHOWN = 8;

type FeatureUsage = NonNullable<WidgetProps["session"]["feature_usage"]>;

// GoalUsage.goals is a union (string | GoalEntry)[] for back-compat with distills
// written before the GoalEntry change. Normalize so pre-re-distill JSON still renders.
const normalizeGoal = (g: string | GoalEntry): GoalEntry =>
	typeof g === "string" ? { text: g, source: "command" } : g;

const SourceTag: Component<{ readonly source: DetectionSource }> = (props) => (
	<Show when={props.source === "inferred"}>
		<span
			class="instrument-microcaps inline-flex shrink-0 items-center gap-1 rounded-none border border-clens bg-surface-raised px-1 py-0 text-[9px] text-[var(--clens-warning)]"
			title="Inferred from the agent's own reasoning — a heuristic guess, not a typed command"
		>
			<span class="instrument-led bg-[var(--clens-warning)]" />
			inferred
		</span>
	</Show>
);

// ── Loop ─────────────────────────────────────────────────────────────

const WakeupRow: Component<{ readonly wakeup: LoopWakeup }> = (props) => (
	<li class="flex items-baseline gap-2 text-xs">
		<span class="shrink-0 rounded-none border border-clens bg-surface-muted px-1.5 py-0.5 font-mono tabular-nums text-muted">
			{formatDuration(props.wakeup.delay_seconds * 1000)}
		</span>
		<span class="truncate text-secondary" title={props.wakeup.reason}>
			{props.wakeup.reason ?? "—"}
		</span>
	</li>
);

const LoopBlock: Component<{ readonly loop: NonNullable<FeatureUsage["loop"]> }> = (props) => (
	<div>
		<div class="mb-1.5 flex items-center gap-2">
			<Repeat class="h-3.5 w-3.5 text-brand-500" />
			<span class="instrument-microcaps text-[11px] text-brand-500">Loop</span>
			<span class="text-xs text-muted">
				{props.loop.wakeup_count} wakeup{props.loop.wakeup_count !== 1 ? "s" : ""}
				<Show when={props.loop.total_scheduled_wait_s > 0}>
					{" · "}
					{formatDuration(props.loop.total_scheduled_wait_s * 1000)} scheduled wait
				</Show>
				<Show when={props.loop.autonomous}>{" · autonomous"}</Show>
			</span>
			<Show when={props.loop.source}>{(s) => <SourceTag source={s()} />}</Show>
		</div>
		<Show when={props.loop.wakeups.length > 0}>
			<ul class="space-y-1 pl-5">
				<For each={props.loop.wakeups.slice(0, MAX_WAKEUPS_SHOWN)}>
					{(w) => <WakeupRow wakeup={w} />}
				</For>
				<Show when={props.loop.wakeups.length > MAX_WAKEUPS_SHOWN}>
					<li class="text-xs text-muted">
						…and {props.loop.wakeups.length - MAX_WAKEUPS_SHOWN} more
					</li>
				</Show>
			</ul>
		</Show>
	</div>
);

// ── Goal ─────────────────────────────────────────────────────────────

const GoalBlock: Component<{ readonly goal: NonNullable<FeatureUsage["goal"]> }> = (props) => {
	const goals = () => props.goal.goals.map(normalizeGoal);
	return (
		<div>
			<div class="mb-1.5 flex items-center gap-2">
				<Target class="h-3.5 w-3.5 text-[var(--clens-warning)]" />
				<span class="instrument-microcaps text-[11px] text-[var(--clens-warning)]">Goal</span>
			</div>
			<ul class="space-y-1 pl-5">
				<For each={goals()}>
					{(g) => (
						<li class="flex items-baseline gap-2 text-xs text-secondary">
							<span class="min-w-0 flex-1">{g.text}</span>
							<SourceTag source={g.source} />
						</li>
					)}
				</For>
			</ul>
		</div>
	);
};

// ── Workflow ─────────────────────────────────────────────────────────

const WorkflowRunRow: Component<{ readonly run: WorkflowRun }> = (props) => (
	<li class="flex items-baseline gap-2 text-xs">
		<span class="shrink-0 rounded-none border border-clens bg-surface-muted px-1.5 py-0.5 font-mono text-muted">
			{props.run.name ?? "unnamed"}
		</span>
		<Show when={props.run.description}>
			<span class="truncate text-secondary" title={props.run.description}>
				{props.run.description}
			</span>
		</Show>
	</li>
);

const WorkflowBlock: Component<{ readonly workflow: NonNullable<FeatureUsage["workflow"]> }> = (
	props,
) => (
	<div>
		<div class="mb-1.5 flex items-center gap-2">
			<Workflow class="h-3.5 w-3.5 text-secondary" />
			<span class="instrument-microcaps text-[11px] text-secondary">Workflow</span>
			<Show when={props.workflow.invocation_count > 0}>
				<span class="text-xs text-muted">
					{props.workflow.invocation_count} run{props.workflow.invocation_count !== 1 ? "s" : ""}
				</span>
			</Show>
			<Show when={props.workflow.source}>{(s) => <SourceTag source={s()} />}</Show>
		</div>
		<Show when={props.workflow.runs.length > 0}>
			<ul class="space-y-1 pl-5">
				<For each={props.workflow.runs}>{(run) => <WorkflowRunRow run={run} />}</For>
			</ul>
		</Show>
	</div>
);

// ── Widget ───────────────────────────────────────────────────────────

export const HarnessFeaturesWidget: Component<WidgetProps> = (props) => {
	const usage = () => props.session.feature_usage;

	return (
		<Widget category="agents" title="Harness Features" span={6}>
			<Show
				when={usage()}
				fallback={<p class="text-xs italic text-muted">No harness features used</p>}
			>
				{(u) => (
					<div class="space-y-3">
						<Show when={u().loop}>{(loop) => <LoopBlock loop={loop()} />}</Show>
						<Show when={u().goal}>{(goal) => <GoalBlock goal={goal()} />}</Show>
						<Show when={u().workflow}>{(workflow) => <WorkflowBlock workflow={workflow()} />}</Show>
					</div>
				)}
			</Show>
		</Widget>
	);
};

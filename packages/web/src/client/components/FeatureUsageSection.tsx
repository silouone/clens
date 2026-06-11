import { Repeat, Target, Workflow, Sparkles } from "lucide-solid";
import { For, Show, type Component } from "solid-js";
import type { FeatureUsage, LoopWakeup, WorkflowRun } from "../../shared/types";
import { Card } from "./ui/Card";
import { formatDuration } from "../lib/format";

// ── Feature usage card (loop / goal / workflow) ─────────────────────

const MAX_WAKEUPS_SHOWN = 8;

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
					{" · "}{formatDuration(props.loop.total_scheduled_wait_s * 1000)} scheduled wait
				</Show>
				<Show when={props.loop.autonomous}>{" · autonomous"}</Show>
			</span>
		</div>
		<Show when={props.loop.wakeups.length > 0}>
			<ul class="space-y-1 pl-5">
				<For each={props.loop.wakeups.slice(0, MAX_WAKEUPS_SHOWN)}>
					{(w) => <WakeupRow wakeup={w} />}
				</For>
				<Show when={props.loop.wakeups.length > MAX_WAKEUPS_SHOWN}>
					<li class="text-xs text-muted">…and {props.loop.wakeups.length - MAX_WAKEUPS_SHOWN} more</li>
				</Show>
			</ul>
		</Show>
	</div>
);

const GoalBlock: Component<{ readonly goal: NonNullable<FeatureUsage["goal"]> }> = (props) => (
	<div>
		<div class="mb-1.5 flex items-center gap-2">
			<Target class="h-3.5 w-3.5 text-[var(--clens-warning)]" />
			<span class="instrument-microcaps text-[11px] text-[var(--clens-warning)]">Goal</span>
		</div>
		<ul class="space-y-1 pl-5">
			<For each={props.goal.goals}>
				{(g) => <li class="text-xs text-secondary">{g}</li>}
			</For>
		</ul>
	</div>
);

const WorkflowRunRow: Component<{ readonly run: WorkflowRun }> = (props) => (
	<li class="flex items-baseline gap-2 text-xs">
		<span class="shrink-0 rounded-none border border-clens bg-surface-muted px-1.5 py-0.5 font-mono text-muted">
			{props.run.name ?? "unnamed"}
		</span>
		<Show when={props.run.description}>
			<span class="truncate text-secondary" title={props.run.description}>{props.run.description}</span>
		</Show>
	</li>
);

const WorkflowBlock: Component<{ readonly workflow: NonNullable<FeatureUsage["workflow"]> }> = (props) => (
	<div>
		<div class="mb-1.5 flex items-center gap-2">
			<Workflow class="h-3.5 w-3.5 text-secondary" />
			<span class="instrument-microcaps text-[11px] text-secondary">Workflow</span>
			<span class="text-xs text-muted">
				{props.workflow.invocation_count} run{props.workflow.invocation_count !== 1 ? "s" : ""}
			</span>
		</div>
		<ul class="space-y-1 pl-5">
			<For each={props.workflow.runs}>
				{(run) => <WorkflowRunRow run={run} />}
			</For>
		</ul>
	</div>
);

export const FeatureUsageSection: Component<{ readonly usage: FeatureUsage }> = (props) => (
	<Card>
		<div class="flex items-center gap-3 border-b border-clens px-3 py-2">
			<Sparkles class="h-3.5 w-3.5 text-muted" />
			<h3 class="instrument-microcaps text-[11px] text-muted">Harness Features</h3>
		</div>
		<div class="space-y-3 p-3">
			<Show when={props.usage.loop}>{(loop) => <LoopBlock loop={loop()} />}</Show>
			<Show when={props.usage.goal}>{(goal) => <GoalBlock goal={goal()} />}</Show>
			<Show when={props.usage.workflow}>{(workflow) => <WorkflowBlock workflow={workflow()} />}</Show>
		</div>
	</Card>
);

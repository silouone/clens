import { Check, ChevronRight, Circle, Clock } from "lucide-solid";
import { type Component, createSignal, For, Show } from "solid-js";
import { CATEGORY } from "../../../lib/categories";
import { Widget } from "../../ui/Widget";
import type { WidgetProps } from "../types";

// ── TaskPlanWidget [outcome] — Wave 1 ────────────────────────────────
//
// The agent's own task list as an outcome signal: how much of the plan it
// actually completed. The headline is a completion gauge (a data bar in the
// outcome channel color, not a candy fill) + a completed/total badge; the task
// list itself is collapsed behind an OBVIOUSLY-expandable toggle — a full-width
// row with a rotating chevron and a hover affordance — which fixes the prior
// "you can barely see it's collapsible" complaint. Each task row in turn expands
// to reveal its description / blocked-by deps (preserved from TaskListSection).
//
// Honesty (R-E1): host guards on a non-empty task_list, but we keep a self-
// sufficient empty state so the widget never paints an empty colored shell.

type TaskListResult = NonNullable<WidgetProps["session"]["task_list"]>;
type TaskRecord = TaskListResult["tasks"][number];

// ── Pure helpers ─────────────────────────────────────────────────────

const statusIcon = (status: TaskRecord["status"]) => {
	if (status === "completed")
		return <Check class="h-3.5 w-3.5 shrink-0 text-[var(--clens-success)]" />;
	if (status === "in_progress")
		return <Clock class="h-3.5 w-3.5 shrink-0 text-[var(--clens-warning)]" />;
	return <Circle class="h-3.5 w-3.5 shrink-0 text-muted" />;
};

// The completion badge borrows the status palette (full = green, partial =
// amber, low = muted) — a verdict on plan execution, distinct from the channel.
const completionBadgeClass = (rate: number): string => {
	if (rate >= 1) return "border-clens bg-surface-raised text-[var(--clens-success)]";
	if (rate >= 0.5) return "border-clens bg-surface-raised text-[var(--clens-warning)]";
	return "border-clens bg-surface-muted text-muted";
};

// ── Task row (individually expandable for description / deps) ──────────

const TaskRow: Component<{ readonly task: TaskRecord }> = (props) => {
	const [expanded, setExpanded] = createSignal(false);
	const hasDetails = () =>
		(props.task.description?.length ?? 0) > 0 || (props.task.blocked_by?.length ?? 0) > 0;

	return (
		<div class="group">
			<button
				type="button"
				class={`flex w-full items-center gap-2 rounded-none px-1.5 py-1 text-left text-sm ${
					hasDetails() ? "cursor-pointer hover:bg-surface-hover" : ""
				}`}
				onClick={() => hasDetails() && setExpanded((prev) => !prev)}
			>
				{statusIcon(props.task.status)}

				<span
					class={`flex-1 truncate ${
						props.task.status === "completed" ? "text-muted line-through" : "text-secondary"
					}`}
					title={props.task.subject}
				>
					{props.task.subject}
				</span>

				<Show when={props.task.owner}>
					{(owner) => (
						<span class="shrink-0 rounded-none border border-clens bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-secondary">
							{owner()}
						</span>
					)}
				</Show>

				<Show when={hasDetails()}>
					<ChevronRight
						class={`h-3 w-3 shrink-0 text-muted transition-transform ${
							expanded() ? "rotate-90" : ""
						}`}
					/>
				</Show>
			</button>

			<Show when={expanded()}>
				<div class="ml-6 space-y-1 pb-1 pt-0.5">
					<Show when={props.task.description}>
						{(desc) => <p class="whitespace-pre-wrap text-xs text-muted">{desc()}</p>}
					</Show>
					<Show when={(props.task.blocked_by?.length ?? 0) > 0}>
						<div class="flex flex-wrap gap-1">
							<For each={props.task.blocked_by ?? []}>
								{(dep) => (
									<span class="instrument-microcaps inline-flex items-center gap-1 rounded-none border border-clens bg-surface-raised px-1.5 py-0.5 text-[10px] text-[var(--clens-warning)]">
										<span class="instrument-led bg-[var(--clens-warning)]" />
										blocked by {dep}
									</span>
								)}
							</For>
						</div>
					</Show>
				</div>
			</Show>
		</div>
	);
};

// ── Component ─────────────────────────────────────────────────────────

export const TaskPlanWidget: Component<WidgetProps> = (props) => {
	const list = () => props.session.task_list;
	// Collapsed by default — a grid widget shows the verdict (gauge + badge) at a
	// glance and reveals the full list only on demand.
	const [open, setOpen] = createSignal(false);

	return (
		<Widget category="outcome" title="Task Plan" span={6}>
			<Show when={list()} fallback={<p class="text-xs italic text-muted">No task plan</p>}>
				{(l) => (
					<Show
						when={l().total_count > 0}
						fallback={<p class="text-xs italic text-muted">No task plan</p>}
					>
						<div class="space-y-2.5">
							{/* Completion gauge + badge */}
							<div class="flex items-center justify-between gap-2">
								<span class="instrument-microcaps text-[10px] text-muted">Completion</span>
								<span
									class={`instrument-microcaps rounded-none border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${completionBadgeClass(
										l().completion_rate,
									)}`}
								>
									{l().completed_count}/{l().total_count} completed
								</span>
							</div>

							{/* Progress bar — a data bar in the outcome channel color. */}
							<div class="h-1.5 overflow-hidden rounded-none border border-clens bg-surface-muted">
								<div
									class="h-full transition-all"
									style={{
										width: `${Math.round(l().completion_rate * 100)}%`,
										"background-color": CATEGORY.outcome.cssVar,
									}}
								/>
							</div>

							{/* OBVIOUSLY-expandable toggle — full-width hover row + chevron. */}
							<button
								type="button"
								class="focus-ring flex w-full items-center justify-between gap-2 rounded-none border border-clens bg-surface-raised px-2 py-1.5 text-xs transition hover:bg-surface-hover"
								aria-expanded={open()}
								onClick={() => setOpen((prev) => !prev)}
							>
								<span class="instrument-microcaps text-[10px] text-secondary">
									{open() ? "Hide tasks" : `View ${l().total_count} tasks`}
								</span>
								<ChevronRight
									class={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${
										open() ? "rotate-90" : ""
									}`}
								/>
							</button>

							{/* Task rows */}
							<Show when={open()}>
								<div class="space-y-0.5 border-t border-clens pt-2">
									<For each={l().tasks}>{(task) => <TaskRow task={task} />}</For>
								</div>
							</Show>
						</div>
					</Show>
				)}
			</Show>
		</Widget>
	);
};

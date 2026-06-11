import { createSignal, For, Show, type Component } from "solid-js";
import { Check, Circle, Clock, ListTodo, ChevronRight } from "lucide-solid";
import type { TaskListResult, TaskRecord } from "../../shared/types";
import { Card } from "./ui/Card";

// -- Types ----------------------------------------------------------------

type TaskListSectionProps = {
	readonly taskList: TaskListResult;
};

// -- Pure helpers ---------------------------------------------------------

const statusIcon = (status: TaskRecord["status"]) => {
	if (status === "completed")
		return <Check class="h-3.5 w-3.5 shrink-0 text-[var(--clens-success)]" />;
	if (status === "in_progress")
		return <Clock class="h-3.5 w-3.5 shrink-0 text-[var(--clens-warning)]" />;
	return <Circle class="h-3.5 w-3.5 shrink-0 text-muted" />;
};

const completionBadgeClass = (rate: number): string => {
	if (rate >= 1) return "border-clens bg-surface-raised text-[var(--clens-success)]";
	if (rate >= 0.5) return "border-clens bg-surface-raised text-[var(--clens-warning)]";
	return "border-clens bg-surface-muted text-muted";
};

// -- Task Row -------------------------------------------------------------

const TaskRow: Component<{ readonly task: TaskRecord }> = (props) => {
	const [expanded, setExpanded] = createSignal(false);
	const hasDetails = () =>
		(props.task.description?.length ?? 0) > 0 ||
		(props.task.blocked_by?.length ?? 0) > 0;

	return (
		<div class="group">
			<div
				class={`flex items-center gap-2 rounded-none px-1.5 py-1 text-sm ${hasDetails() ? "cursor-pointer hover:bg-surface-hover" : ""}`}
				onClick={() => hasDetails() && setExpanded((prev) => !prev)}
			>
				{statusIcon(props.task.status)}

				<span
					class={`flex-1 truncate ${
						props.task.status === "completed"
							? "text-muted line-through"
							: "text-secondary"
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
						class={`h-3 w-3 shrink-0 text-muted transition-transform ${expanded() ? "rotate-90" : ""}`}
					/>
				</Show>
			</div>

			<Show when={expanded()}>
				<div class="ml-6 space-y-1 pb-1 pt-0.5">
					<Show when={props.task.description}>
						{(desc) => (
							<p class="whitespace-pre-wrap text-xs text-muted">
								{desc()}
							</p>
						)}
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

// -- Component ------------------------------------------------------------

export const TaskListSection: Component<TaskListSectionProps> = (props) => {
	const tasks = () => props.taskList.tasks;
	const completedCount = () => props.taskList.completed_count;
	const totalCount = () => props.taskList.total_count;
	const completionRate = () => props.taskList.completion_rate;
	const progressPct = () => `${Math.round(completionRate() * 100)}%`;

	return (
		<Card class="p-3">
			{/* Header */}
			<div class="mb-2 flex items-center gap-2">
				<ListTodo class="h-3.5 w-3.5 text-muted" />
				<h3 class="instrument-microcaps text-[11px] text-muted">
					Task Plan
				</h3>
				<span
					class={`instrument-microcaps rounded-none border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${completionBadgeClass(completionRate())}`}
				>
					{completedCount()}/{totalCount()} completed
				</span>
			</div>

			{/* Progress bar */}
			<div class="mb-3 h-1.5 overflow-hidden rounded-none border border-clens bg-surface-muted">
				<div
					class="h-full rounded-none bg-[var(--clens-success)] transition-all"
					style={{ width: progressPct() }}
				/>
			</div>

			{/* Task rows */}
			<div class="space-y-0.5">
				<For each={tasks()}>
					{(task) => <TaskRow task={task} />}
				</For>
			</div>
		</Card>
	);
};

import { createSignal, For, Show, type Component } from "solid-js";
import { A } from "@solidjs/router";
import { FileText, GitBranch, Clock, ChevronRight, ChevronDown, Hash } from "lucide-solid";
import type { WorkUnit } from "../../shared/types";
import { formatDuration } from "../lib/format";
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from "../lib/work-unit-constants";
import { isGlobalMode, projectColor } from "../lib/project-store";

// ── Pure helpers ─────────────────────────────────────────────────────

const ROLE_COLORS: Readonly<Record<string, string>> = {
	creator: "bg-violet-500",
	consumer: "bg-blue-500",
	modifier: "bg-gray-400",
} as const;

const formatDateRange = (start: number, end: number): string => {
	const startDate = new Date(start);
	const endDate = new Date(end);
	const sameDay = startDate.toDateString() === endDate.toDateString();

	const dateOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
	const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

	if (sameDay) {
		return `${startDate.toLocaleDateString(undefined, dateOpts)} ${startDate.toLocaleTimeString(undefined, timeOpts)} - ${endDate.toLocaleTimeString(undefined, timeOpts)}`;
	}
	return `${startDate.toLocaleDateString(undefined, dateOpts)} - ${endDate.toLocaleDateString(undefined, dateOpts)}`;
};

// ── Global-mode field accessors ───────────────────────────────────────

const hasProjectId = (u: WorkUnit): u is WorkUnit & { readonly project_id: string } =>
	"project_id" in u;

const hasProjectName = (u: WorkUnit): u is WorkUnit & { readonly project_name: string } =>
	"project_name" in u;

const getWorkUnitProjectId = (u: WorkUnit): string | undefined =>
	hasProjectId(u) ? u.project_id : undefined;

const getWorkUnitProjectName = (u: WorkUnit): string | undefined =>
	hasProjectName(u) ? u.project_name : undefined;

// ── Component ────────────────────────────────────────────────────────

type WorkUnitCardProps = {
	readonly unit: WorkUnit;
};

export const WorkUnitCard: Component<WorkUnitCardProps> = (props) => {
	const unit = () => props.unit;
	const [expanded, setExpanded] = createSignal(false);

	const toggleExpand = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setExpanded((prev) => !prev);
	};

	const sessionCount = () => unit().sessions.length;
	const sessionLabel = () => `${sessionCount()} session${sessionCount() !== 1 ? "s" : ""}`;

	return (
		<div class="border-b border-clens bg-surface-raised transition-colors">
			{/* Compact row */}
			<div class="group flex items-center gap-3 px-4 py-2 transition hover:bg-surface-hover">
				{/* Clickable link area */}
				<A
					href={`/work-unit/${unit().id}`}
					class="flex min-w-0 flex-1 items-center gap-3"
				>
					{/* Icon */}
					<Show
						when={unit().spec_path}
						fallback={<GitBranch class="h-4 w-4 flex-shrink-0 text-muted" />}
					>
						<FileText class="h-4 w-4 flex-shrink-0 text-violet-500 dark:text-violet-400" />
					</Show>

					{/* Name */}
					<span class="min-w-0 flex-1 truncate font-mono text-sm font-medium text-primary">
						{unit().spec_path ?? unit().git_branch ?? "Unknown"}
					</span>

					{/* Global-mode project badge */}
					<Show when={isGlobalMode()}>
						{(() => {
							const pid = getWorkUnitProjectId(unit());
							const pname = getWorkUnitProjectName(unit());
							return pid && pname
								? <span class="inline-flex items-center gap-1 flex-shrink-0 text-xs text-muted">
									<span
										class="inline-block w-1.5 h-1.5 rounded-full"
										style={{ "background-color": projectColor(pid) }}
									/>
									<span class="truncate max-w-[100px]">{pname}</span>
								</span>
								: null;
						})()}
					</Show>

					{/* Lifecycle badge */}
					<span class={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${LIFECYCLE_COLORS[unit().lifecycle]}`}>
						{LIFECYCLE_LABELS[unit().lifecycle]}
					</span>

					{/* KPI pills */}
					<span class="hidden sm:inline-flex items-center gap-1 flex-shrink-0 text-xs text-muted tabular-nums">
						<Clock class="h-3 w-3" />
						{formatDuration(unit().total_duration_ms)}
					</span>

					<span class="hidden sm:inline-flex items-center gap-1 flex-shrink-0 text-xs text-muted tabular-nums">
						<Hash class="h-3 w-3" />
						{sessionLabel()}
					</span>

					<span class="hidden md:inline-flex flex-shrink-0 text-xs text-muted">
						{formatDateRange(unit().date_range.start, unit().date_range.end)}
					</span>
				</A>

				{/* Expand/collapse chevron — sibling to A, not nested */}
				<button
					type="button"
					onClick={toggleExpand}
					class="ml-1 flex-shrink-0 rounded p-0.5 text-muted transition hover:bg-surface-muted hover:text-secondary"
					aria-label={expanded() ? "Collapse sessions" : "Expand sessions"}
				>
					<Show
						when={expanded()}
						fallback={<ChevronRight class="h-4 w-4" />}
					>
						<ChevronDown class="h-4 w-4" />
					</Show>
				</button>
			</div>

			{/* Expanded session list */}
			<Show when={expanded()}>
				<div class="border-t border-clens/50 bg-surface-inset/30">
					<For each={unit().sessions}>
						{(session) => (
							<A
								href={`/session/${session.session_id}`}
								class="group flex items-center gap-2 py-1.5 pl-8 pr-4 transition hover:bg-surface-hover"
							>
								{/* Role dot */}
								<span class={`h-2 w-2 flex-shrink-0 rounded-full ${ROLE_COLORS[session.role] ?? "bg-gray-400"}`} />
								{/* Phase label */}
								<span class="w-14 flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
									{session.phase}
								</span>
								{/* Session name */}
								<span class="min-w-0 flex-1 truncate font-mono text-xs text-secondary group-hover:text-primary">
									{session.session_name ?? session.session_id.slice(0, 8)}
								</span>
								{/* Role badge */}
								<span class="flex-shrink-0 text-[10px] text-muted">
									{session.role}
								</span>
								<ChevronRight class="h-3 w-3 flex-shrink-0 text-muted transition group-hover:translate-x-0.5" />
							</A>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
};

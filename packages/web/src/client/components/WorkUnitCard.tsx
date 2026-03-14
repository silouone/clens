import { For, Show, type Component } from "solid-js";
import { A } from "@solidjs/router";
import { FileText, GitBranch, Clock, ChevronRight } from "lucide-solid";
import type { WorkUnit } from "../../shared/types";
import { formatDuration } from "../lib/format";
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from "../lib/work-unit-constants";

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

// ── Component ────────────────────────────────────────────────────────

type WorkUnitCardProps = {
	readonly unit: WorkUnit;
};

export const WorkUnitCard: Component<WorkUnitCardProps> = (props) => {
	const unit = () => props.unit;

	return (
		<A
			href={`/work-unit/${unit().id}`}
			class="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
		>
			{/* Header */}
			<div class="flex items-start justify-between gap-3">
				<div class="flex items-center gap-2 min-w-0">
					<Show
						when={unit().spec_path}
						fallback={
							<GitBranch class="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" />
						}
					>
						<FileText class="h-4 w-4 flex-shrink-0 text-violet-500 dark:text-violet-400" />
					</Show>
					<span class="truncate font-mono text-sm font-medium text-gray-800 dark:text-gray-200">
						{unit().spec_path ?? unit().git_branch ?? "Unknown"}
					</span>
				</div>
				<span class={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${LIFECYCLE_COLORS[unit().lifecycle]}`}>
					{LIFECYCLE_LABELS[unit().lifecycle]}
				</span>
			</div>

			{/* Meta row */}
			<div class="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
				<span class="flex items-center gap-1">
					<Clock class="h-3 w-3" />
					{formatDuration(unit().total_duration_ms)}
				</span>
				<span>{unit().sessions.length} session{unit().sessions.length !== 1 ? "s" : ""}</span>
				<span>{formatDateRange(unit().date_range.start, unit().date_range.end)}</span>
			</div>

			{/* Session timeline */}
			<div class="mt-3 space-y-1.5">
				<For each={unit().sessions}>
					{(session) => (
						<A
							href={`/session/${session.session_id}`}
							class="group flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-gray-50 dark:hover:bg-gray-800/50"
							onClick={(e: MouseEvent) => e.stopPropagation()}
						>
							{/* Role dot */}
							<span class={`h-2 w-2 flex-shrink-0 rounded-full ${ROLE_COLORS[session.role] ?? "bg-gray-400"}`} />
							{/* Phase label */}
							<span class="w-16 flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
								{session.phase}
							</span>
							{/* Session name */}
							<span class="min-w-0 flex-1 truncate text-xs text-gray-700 group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-gray-100">
								{session.session_name ?? session.session_id.slice(0, 8)}
							</span>
							{/* Role badge */}
							<span class="flex-shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
								{session.role}
							</span>
							<ChevronRight class="h-3 w-3 flex-shrink-0 text-gray-300 transition group-hover:translate-x-0.5 dark:text-gray-600" />
						</A>
					)}
				</For>
			</div>
		</A>
	);
};

import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import { formatRelTime } from "../../lib/format";
import type { TabProps } from "./types";

// ── TimelineTab — Wave 0 carry-over (Wave 2 reworks) ─────────────────
// Preserves the original filterable event list + type filters (R-F2). Wave 2
// adds the full-span DensityRibbon brush (R-C5, AC9).

const TIMELINE_TYPES = [
	"user_prompt", "thinking", "tool_call", "tool_result", "failure",
	"backtrack", "phase_boundary", "agent_spawn", "agent_stop",
	"task_create", "task_assign", "task_complete", "msg_send",
] as const;

const TIMELINE_TYPE_COLORS: Readonly<Record<string, string>> = {
	user_prompt: "text-secondary",
	thinking: "text-muted",
	tool_call: "text-secondary",
	tool_result: "text-muted",
	failure: "text-[var(--clens-danger)]",
	backtrack: "text-[var(--clens-warning)]",
	phase_boundary: "text-secondary",
	agent_spawn: "text-[var(--clens-success)]",
	agent_stop: "text-[var(--clens-success)]",
	task_create: "text-secondary",
	task_assign: "text-secondary",
	task_complete: "text-[var(--clens-success)]",
	teammate_idle: "text-muted",
	msg_send: "text-secondary",
};

const EmptyTab: Component<{ readonly message: string }> = (props) => (
	<div class="flex h-full items-center justify-center py-8">
		<span class="instrument-microcaps border border-clens px-3 py-1.5 text-[10px] text-muted">
			{props.message}
		</span>
	</div>
);

export const TimelineTab: Component<TabProps> = (props) => {
	const timeline = () => props.session.timeline ?? [];
	const startTime = () => props.session.start_time ?? 0;
	const [activeFilters, setActiveFilters] = createSignal<ReadonlySet<string>>(
		new Set(TIMELINE_TYPES),
	);

	const toggleFilter = (type: string) => {
		setActiveFilters((prev) => {
			const next = new Set(prev);
			if (next.has(type)) {
				next.delete(type);
			} else {
				next.add(type);
			}
			return next;
		});
	};

	const filtered = createMemo(() => timeline().filter((e) => activeFilters().has(e.type)));

	return (
		<Show when={timeline().length > 0} fallback={<EmptyTab message="No timeline data" />}>
			<div class="flex h-full flex-col">
				<div class="flex flex-wrap gap-1 border-b border-clens px-3 py-1">
					<For each={[...TIMELINE_TYPES]}>
						{(type) => (
							<button
								onClick={() => toggleFilter(type)}
								class="instrument-microcaps rounded-none border px-1.5 py-0.5 text-[10px] transition"
								classList={{
									"border-clens bg-surface-muted text-secondary": activeFilters().has(type),
									"border-transparent text-muted hover:text-secondary": !activeFilters().has(type),
								}}
							>
								{type.replaceAll("_", " ")}
							</button>
						)}
					</For>
					<span class="ml-auto font-mono text-[11px] tabular-nums text-muted">
						{filtered().length} events
					</span>
				</div>

				<div class="flex-1 divide-y divide-clens overflow-y-auto">
					<For each={filtered()}>
						{(entry) => (
							<div class="flex items-center gap-3 px-3 py-1 text-xs">
								<span class="w-12 font-mono text-[10px] tabular-nums text-muted">
									{formatRelTime(entry.t, startTime())}
								</span>
								<span class={`font-medium ${TIMELINE_TYPE_COLORS[entry.type] ?? "text-muted"}`}>
									{entry.type.replaceAll("_", " ")}
								</span>
								<Show when={entry.tool_name}>
									{(tn) => <span class="font-mono text-muted">{tn()}</span>}
								</Show>
								<Show when={entry.content_preview}>
									{(cp) => <span class="max-w-md truncate text-muted">{cp()}</span>}
								</Show>
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
};

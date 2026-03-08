import {
	createMemo,
	createSignal,
	For,
	Show,
	type Accessor,
	type Component,
} from "solid-js";
import type {
	BacktrackResult,
	TimelineEntry,
	EditChainsResult,
	EditChain,
	CommunicationSequenceEntry,
	AgentLifetime,
	DistilledSession,
} from "../../shared/types";
import { CommunicationTimeline } from "./CommunicationTimeline";

// ── Types ────────────────────────────────────────────────────────────

type TabId = "backtracks" | "timeline" | "edits" | "comms";

type BottomPanelProps = {
	readonly session: DistilledSession;
	readonly isMultiAgent: boolean;
	readonly onBacktrackClick?: (startT: number) => void;
};

// ── Tab definition ───────────────────────────────────────────────────

type TabDef = {
	readonly id: TabId;
	readonly label: string;
	readonly count: Accessor<number>;
	readonly visible: boolean;
};

// ── Formatting helpers ───────────────────────────────────────────────

const formatRelTime = (t: number, start: number): string => {
	const delta = Math.max(0, t - start);
	const s = Math.floor(delta / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

// ── Backtrack severity ───────────────────────────────────────────────

const SEVERITY_STYLES: Readonly<Record<string, string>> = {
	failure_retry: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50",
	iteration_struggle: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/50 dark:text-orange-400 dark:border-orange-700/50",
	debugging_loop: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-400 dark:border-red-700/50",
};

const getSeverityStyle = (type: string): string =>
	SEVERITY_STYLES[type] ?? "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700/50";

// ── Backtracks tab ───────────────────────────────────────────────────

const BacktracksTab: Component<{
	readonly backtracks: readonly BacktrackResult[];
	readonly startTime: number;
	readonly onBacktrackClick?: (startT: number) => void;
}> = (props) => (
	<Show
		when={props.backtracks.length > 0}
		fallback={<EmptyTab message="No backtracks detected" />}
	>
		<div class="divide-y divide-gray-100 dark:divide-gray-800/50">
			<For each={props.backtracks}>
				{(bt) => (
					<button
						onClick={() => props.onBacktrackClick?.(bt.start_t)}
						class="flex w-full items-center gap-3 px-4 py-2 text-left text-xs transition hover:bg-gray-50 dark:hover:bg-gray-800/30"
					>
						<span class="text-[10px] text-gray-400 tabular-nums w-12 dark:text-gray-600">
							{formatRelTime(bt.start_t, props.startTime)}
						</span>
						<span
							class={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${getSeverityStyle(bt.type)}`}
						>
							{bt.type.replaceAll("_", " ")}
						</span>
						<span class="font-mono text-gray-500 dark:text-gray-400">{bt.tool_name}</span>
						<Show when={bt.file_path}>
							{(fp) => (
								<span class="truncate font-mono text-gray-400 max-w-xs dark:text-gray-600">{fp()}</span>
							)}
						</Show>
						<span class="ml-auto text-gray-400 dark:text-gray-600">
							{bt.attempts} attempt{bt.attempts !== 1 ? "s" : ""}
						</span>
					</button>
				)}
			</For>
		</div>
	</Show>
);

// ── Timeline tab ─────────────────────────────────────────────────────

const TIMELINE_TYPES = [
	"user_prompt", "thinking", "tool_call", "tool_result", "failure",
	"backtrack", "phase_boundary", "agent_spawn", "agent_stop",
	"task_create", "task_assign", "task_complete", "msg_send",
] as const;

const TIMELINE_TYPE_COLORS: Readonly<Record<string, string>> = {
	user_prompt: "text-blue-400",
	thinking: "text-gray-400",
	tool_call: "text-gray-300",
	tool_result: "text-gray-500",
	failure: "text-red-400",
	backtrack: "text-amber-400",
	phase_boundary: "text-violet-400",
	agent_spawn: "text-emerald-400",
	agent_stop: "text-emerald-600",
	task_create: "text-sky-400",
	task_assign: "text-sky-300",
	task_complete: "text-emerald-300",
	teammate_idle: "text-gray-600",
	msg_send: "text-indigo-400",
};

const TimelineTab: Component<{
	readonly timeline: readonly TimelineEntry[];
	readonly startTime: number;
}> = (props) => {
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

	const filtered = createMemo(() =>
		props.timeline.filter((e) => activeFilters().has(e.type)),
	);

	return (
		<Show
			when={props.timeline.length > 0}
			fallback={<EmptyTab message="No timeline data" />}
		>
			<div class="flex flex-col h-full">
				{/* Filters */}
				<div class="flex flex-wrap gap-1 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800/50">
					<For each={[...TIMELINE_TYPES]}>
						{(type) => (
							<button
								onClick={() => toggleFilter(type)}
								class="rounded px-1.5 py-0.5 text-[9px] font-medium transition border"
								classList={{
									"border-gray-300 bg-gray-100 dark:border-gray-700 dark:bg-gray-800/50": activeFilters().has(type),
									"border-transparent text-gray-400 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400": !activeFilters().has(type),
								}}
							>
								{type.replaceAll("_", " ")}
							</button>
						)}
					</For>
					<span class="ml-auto text-[9px] text-gray-400 dark:text-gray-600">{filtered().length} events</span>
				</div>

				{/* Event list */}
				<div class="flex-1 overflow-y-auto">
					<For each={filtered()}>
						{(entry) => (
							<div class="flex items-center gap-3 px-4 py-1 text-xs border-b border-gray-100 dark:border-gray-800/20">
								<span class="text-[10px] text-gray-400 tabular-nums w-12 dark:text-gray-600">
									{formatRelTime(entry.t, props.startTime)}
								</span>
								<span class={`font-medium ${TIMELINE_TYPE_COLORS[entry.type] ?? "text-gray-500"}`}>
									{entry.type.replaceAll("_", " ")}
								</span>
								<Show when={entry.tool_name}>
									{(tn) => <span class="font-mono text-gray-500">{tn()}</span>}
								</Show>
								<Show when={entry.content_preview}>
									{(cp) => (
										<span class="truncate text-gray-600 max-w-md">{cp()}</span>
									)}
								</Show>
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
};

// ── Edits tab ────────────────────────────────────────────────────────

const EditsTab: Component<{
	readonly editChains: EditChainsResult;
}> = (props) => {
	const chains = createMemo(() => props.editChains.chains);

	return (
		<Show
			when={chains().length > 0}
			fallback={<EmptyTab message="No edit chains" />}
		>
			<div class="divide-y divide-gray-100 dark:divide-gray-800/50">
				<For each={chains()}>
					{(chain) => (
						<div class="px-4 py-2">
							{/* File header */}
							<div class="flex items-center gap-2">
								<span class="font-mono text-xs text-gray-700 truncate flex-1 dark:text-gray-300">
									{chain.file_path}
								</span>
								<span class="text-[10px] text-gray-400 dark:text-gray-600">
									{chain.total_edits} edit{chain.total_edits !== 1 ? "s" : ""}
								</span>
								<span class="text-[10px] text-gray-400 dark:text-gray-600">
									{chain.total_reads} read{chain.total_reads !== 1 ? "s" : ""}
								</span>
								<Show when={chain.has_backtrack}>
									<span class="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[9px] text-amber-600 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-400">
										backtrack
									</span>
								</Show>
							</div>

							{/* Step breakdown */}
							<div class="mt-1 flex flex-wrap gap-1">
								<For each={chain.steps}>
									{(step) => {
										const isAbandoned = chain.abandoned_edit_ids.includes(step.tool_use_id);
										return (
											<span
												class="rounded px-1 py-0.5 text-[9px]"
												classList={{
													"bg-emerald-900/30 text-emerald-500": step.outcome === "success" && !isAbandoned,
													"bg-red-900/30 text-red-400": step.outcome === "failure",
													"bg-gray-800/30 text-gray-500": step.outcome === "info",
													"line-through opacity-50": isAbandoned,
												}}
											>
												{step.tool_name}
												{isAbandoned ? " (abandoned)" : ""}
											</span>
										);
									}}
								</For>
							</div>

							{/* Abandoned count */}
							<Show when={chain.abandoned_edit_ids.length > 0}>
								<div class="mt-1 text-[9px] text-amber-600/70 dark:text-amber-500/70">
									{chain.abandoned_edit_ids.length} abandoned edit{chain.abandoned_edit_ids.length !== 1 ? "s" : ""}
								</div>
							</Show>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
};

// ── Empty tab state ──────────────────────────────────────────────────

const EmptyTab: Component<{ readonly message: string }> = (props) => (
	<div class="flex h-full items-center justify-center text-sm text-gray-500 py-8">
		{props.message}
	</div>
);

// ── Main BottomPanel component ───────────────────────────────────────

const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 500;

export const BottomPanel: Component<BottomPanelProps> = (props) => {
	const [collapsed, setCollapsed] = createSignal(true);
	const [activeTab, setActiveTab] = createSignal<TabId>("backtracks");
	const [panelHeight, setPanelHeight] = createSignal(DEFAULT_HEIGHT);
	const [dragging, setDragging] = createSignal(false);

	const startTime = () => props.session.start_time ?? 0;

	// ── Tab definitions ──────────────────────────────────────────

	const tabs = createMemo((): readonly TabDef[] => [
		{
			id: "backtracks" as const,
			label: "Backtracks",
			count: () => props.session.backtracks.length,
			visible: true,
		},
		{
			id: "timeline" as const,
			label: "Timeline",
			count: () => props.session.timeline?.length ?? 0,
			visible: (props.session.timeline?.length ?? 0) > 0,
		},
		{
			id: "edits" as const,
			label: "Edits",
			count: () => props.session.edit_chains?.chains.length ?? 0,
			visible: (props.session.edit_chains?.chains.length ?? 0) > 0,
		},
		{
			id: "comms" as const,
			label: "Communication",
			count: () => props.session.comm_sequence?.length ?? 0,
			visible: props.isMultiAgent,
		},
	]);

	const visibleTabs = createMemo(() => tabs().filter((t) => t.visible));

	// ── Drag to resize ───────────────────────────────────────────

	const onMouseMove = (e: MouseEvent) => {
		const newHeight = window.innerHeight - e.clientY;
		setPanelHeight(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight)));
	};

	const onMouseUp = () => {
		setDragging(false);
		document.removeEventListener("mousemove", onMouseMove);
		document.removeEventListener("mouseup", onMouseUp);
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	};

	const onResizeStart = (e: MouseEvent) => {
		e.preventDefault();
		setDragging(true);
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);
		document.body.style.cursor = "row-resize";
		document.body.style.userSelect = "none";
	};

	// ── Render tab content ───────────────────────────────────────

	const renderTabContent = () => {
		switch (activeTab()) {
			case "backtracks":
				return (
					<BacktracksTab
						backtracks={props.session.backtracks}
						startTime={startTime()}
						onBacktrackClick={props.onBacktrackClick}
					/>
				);
			case "timeline":
				return (
					<TimelineTab
						timeline={props.session.timeline ?? []}
						startTime={startTime()}
					/>
				);
			case "edits":
				return (
					<EditsTab
						editChains={props.session.edit_chains ?? { chains: [] }}
					/>
				);
			case "comms":
				return (
					<CommunicationTimeline
						sequence={props.session.comm_sequence ?? []}
						lifetimes={props.session.agent_lifetimes ?? []}
						sessionStartTime={startTime()}
					/>
				);
		}
	};

	return (
		<div
			class="flex-shrink-0 border-t border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50"
			style={{ height: collapsed() ? "auto" : `${panelHeight()}px` }}
		>
			{/* Resize handle */}
			<Show when={!collapsed()}>
				<div
					class="h-1 cursor-row-resize bg-gray-200 hover:bg-blue-600/30 transition-colors dark:bg-gray-800"
					classList={{ "bg-blue-600/40": dragging() }}
					onMouseDown={onResizeStart}
				/>
			</Show>

			{/* Tab bar */}
			<div class="flex items-center border-b border-gray-200 px-2 dark:border-gray-800/50">
				{/* Toggle button */}
				<button
					onClick={() => setCollapsed((c) => !c)}
					class="rounded px-1.5 py-1 text-[10px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
					title={collapsed() ? "Expand panel" : "Collapse panel"}
				>
					{collapsed() ? "\u25B2" : "\u25BC"}
				</button>

				{/* Tabs */}
				<For each={visibleTabs()}>
					{(tab) => (
						<button
							onClick={() => {
								setActiveTab(tab.id);
								if (collapsed()) setCollapsed(false);
							}}
							class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium transition border-b-2"
							classList={{
								"border-blue-500 text-blue-400": activeTab() === tab.id && !collapsed(),
								"border-transparent text-gray-500 hover:text-gray-300": activeTab() !== tab.id || collapsed(),
							}}
						>
							{tab.label}
							<Show when={tab.count() > 0}>
								<span class="rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
									{tab.count()}
								</span>
							</Show>
						</button>
					)}
				</For>
			</div>

			{/* Tab content */}
			<Show when={!collapsed()}>
				<div class="flex-1 overflow-y-auto" style={{ height: `${panelHeight() - 40}px` }}>
					{renderTabContent()}
				</div>
			</Show>
		</div>
	);
};

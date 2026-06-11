import {
	createMemo,
	createSignal,
	For,
	Show,
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
	TranscriptReasoning,
} from "../../shared/types";
import { CommunicationTimeline } from "./CommunicationTimeline";
import { formatRelTime } from "../lib/format";
import { getSeverityStyle } from "../lib/severity";

// ── Types ────────────────────────────────────────────────────────────

type TabId = "backtracks" | "timeline" | "edits" | "comms";

type BottomPanelProps = {
	readonly session: DistilledSession;
	readonly isMultiAgent: boolean;
	readonly activeTab?: TabId;
	readonly onBacktrackClick?: (startT: number) => void;
};

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
		<div class="divide-y divide-clens">
			<For each={props.backtracks}>
				{(bt) => (
					<button
						onClick={() => props.onBacktrackClick?.(bt.start_t)}
						class="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs transition hover:bg-surface-hover"
					>
						<span class="font-mono text-[10px] tabular-nums w-12 text-muted">
							{formatRelTime(bt.start_t, props.startTime)}
						</span>
						<span
							class={`instrument-microcaps rounded-none border px-1.5 py-0.5 text-[9px] ${getSeverityStyle(bt.type)}`}
						>
							{bt.type.replaceAll("_", " ")}
						</span>
						<span class="font-mono text-muted">{bt.tool_name}</span>
						<Show when={bt.file_path}>
							{(fp) => (
								<span class="truncate font-mono max-w-xs text-muted">{fp()}</span>
							)}
						</Show>
						<span class="ml-auto text-muted">
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
				<div class="flex flex-wrap gap-1 px-3 py-1 border-b border-clens">
					<For each={[...TIMELINE_TYPES]}>
						{(type) => (
							<button
								onClick={() => toggleFilter(type)}
								class="instrument-microcaps rounded-none px-1.5 py-0.5 text-[10px] transition border"
								classList={{
									"border-clens bg-surface-muted text-secondary": activeFilters().has(type),
									"border-transparent text-muted hover:text-secondary": !activeFilters().has(type),
								}}
							>
								{type.replaceAll("_", " ")}
							</button>
						)}
					</For>
					<span class="ml-auto font-mono text-[11px] tabular-nums text-muted">{filtered().length} events</span>
				</div>

				{/* Event list */}
				<div class="flex-1 overflow-y-auto divide-y divide-clens">
					<For each={filtered()}>
						{(entry) => (
							<div class="flex items-center gap-3 px-3 py-1 text-xs">
								<span class="font-mono text-[10px] tabular-nums w-12 text-muted">
									{formatRelTime(entry.t, props.startTime)}
								</span>
								<span class={`font-medium ${TIMELINE_TYPE_COLORS[entry.type] ?? "text-muted"}`}>
									{entry.type.replaceAll("_", " ")}
								</span>
								<Show when={entry.tool_name}>
									{(tn) => <span class="font-mono text-muted">{tn()}</span>}
								</Show>
								<Show when={entry.content_preview}>
									{(cp) => (
										<span class="truncate text-muted max-w-md">{cp()}</span>
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

/** Build a lookup map from tool_use_id to reasoning entry. */
const buildReasoningLookup = (
	reasoning: readonly TranscriptReasoning[],
): ReadonlyMap<string, TranscriptReasoning> =>
	new Map(
		reasoning
			.filter((r) => r.tool_use_id !== undefined)
			.map((r) => [r.tool_use_id!, r]),
	);

/** Truncate text to maxLen characters with ellipsis. */
const truncateText = (text: string, maxLen: number): string =>
	text.length <= maxLen ? text : `${text.slice(0, maxLen)}...`;

const EditsTab: Component<{
	readonly editChains: EditChainsResult;
	readonly reasoning?: readonly TranscriptReasoning[];
}> = (props) => {
	const chains = createMemo(() => props.editChains.chains);
	const reasoningMap = createMemo(() =>
		buildReasoningLookup(props.reasoning ?? []),
	);
	const [expandedStep, setExpandedStep] = createSignal<string | undefined>();

	const toggleStep = (toolUseId: string) => {
		setExpandedStep((prev) => (prev === toolUseId ? undefined : toolUseId));
	};

	return (
		<Show
			when={chains().length > 0}
			fallback={<EmptyTab message="No edit chains" />}
		>
			<div class="divide-y divide-clens">
				<For each={chains()}>
					{(chain) => (
						<div class="px-3 py-1.5">
							{/* File header */}
							<div class="flex items-center gap-2">
								<span class="font-mono text-xs text-secondary truncate flex-1">
									{chain.file_path}
								</span>
								<span class="font-mono text-[10px] tabular-nums text-muted">
									{chain.total_edits} edit{chain.total_edits !== 1 ? "s" : ""}
								</span>
								<span class="font-mono text-[10px] tabular-nums text-muted">
									{chain.total_reads} read{chain.total_reads !== 1 ? "s" : ""}
								</span>
								<Show when={chain.has_backtrack}>
									<span class="instrument-microcaps rounded-none border border-clens px-1 py-0.5 text-[9px] text-[var(--clens-warning)]">
										backtrack
									</span>
								</Show>
							</div>

							{/* Step breakdown */}
							<div class="mt-1 flex flex-wrap gap-1">
								<For each={chain.steps}>
									{(step) => {
										const isAbandoned = chain.abandoned_edit_ids.includes(step.tool_use_id);
										const hasThinking = () => reasoningMap().has(step.tool_use_id);
										const isExpanded = () => expandedStep() === step.tool_use_id;

										return (
											<div class="inline-flex flex-col">
												<button
													onClick={() => hasThinking() ? toggleStep(step.tool_use_id) : undefined}
													class="font-mono rounded-none border px-1 py-0.5 text-[11px] inline-flex items-center gap-0.5"
													classList={{
														"border-clens bg-surface-raised text-[var(--clens-success)]": step.outcome === "success" && !isAbandoned,
														"border-clens bg-surface-raised text-[var(--clens-danger)]": step.outcome === "failure",
														"border-clens bg-surface-raised text-muted": step.outcome === "info",
														"line-through opacity-50": isAbandoned,
														"cursor-pointer hover:bg-surface-hover": hasThinking(),
														"cursor-default": !hasThinking(),
													}}
												>
													{step.tool_name}
													{isAbandoned ? " (abandoned)" : ""}
													<Show when={hasThinking()}>
														<span class="text-brand-500 text-[11px]" title="Has thinking context">
															&#x1D4D5;
														</span>
													</Show>
												</button>
												<Show when={isExpanded() && reasoningMap().get(step.tool_use_id)}>
													{(r) => (
														<div class="mt-0.5 rounded-none border border-clens bg-surface-inset px-2 py-1 text-[10px] text-secondary max-w-xs whitespace-pre-wrap">
															{truncateText(r().thinking, 200)}
														</div>
													)}
												</Show>
											</div>
										);
									}}
								</For>
							</div>

							{/* Abandoned count */}
							<Show when={chain.abandoned_edit_ids.length > 0}>
								<div class="mt-1 text-[11px] text-[var(--clens-warning)]">
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
	<div class="flex h-full items-center justify-center py-8">
		<span class="instrument-microcaps border border-clens px-3 py-1.5 text-[10px] text-muted">
			{props.message}
		</span>
	</div>
);

// ── Main BottomPanel component (now a simple tab content renderer) ────

export const BottomPanel: Component<BottomPanelProps> = (props) => {
	const startTime = () => props.session.start_time ?? 0;
	const currentTab = () => props.activeTab ?? "backtracks";

	const renderTabContent = () => {
		switch (currentTab()) {
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
						reasoning={props.session.reasoning}
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
		<div class="h-full overflow-y-auto">
			{renderTabContent()}
		</div>
	);
};

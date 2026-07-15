import { type Component, createMemo, For, Show } from "solid-js";
import type { AgentLifetime, CommunicationSequenceEntry } from "../../shared/types";

// ── Types ────────────────────────────────────────────────────────────

type CommunicationTimelineProps = {
	readonly sequence: readonly CommunicationSequenceEntry[];
	readonly lifetimes?: readonly AgentLifetime[];
	readonly sessionStartTime?: number;
};

// ── Message type colors ──────────────────────────────────────────────

const MSG_TYPE_COLORS: Readonly<Record<string, string>> = {
	message: "bg-brand-500",
	task_complete: "bg-[var(--clens-success)]",
	idle_notify: "bg-muted",
	task_assign: "bg-[var(--clens-text-secondary)]",
	shutdown_request: "bg-[var(--clens-danger)]",
	shutdown_response: "bg-[var(--clens-danger)]",
	broadcast: "bg-[var(--clens-warning)]",
};

const getMsgColor = (msgType: string): string => MSG_TYPE_COLORS[msgType] ?? "bg-muted";

const getMsgBorderColor = (msgType: string): string =>
	getMsgColor(msgType).replace("bg-", "border-");

// ── Legend entries ───────────────────────────────────────────────────

const LEGEND_ITEMS: readonly {
	readonly label: string;
	readonly color: string;
}[] = [
	{ label: "message", color: "bg-brand-500" },
	{ label: "task assign", color: "bg-[var(--clens-text-secondary)]" },
	{ label: "task complete", color: "bg-[var(--clens-success)]" },
	{ label: "shutdown", color: "bg-[var(--clens-danger)]" },
	{ label: "broadcast", color: "bg-[var(--clens-warning)]" },
	{ label: "other", color: "bg-muted" },
] as const;

// ── Time formatting ──────────────────────────────────────────────────

const formatRelativeTime = (t: number, start: number): string => {
	const delta = Math.max(0, t - start);
	const s = Math.floor(delta / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

// ── Component ────────────────────────────────────────────────────────

export const CommunicationTimeline: Component<CommunicationTimelineProps> = (props) => {
	const startTime = () => props.sessionStartTime ?? props.sequence[0]?.t ?? 0;

	// Unique agent names from lifetimes or sequence
	const agents = createMemo(() => {
		if (props.lifetimes && props.lifetimes.length > 0) {
			return props.lifetimes.map((lt) => lt.agent_name ?? lt.agent_id);
		}
		return [...new Set(props.sequence.flatMap((e) => [e.from_name, e.to_name]))];
	});

	// Lane index for each agent
	const laneIndex = createMemo(() => new Map(agents().map((name, idx) => [name, idx])));

	const getLane = (name: string): number => laneIndex().get(name) ?? 0;

	return (
		<div class="flex h-full flex-col">
			<Show
				when={props.sequence.length > 0}
				fallback={
					<div class="flex-1 flex flex-col items-center justify-center gap-1">
						<span class="instrument-microcaps text-[10px] text-muted">No data</span>
						<span class="text-sm text-muted">No communication data</span>
					</div>
				}
			>
				{/* Legend */}
				<div class="instrument-microcaps flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px] text-muted border-b border-clens">
					<span class="flex items-center gap-1">
						<span class="inline-block h-2 w-2 rounded-[1px] bg-muted" />
						Sender (filled)
					</span>
					<span class="flex items-center gap-1">
						<span class="inline-block h-2 w-2 rounded-[1px] border border-muted" />
						Receiver (hollow)
					</span>
					<span class="text-muted">|</span>
					<For each={LEGEND_ITEMS}>
						{(item) => (
							<span class="flex items-center gap-1">
								<span class={`inline-block h-1.5 w-1.5 rounded-[1px] ${item.color}`} />
								{item.label}
							</span>
						)}
					</For>
				</div>

				{/* Swim lane headers */}
				<div class="flex border-b border-clens bg-surface-inset">
					<div class="instrument-microcaps w-14 flex-shrink-0 px-2 py-1 text-[10px] text-muted">
						Time
					</div>
					<For each={agents()}>
						{(name) => (
							<div
								class="instrument-microcaps flex-1 truncate px-2 py-1.5 text-center text-[10px] text-muted"
								title={name}
							>
								{name}
							</div>
						)}
					</For>
				</div>

				{/* Message rows */}
				<div class="flex-1 overflow-y-auto">
					<For each={props.sequence}>
						{(msg) => {
							const fromLane = getLane(msg.from_name);
							const toLane = getLane(msg.to_name);
							const leftLane = Math.min(fromLane, toLane);
							const rightLane = Math.max(fromLane, toLane);

							return (
								<div class="group relative flex items-center border-b border-clens transition hover:bg-surface-hover">
									{/* Timestamp */}
									<div class="w-14 flex-shrink-0 px-2 py-0.5 text-[10px] text-muted">
										{formatRelativeTime(msg.t, startTime())}
									</div>

									{/* Swim lanes */}
									<div class="flex flex-1 items-center" style={{ height: "28px" }}>
										<For each={agents()}>
											{(_, idx) => {
												const i = idx();
												const isFrom = i === fromLane;
												const isTo = i === toLane;
												const isBetween = i > leftLane && i < rightLane;

												return (
													<div class="flex-1 flex items-center justify-center relative">
														{/* Dot for sender/receiver */}
														<Show when={isFrom}>
															<div
																class={`h-2.5 w-2.5 rounded-[1px] ${getMsgColor(msg.msg_type)} z-10`}
																title={`${msg.from_name} → ${msg.to_name}: ${msg.summary ?? msg.msg_type}`}
															/>
														</Show>
														<Show when={isTo && !isFrom}>
															<div
																class={`h-2.5 w-2.5 rounded-[1px] border ${getMsgBorderColor(msg.msg_type)} z-10`}
																title={`${msg.from_name} → ${msg.to_name}`}
															/>
														</Show>

														{/* Connecting line — spans between from/to lanes */}
														<Show when={isBetween || ((isFrom || isTo) && fromLane !== toLane)}>
															<div
																class={`absolute top-1/2 h-px ${getMsgColor(msg.msg_type)} opacity-40`}
																style={{
																	left: (() => {
																		if (isBetween) return "0";
																		// From dot or To dot on the left side of the span
																		if (i === leftLane) return "50%";
																		// From dot or To dot on the right side of the span
																		return "0";
																	})(),
																	right: (() => {
																		if (isBetween) return "0";
																		// From dot or To dot on the right side of the span
																		if (i === rightLane) return "50%";
																		// From dot or To dot on the left side of the span
																		return "0";
																	})(),
																}}
															/>
														</Show>

														{/* Vertical lane marker */}
														<Show when={!isFrom && !isTo && !isBetween}>
															<div class="h-full w-px bg-[var(--clens-tick)] absolute " />
														</Show>
													</div>
												);
											}}
										</For>
									</div>

									{/* Message preview tooltip — absolutely positioned, no layout shift */}
									<div class="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
										<div class="mr-2 rounded-none border border-clens bg-surface-overlay px-2 py-1 text-[10px] text-secondary whitespace-nowrap max-w-xs truncate">
											{msg.summary ?? msg.content_preview ?? msg.msg_type}
										</div>
									</div>
								</div>
							);
						}}
					</For>
				</div>
			</Show>
		</div>
	);
};

import { createMemo, For, Show, type Component } from "solid-js";
import type {
	CommunicationSequenceEntry,
	AgentLifetime,
} from "../../shared/types";

// ── Types ────────────────────────────────────────────────────────────

type CommunicationTimelineProps = {
	readonly sequence: readonly CommunicationSequenceEntry[];
	readonly lifetimes?: readonly AgentLifetime[];
	readonly sessionStartTime?: number;
};

// ── Message type colors ──────────────────────────────────────────────

const MSG_TYPE_COLORS: Readonly<Record<string, string>> = {
	message: "bg-blue-500",
	task_complete: "bg-emerald-500",
	idle_notify: "bg-gray-500",
	task_assign: "bg-violet-500",
	shutdown_request: "bg-red-500",
	shutdown_response: "bg-red-400",
	broadcast: "bg-amber-500",
};

const getMsgColor = (msgType: string): string =>
	MSG_TYPE_COLORS[msgType] ?? "bg-gray-500";

const getMsgBorderColor = (msgType: string): string =>
	getMsgColor(msgType).replace("bg-", "border-");

// ── Legend entries ───────────────────────────────────────────────────

const LEGEND_ITEMS: readonly {
	readonly label: string;
	readonly color: string;
}[] = [
	{ label: "message", color: "bg-blue-500" },
	{ label: "task assign", color: "bg-violet-500" },
	{ label: "task complete", color: "bg-emerald-500" },
	{ label: "shutdown", color: "bg-red-500" },
	{ label: "broadcast", color: "bg-amber-500" },
	{ label: "other", color: "bg-gray-500" },
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
	const startTime = () => props.sessionStartTime ?? (props.sequence[0]?.t ?? 0);

	// Unique agent names from lifetimes or sequence
	const agents = createMemo(() => {
		if (props.lifetimes && props.lifetimes.length > 0) {
			return props.lifetimes.map((lt) => lt.agent_name ?? lt.agent_id);
		}
		return [...new Set(props.sequence.flatMap((e) => [e.from_name, e.to_name]))];
	});

	// Lane index for each agent
	const laneIndex = createMemo(
		() => new Map(agents().map((name, idx) => [name, idx])),
	);

	const getLane = (name: string): number => laneIndex().get(name) ?? 0;

	return (
		<div class="flex h-full flex-col">
			<Show
				when={props.sequence.length > 0}
				fallback={
					<div class="flex-1 flex items-center justify-center text-sm text-gray-500">
						No communication data
					</div>
				}
			>
				{/* Legend */}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[10px] text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/30">
					<span class="flex items-center gap-1">
						<span class="inline-block h-2 w-2 rounded-full bg-gray-500" />
						Sender (filled)
					</span>
					<span class="flex items-center gap-1">
						<span class="inline-block h-2 w-2 rounded-full border-2 border-gray-500" />
						Receiver (hollow)
					</span>
					<span class="text-gray-300 dark:text-gray-700">|</span>
					<For each={LEGEND_ITEMS}>
						{(item) => (
							<span class="flex items-center gap-1">
								<span class={`inline-block h-1.5 w-1.5 rounded-full ${item.color}`} />
								{item.label}
							</span>
						)}
					</For>
				</div>

				{/* Swim lane headers */}
				<div class="flex border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
					<div class="w-14 flex-shrink-0 px-2 py-1 text-[10px] text-gray-400 dark:text-gray-400">
						Time
					</div>
					<For each={agents()}>
						{(name) => (
							<div
								class="flex-1 truncate px-2 py-1.5 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400"
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
							const isLeftToRight = fromLane < toLane;

							return (
								<div class="group relative flex items-center border-b border-gray-100 transition hover:bg-gray-50 dark:border-gray-800/30 dark:hover:bg-gray-800/20">
									{/* Timestamp */}
									<div class="w-14 flex-shrink-0 px-2 py-0.5 text-[10px] text-gray-400 dark:text-gray-400">
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
																class={`h-2.5 w-2.5 rounded-full ${getMsgColor(msg.msg_type)} z-10`}
																title={`${msg.from_name} → ${msg.to_name}: ${msg.summary ?? msg.msg_type}`}
															/>
														</Show>
														<Show when={isTo && !isFrom}>
															<div
																class={`h-2.5 w-2.5 rounded-full border-2 ${getMsgBorderColor(msg.msg_type)} z-10`}
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
															<div class="h-full w-px bg-gray-200 absolute dark:bg-gray-800/50" />
														</Show>
													</div>
												);
											}}
										</For>
									</div>

									{/* Message preview tooltip — absolutely positioned, no layout shift */}
									<div class="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
										<div class="mr-2 rounded border border-gray-200 bg-white px-2 py-1 text-[10px] text-gray-600 shadow-sm whitespace-nowrap max-w-xs truncate dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
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

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
		const names = new Set<string>();
		props.sequence.forEach((entry) => {
			names.add(entry.from_name);
			names.add(entry.to_name);
		});
		return [...names];
	});

	// Lane index for each agent
	const laneIndex = createMemo(() => {
		const map = new Map<string, number>();
		agents().forEach((name, idx) => {
			map.set(name, idx);
		});
		return map;
	});

	const getLane = (name: string): number => laneIndex().get(name) ?? 0;

	return (
		<div class="flex h-full flex-col">
			{/* Header */}
			<div class="flex items-center gap-3 border-b border-gray-800 px-4 py-2">
				<h3 class="text-sm font-semibold text-gray-300">Communication</h3>
				<span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
					{props.sequence.length} messages
				</span>
			</div>

			<Show
				when={props.sequence.length > 0}
				fallback={
					<div class="flex-1 flex items-center justify-center text-sm text-gray-500">
						No communication data
					</div>
				}
			>
				{/* Swim lane headers */}
				<div class="flex border-b border-gray-800 bg-gray-900/50">
					<div class="w-16 flex-shrink-0 px-2 py-1.5 text-[10px] text-gray-600">
						Time
					</div>
					<For each={agents()}>
						{(name) => (
							<div
								class="flex-1 truncate px-2 py-1.5 text-center text-[10px] font-medium text-gray-400"
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
							const laneCount = agents().length;
							const leftLane = Math.min(fromLane, toLane);
							const rightLane = Math.max(fromLane, toLane);
							const isLeftToRight = fromLane < toLane;

							return (
								<div class="group flex items-center border-b border-gray-800/30 hover:bg-gray-800/20 transition">
									{/* Timestamp */}
									<div class="w-16 flex-shrink-0 px-2 py-1 text-[10px] text-gray-600">
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
																class={`h-2.5 w-2.5 rounded-full border-2 ${getMsgColor(msg.msg_type).replace("bg-", "border-")} z-10`}
																title={`${msg.from_name} → ${msg.to_name}`}
															/>
														</Show>

														{/* Connecting line */}
														<Show when={isBetween || isFrom || isTo}>
															<div
																class={`absolute top-1/2 h-px ${getMsgColor(msg.msg_type)} opacity-40`}
																style={{
																	left: isFrom && isLeftToRight ? "50%" : isBetween ? "0" : "0",
																	right: isTo && isLeftToRight ? "50%" : isBetween ? "0" : isFrom && !isLeftToRight ? "50%" : "100%",
																	width: isBetween ? "100%" : "50%",
																}}
															/>
														</Show>

														{/* Vertical lane marker */}
														<Show when={!isFrom && !isTo && !isBetween}>
															<div class="h-full w-px bg-gray-800/50 absolute" />
														</Show>
													</div>
												);
											}}
										</For>
									</div>

									{/* Message preview on hover */}
									<div class="w-0 overflow-hidden group-hover:w-48 transition-all">
										<div class="px-2 text-[10px] text-gray-500 truncate">
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

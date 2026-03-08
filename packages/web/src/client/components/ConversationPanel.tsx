import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
	type Accessor,
	type Component,
	type JSX,
} from "solid-js";
import type {
	ConversationEntry,
	BacktrackEntry,
	PhaseBoundaryEntry,
	ThinkingEntry,
	ToolCallEntry,
	ToolResultEntry,
	UserPromptEntry,
} from "@clens/cli";
import { useVirtualList, VIRTUAL_THRESHOLD } from "../lib/useVirtualList";

// ── Constants ────────────────────────────────────────────────────────

const SCROLL_DELAY_MS = 100;
const ESTIMATED_ITEM_HEIGHT = 36;

// ── Types ────────────────────────────────────────────────────────────

type ConversationPanelProps = {
	readonly entries: readonly ConversationEntry[];
	readonly onToolClick?: (toolUseId: string) => void;
	/** Reactive signal — when set, scroll to first tool_call touching this file */
	readonly scrollToFile?: Accessor<string | undefined>;
	/** Reactive signal — CSS selector of element to flash */
	readonly flashSelector?: Accessor<string | undefined>;
	/** Fires when user scrolls near the bottom — used for lazy loading */
	readonly onScrollNearBottom?: () => void;
	/** Whether more entries are currently loading */
	readonly loading?: boolean;
};

type GroupedEntry =
	| { readonly kind: "single"; readonly entry: ConversationEntry; readonly index: number }
	| { readonly kind: "collapsed_tools"; readonly entries: readonly ConversationEntry[]; readonly startIndex: number; readonly tool_name: string; readonly count: number };

// ── Grouping consecutive same-tool calls ─────────────────────────────

const groupEntries = (entries: readonly ConversationEntry[]): readonly GroupedEntry[] =>
	entries.reduce<readonly GroupedEntry[]>((acc, entry, idx) => {
		if (entry.type !== "tool_call" && entry.type !== "tool_result") {
			return [...acc, { kind: "single", entry, index: idx }];
		}

		const toolName = entry.tool_name;
		const last = acc.length > 0 ? acc[acc.length - 1] : undefined;

		if (last?.kind === "collapsed_tools" && last.tool_name === toolName) {
			return [
				...acc.slice(0, -1),
				{
					...last,
					entries: [...last.entries, entry],
					count: last.count + 1,
				},
			];
		}

		// Start a new group only for tool_call (tool_result follows)
		if (entry.type === "tool_call") {
			return [...acc, { kind: "collapsed_tools", entries: [entry], startIndex: idx, tool_name: toolName, count: 1 }];
		}

		// Standalone tool_result without matching group
		return [...acc, { kind: "single", entry, index: idx }];
	}, []);

// ── Intent badge colors ──────────────────────────────────────────────

const INTENT_COLORS: Readonly<Record<string, string>> = {
	planning: "bg-violet-900/60 text-violet-300 border-violet-700/50",
	debugging: "bg-red-900/60 text-red-300 border-red-700/50",
	deciding: "bg-amber-900/60 text-amber-300 border-amber-700/50",
	research: "bg-sky-900/60 text-sky-300 border-sky-700/50",
	general: "bg-gray-800/60 text-gray-400 border-gray-700/50",
};

const getIntentStyle = (intent: string): string =>
	INTENT_COLORS[intent] ?? INTENT_COLORS.general;

// ── Card Components ──────────────────────────────────────────────────

const UserPromptCard: Component<{ readonly entry: UserPromptEntry }> = (props) => (
	<div class="rounded-lg border border-blue-800/40 bg-blue-950/30 px-4 py-3">
		<div class="mb-1 flex items-center gap-2">
			<span class="flex h-5 w-5 items-center justify-center rounded-full bg-blue-800/50 text-[10px] text-blue-300">U</span>
			<span class="text-xs font-medium text-blue-400">User</span>
		</div>
		<p class="whitespace-pre-wrap text-sm text-gray-200">{props.entry.text}</p>
	</div>
);

const ThinkingCard: Component<{ readonly entry: ThinkingEntry }> = (props) => {
	const [expanded, setExpanded] = createSignal(false);

	return (
		<div class="rounded-lg border border-gray-700/40 bg-gray-800/30 px-4 py-2">
			<button
				class="flex w-full items-center gap-2 text-left"
				onClick={() => setExpanded((e) => !e)}
			>
				<span class="text-xs text-gray-500">{expanded() ? "\u25BC" : "\u25B6"}</span>
				<span class="text-xs font-medium text-gray-400">Thinking</span>
				<span
					class={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${getIntentStyle(props.entry.intent)}`}
				>
					{props.entry.intent}
				</span>
				<Show when={props.entry.duration_ms}>
					{(d) => (
						<span class="ml-auto text-[10px] text-gray-600">
							{d() < 1000 ? `${d()}ms` : `${(d() / 1000).toFixed(1)}s`}
						</span>
					)}
				</Show>
			</button>
			<Show when={expanded()}>
				<p class="mt-2 whitespace-pre-wrap text-xs text-gray-400 max-h-60 overflow-y-auto">
					{props.entry.text}
				</p>
			</Show>
		</div>
	);
};

const ToolCallCard: Component<{
	readonly entry: ToolCallEntry;
	readonly onToolClick?: (id: string) => void;
}> = (props) => (
	<div
		class="flex items-center gap-2 rounded-md border border-gray-700/30 bg-gray-800/20 px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-800/40 transition"
		data-tool-use-id={props.entry.tool_use_id}
		onClick={() => props.onToolClick?.(props.entry.tool_use_id)}
	>
		<span class="font-mono font-medium text-gray-300">{props.entry.tool_name}</span>
		<Show when={props.entry.file_path}>
			{(fp) => (
				<span class="truncate font-mono text-gray-500">{fp()}</span>
			)}
		</Show>
		<span class="ml-auto truncate text-gray-600 max-w-[200px]">{props.entry.args_preview}</span>
	</div>
);

const ToolResultCard: Component<{
	readonly entry: ToolResultEntry;
	readonly onToolClick?: (id: string) => void;
}> = (props) => {
	const isSuccess = () => props.entry.outcome === "success";

	return (
		<div
			class="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-800/40 transition"
			classList={{
				"border-emerald-800/30 bg-emerald-950/10": isSuccess(),
				"border-red-800/30 bg-red-950/10": !isSuccess(),
			}}
			data-tool-use-id={props.entry.tool_use_id}
			onClick={() => props.onToolClick?.(props.entry.tool_use_id)}
		>
			<span class={isSuccess() ? "text-emerald-400" : "text-red-400"}>
				{isSuccess() ? "\u2713" : "\u2717"}
			</span>
			<span class="font-mono text-gray-400">{props.entry.tool_name}</span>
			<Show when={!isSuccess() && props.entry.error}>
				{(err) => (
					<span class="ml-2 truncate text-red-400/80 max-w-xs">{err()}</span>
				)}
			</Show>
		</div>
	);
};

const BacktrackCard: Component<{ readonly entry: BacktrackEntry }> = (props) => (
	<div class="rounded-lg border border-amber-700/40 bg-amber-950/20 px-4 py-2">
		<div class="flex items-center gap-2">
			<span class="text-amber-500">!</span>
			<span class="text-xs font-medium text-amber-400">Backtrack</span>
			<span class="rounded-full border border-amber-700/50 bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">
				{props.entry.backtrack_type.replaceAll("_", " ")}
			</span>
			<span class="text-[10px] text-amber-500/70">
				attempt {props.entry.attempt}
			</span>
		</div>
	</div>
);

const PhaseBoundaryCard: Component<{ readonly entry: PhaseBoundaryEntry }> = (props) => (
	<div class="sticky top-0 z-10 -mx-2 flex items-center gap-3 border-b border-gray-700/50 bg-gray-900/90 px-2 py-1.5 backdrop-blur-sm">
		<div class="h-px flex-1 bg-gray-700/50" />
		<span class="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
			{props.entry.phase_name}
		</span>
		<div class="h-px flex-1 bg-gray-700/50" />
	</div>
);

// ── Collapsed tool group ─────────────────────────────────────────────

const CollapsedToolGroup: Component<{
	readonly group: GroupedEntry & { readonly kind: "collapsed_tools" };
	readonly onToolClick?: (id: string) => void;
}> = (props) => {
	const [expanded, setExpanded] = createSignal(props.group.count <= 3);
	const entries = () => props.group.entries;

	return (
		<div class="space-y-0.5">
			<Show when={!expanded() && props.group.count > 3}>
				<button
					class="flex items-center gap-2 rounded-md border border-gray-700/30 bg-gray-800/20 px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800/40 transition w-full text-left"
					onClick={() => setExpanded(true)}
				>
					<span class="font-mono font-medium">{props.group.tool_name}</span>
					<span class="rounded-full bg-gray-700/50 px-1.5 py-0.5 text-[10px]">
						x{props.group.count}
					</span>
					<span class="ml-auto text-gray-600">\u25B6 expand</span>
				</button>
			</Show>
			<Show when={expanded()}>
				<For each={entries()}>
					{(entry) => (
						<div data-entry-index={props.group.startIndex}>
							{entry.type === "tool_call" ? (
								<ToolCallCard entry={entry} onToolClick={props.onToolClick} />
							) : entry.type === "tool_result" ? (
								<ToolResultCard entry={entry as ToolResultEntry} onToolClick={props.onToolClick} />
							) : null}
						</div>
					)}
				</For>
				<Show when={props.group.count > 3}>
					<button
						class="text-[10px] text-gray-600 hover:text-gray-400 transition px-3"
						onClick={() => setExpanded(false)}
					>
						\u25B2 collapse {props.group.tool_name} x{props.group.count}
					</button>
				</Show>
			</Show>
		</div>
	);
};

// ── Jump-to navigation ───────────────────────────────────────────────

type JumpTarget = "backtrack" | "failure" | "thinking";

const JUMP_CONFIG: ReadonlyArray<{
	readonly target: JumpTarget;
	readonly label: string;
	readonly cls: string;
}> = [
	{ target: "backtrack", label: "Next backtrack", cls: "border-amber-700/50 text-amber-400 hover:bg-amber-900/20" },
	{ target: "failure", label: "Next failure", cls: "border-red-700/50 text-red-400 hover:bg-red-900/20" },
	{ target: "thinking", label: "Next thinking", cls: "border-gray-700/50 text-gray-400 hover:bg-gray-800/30" },
] as const;

const matchesJumpTarget = (entry: ConversationEntry, target: JumpTarget): boolean => {
	if (target === "backtrack") return entry.type === "backtrack";
	if (target === "failure") return entry.type === "tool_result" && entry.outcome === "failure";
	if (target === "thinking") return entry.type === "thinking";
	return false;
};

// ── Minimap ──────────────────────────────────────────────────────────

const MINIMAP_COLORS: Readonly<Record<string, string>> = {
	user_prompt: "bg-blue-500",
	thinking: "bg-gray-500",
	tool_call: "bg-gray-700",
	tool_result: "bg-gray-600",
	backtrack: "bg-amber-500",
	phase_boundary: "bg-violet-500",
};

const getMinimapColor = (entry: ConversationEntry): string => {
	if (entry.type === "tool_result" && entry.outcome === "failure") return "bg-red-500";
	return MINIMAP_COLORS[entry.type] ?? "bg-gray-700";
};

const Minimap: Component<{
	readonly entries: readonly ConversationEntry[];
	readonly containerRef: HTMLDivElement | undefined;
}> = (props) => {
	const markers = createMemo(() =>
		props.entries.map((entry, idx) => ({
			color: getMinimapColor(entry),
			position: props.entries.length > 0 ? (idx / props.entries.length) * 100 : 0,
			index: idx,
		})),
	);

	const scrollTo = (index: number) => {
		const el = props.containerRef?.querySelector(`[data-entry-index="${index}"]`);
		el?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	return (
		<div class="absolute right-0 top-0 bottom-0 w-2 bg-gray-900/50">
			<For each={markers()}>
				{(m) => (
					<button
						class={`absolute right-0 h-0.5 w-2 ${m.color} opacity-60 hover:opacity-100 transition-opacity`}
						style={{ top: `${m.position}%` }}
						onClick={() => scrollTo(m.index)}
						aria-label={`Jump to entry ${m.index}`}
					/>
				)}
			</For>
		</div>
	);
};

// ── Main component ───────────────────────────────────────────────────

export const ConversationPanel: Component<ConversationPanelProps> = (props) => {
	let scrollContainerRef: HTMLDivElement | undefined;
	let sentinelRef: HTMLDivElement | undefined;

	const grouped = createMemo(() => groupEntries(props.entries));

	// ── Container height for virtual list ────────────────────────

	const [containerHeight, setContainerHeight] = createSignal(800);

	createEffect(() => {
		if (!scrollContainerRef) return;
		const observer = new ResizeObserver((resizeEntries) => {
			const entry = resizeEntries[0];
			if (entry) setContainerHeight(entry.contentRect.height);
		});
		observer.observe(scrollContainerRef);
		onCleanup(() => observer.disconnect());
	});

	// ── Virtual list ─────────────────────────────────────────────

	const virtualList = useVirtualList(grouped, ESTIMATED_ITEM_HEIGHT, containerHeight);

	// ── Infinite scroll via IntersectionObserver ──────────────────

	createEffect(() => {
		if (!sentinelRef || !props.onScrollNearBottom) return;

		const observer = new IntersectionObserver(
			(observerEntries) => {
				if (observerEntries[0]?.isIntersecting) {
					props.onScrollNearBottom?.();
				}
			},
			{ root: scrollContainerRef, rootMargin: "200px" },
		);

		observer.observe(sentinelRef);
		onCleanup(() => observer.disconnect());
	});

	// ── Jump-to navigation ────────────────────────────────────────

	const [jumpPosition, setJumpPosition] = createSignal<Record<JumpTarget, number>>({
		backtrack: -1,
		failure: -1,
		thinking: -1,
	});

	const jumpTo = (target: JumpTarget) => {
		const currentPos = jumpPosition()[target];
		const nextIdx = props.entries.findIndex(
			(entry, idx) => idx > currentPos && matchesJumpTarget(entry, target),
		);

		// Wrap around if not found
		const targetIdx = nextIdx >= 0
			? nextIdx
			: props.entries.findIndex((entry) => matchesJumpTarget(entry, target));

		if (targetIdx < 0) return;

		setJumpPosition((prev) => ({ ...prev, [target]: targetIdx }));

		const el = scrollContainerRef?.querySelector(`[data-entry-index="${targetIdx}"]`);
		el?.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	// ── Scroll to file (from DiffPanel link) ─────────────────────

	createEffect(() => {
		const filePath = props.scrollToFile?.();
		if (!filePath || !scrollContainerRef) return;

		// Find the first tool_call entry that touches this file
		const targetEntry = props.entries.find(
			(e) => e.type === "tool_call" && e.file_path === filePath,
		);
		if (targetEntry?.type !== "tool_call") return;

		const toolUseId = targetEntry.tool_use_id;

		setTimeout(() => {
			const el = scrollContainerRef?.querySelector(
				`[data-tool-use-id="${CSS.escape(toolUseId)}"]`,
			);
			if (el) {
				el.scrollIntoView({ behavior: "smooth", block: "center" });
			}
		}, SCROLL_DELAY_MS);
	});

	// ── Flash detection ──────────────────────────────────────────

	const isFlashing = (toolUseId: string): boolean => {
		const sel = props.flashSelector?.();
		return sel === `[data-tool-use-id="${toolUseId}"]`;
	};

	// ── Render ────────────────────────────────────────────────────

	const renderEntry = (entry: ConversationEntry, index: number): JSX.Element => {
		switch (entry.type) {
			case "user_prompt":
				return <UserPromptCard entry={entry} />;
			case "thinking":
				return <ThinkingCard entry={entry} />;
			case "tool_call":
				return (
					<div classList={{ "clens-flash": isFlashing(entry.tool_use_id) }}>
						<ToolCallCard entry={entry} onToolClick={props.onToolClick} />
					</div>
				);
			case "tool_result":
				return (
					<div classList={{ "clens-flash": isFlashing(entry.tool_use_id) }}>
						<ToolResultCard entry={entry} onToolClick={props.onToolClick} />
					</div>
				);
			case "backtrack":
				return <BacktrackCard entry={entry} />;
			case "phase_boundary":
				return <PhaseBoundaryCard entry={entry} />;
		}
	};

	return (
		<div class="relative flex h-full flex-col">
			{/* Jump-to bar */}
			<div class="flex items-center gap-2 border-b border-gray-800 bg-gray-900/80 px-3 py-1.5">
				<span class="text-[10px] text-gray-600">Jump to:</span>
				{JUMP_CONFIG.map((cfg) => (
					<button
						class={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${cfg.cls}`}
						onClick={() => jumpTo(cfg.target)}
					>
						{cfg.label}
					</button>
				))}
				<span class="ml-auto text-[10px] text-gray-600">
					{props.entries.length} entries
				</span>
			</div>

			{/* Scrollable entry list */}
			<div
				ref={scrollContainerRef}
				class="relative flex-1 overflow-y-auto px-2 py-2"
				onScroll={virtualList.onScroll}
			>
				<Show
					when={virtualList.isVirtual()}
					fallback={
						/* Standard rendering for small lists */
						<div class="space-y-1">
							<For each={grouped()}>
								{(group) => (
									<Show
										when={group.kind === "single"}
										fallback={
											<CollapsedToolGroup
												group={group as GroupedEntry & { kind: "collapsed_tools" }}
												onToolClick={props.onToolClick}
											/>
										}
									>
										<div data-entry-index={(group as GroupedEntry & { kind: "single" }).index}>
											{renderEntry(
												(group as GroupedEntry & { kind: "single" }).entry,
												(group as GroupedEntry & { kind: "single" }).index,
											)}
										</div>
									</Show>
								)}
							</For>
						</div>
					}
				>
					{/* Virtual rendering for large lists */}
					<div style={{ height: `${virtualList.totalHeight()}px`, position: "relative" }}>
						<For each={virtualList.visibleItems()}>
							{(vItem) => {
								const group = vItem.item;
								return (
									<div
										style={{
											position: "absolute",
											top: `${vItem.offsetTop}px`,
											left: "0",
											right: "0",
											"min-height": `${ESTIMATED_ITEM_HEIGHT}px`,
										}}
									>
										<Show
											when={group.kind === "single"}
											fallback={
												<CollapsedToolGroup
													group={group as GroupedEntry & { kind: "collapsed_tools" }}
													onToolClick={props.onToolClick}
												/>
											}
										>
											<div data-entry-index={(group as GroupedEntry & { kind: "single" }).index}>
												{renderEntry(
													(group as GroupedEntry & { kind: "single" }).entry,
													(group as GroupedEntry & { kind: "single" }).index,
												)}
											</div>
										</Show>
									</div>
								);
							}}
						</For>
					</div>
				</Show>

				{/* Loading indicator */}
				<Show when={props.loading}>
					<div class="flex items-center justify-center py-4">
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
						<span class="ml-2 text-xs text-gray-500">Loading more...</span>
					</div>
				</Show>

				{/* Scroll sentinel for infinite loading */}
				<div ref={sentinelRef} class="h-1" />

				{/* Minimap */}
				<Minimap entries={props.entries} containerRef={scrollContainerRef} />
			</div>
		</div>
	);
};

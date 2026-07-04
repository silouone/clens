import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { BacktrackResult } from "../../../shared/types";
import { CATEGORY } from "../../lib/categories";
import { formatRelTime } from "../../lib/format";
import { BACKTRACK_COLORS, DonutChart, HorizontalBar } from "../charts";
import { StatTile } from "../ui/StatTile";
import type { TabProps } from "./types";

// ── BacktracksTab [risk] — backtrack shape at a glance (R-C2, AC7) ─────
//
// Wave 2 rework. A glanceable SUMMARY HEADER sits above an improved detail
// list so the SHAPE of a run's thrash reads instantly instead of as a flat
// monochrome column:
//   • headline tiles  — total · wasted attempts (Σ attempts−1) · tools · files
//   • by-type donut + by-tool bar — keyed by BACKTRACK_COLORS
//   • time-distribution strip — backtracks binned across the session span so
//     clustering ("where did it thrash?") is visible (R-C2)
// The detail list below is grouped/sortable by type and filterable, each row
// carrying time · type badge · tool · file · attempts · verbatim error preview,
// and PRESERVES the backtrack→timeline jump via onBacktrackClick (R-F2).
// Every color (donut, strip, badge, chip, group rule) is driven from the one
// BACKTRACK_COLORS map so a type reads as a single consistent channel.

// The three structural backtrack types, in BACKTRACK_COLORS key order. A literal
// const tuple keeps BACKTRACK_COLORS[t] index-safe without an `as` cast.
const BT_TYPES = ["failure_retry", "iteration_struggle", "debugging_loop"] as const;
type BacktrackType = (typeof BT_TYPES)[number];

const humanizeType = (type: string): string => type.replace(/_/g, " ");

/** First line of a (possibly multi-line) error message, rendered verbatim. */
const firstLine = (msg: string): string => msg.split("\n")[0] ?? msg;

const STRIP_BINS = 64;
const STRIP_H = 40;

type StripRect = {
	readonly x: number;
	readonly y: number;
	readonly h: number;
	readonly color: string;
};

const EmptyTab: Component<{ readonly message: string }> = (props) => (
	<div class="flex h-full items-center justify-center py-8">
		<span class="instrument-microcaps flex items-center gap-2 rounded-none border border-clens px-3 py-1.5 text-[10px] text-muted">
			<span class="instrument-led" style={{ "background-color": "var(--clens-success)" }} />
			{props.message}
		</span>
	</div>
);

export const BacktracksTab: Component<TabProps> = (props) => {
	const backtracks = () => props.session.backtracks;
	const startTime = () =>
		props.session.start_time ??
		(backtracks().length > 0 ? Math.min(...backtracks().map((b) => b.start_t)) : 0);

	// Session span end: the latest of the last timeline event and the latest
	// backtrack end, so the distribution strip spans the whole run, not just the
	// backtrack window.
	const endTime = () => {
		const tl = props.session.timeline;
		const lastTl = tl && tl.length > 0 ? tl[tl.length - 1].t : 0;
		const maxBtEnd = backtracks().reduce((m, b) => Math.max(m, b.end_t), 0);
		return Math.max(startTime() + 1, lastTl, maxBtEnd);
	};

	// ── Headline figures ──────────────────────────────────────────────
	const total = () => backtracks().length;
	const wasted = createMemo(() =>
		backtracks().reduce((sum, bt) => sum + Math.max(0, bt.attempts - 1), 0),
	);
	const toolCount = createMemo(() => new Set(backtracks().map((b) => b.tool_name)).size);
	const fileCount = createMemo(
		() =>
			new Set(
				backtracks()
					.filter((b) => b.file_path)
					.map((b) => b.file_path),
			).size,
	);

	// ── Shape: by type (donut) + by tool (bar) ────────────────────────
	const byType = createMemo(() =>
		BT_TYPES.map((t) => ({
			label: humanizeType(t),
			value: backtracks().filter((b) => b.type === t).length,
			color: BACKTRACK_COLORS[t],
		}))
			.filter((seg) => seg.value > 0)
			.sort((a, b) => b.value - a.value),
	);

	const byTool = createMemo(() => {
		const counts = backtracks().reduce<ReadonlyMap<string, number>>(
			(acc, bt) => new Map([...acc, [bt.tool_name, (acc.get(bt.tool_name) ?? 0) + 1]]),
			new Map(),
		);
		return [...counts]
			.map(([tool_name, count]) => ({ tool_name, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 6);
	});

	// ── Shape: distribution over the session span (binned stacked strip) ─
	const binnedRects = createMemo<readonly StripRect[]>(() => {
		const s = startTime();
		const span = Math.max(1, endTime() - s);
		const bins = Array.from({ length: STRIP_BINS }, (_, i) => {
			const lo = s + (i / STRIP_BINS) * span;
			const hi = s + ((i + 1) / STRIP_BINS) * span;
			const isLast = i === STRIP_BINS - 1;
			const counts = BT_TYPES.map(
				(t) =>
					backtracks().filter(
						(bt) =>
							bt.type === t && bt.start_t >= lo && (isLast ? bt.start_t <= hi : bt.start_t < hi),
					).length,
			);
			return { i, counts, total: counts.reduce((a, b) => a + b, 0) };
		});
		const max = Math.max(1, ...bins.map((b) => b.total));
		return bins.flatMap((bin) => {
			const segs = BT_TYPES.map((t, ti) => ({
				color: BACKTRACK_COLORS[t],
				count: bin.counts[ti] ?? 0,
			})).filter((seg) => seg.count > 0);
			const stacked = segs.reduce<{ readonly rects: readonly StripRect[]; readonly acc: number }>(
				(state, seg) => {
					const h = (seg.count / max) * STRIP_H;
					return {
						rects: [...state.rects, { x: bin.i, y: STRIP_H - state.acc - h, h, color: seg.color }],
						acc: state.acc + h,
					};
				},
				{ rects: [], acc: 0 },
			);
			return stacked.rects;
		});
	});

	// ── Detail list: filter + sort ────────────────────────────────────
	const [sortMode, setSortMode] = createSignal<"time" | "type">("time");
	const [typeFilter, setTypeFilter] = createSignal<BacktrackType | "all">("all");

	// Type chips reflect only types actually present (R-E1: no empty shells).
	const presentTypes = createMemo(() =>
		BT_TYPES.map((t) => ({
			type: t,
			count: backtracks().filter((b) => b.type === t).length,
		})).filter((c) => c.count > 0),
	);

	const filtered = createMemo(() => {
		const f = typeFilter();
		return f === "all" ? backtracks() : backtracks().filter((b) => b.type === f);
	});

	const groups = createMemo<
		readonly { readonly type: BacktrackType | null; readonly items: readonly BacktrackResult[] }[]
	>(() => {
		const byTimeAsc = (a: BacktrackResult, b: BacktrackResult) => a.start_t - b.start_t;
		if (sortMode() === "type") {
			return BT_TYPES.map((t) => ({
				type: t,
				items: filtered()
					.filter((b) => b.type === t)
					.slice()
					.sort(byTimeAsc),
			})).filter((g) => g.items.length > 0);
		}
		return [{ type: null, items: filtered().slice().sort(byTimeAsc) }];
	});

	const sortBtnClass = (mode: "time" | "type") =>
		`instrument-microcaps rounded-none border px-2 py-0.5 text-[9px] transition ${
			sortMode() === mode
				? "border-strong bg-surface-inset text-primary"
				: "border-clens text-muted hover:text-secondary"
		}`;

	return (
		<Show when={total() > 0} fallback={<EmptyTab message="Clean run — no backtracks" />}>
			<div class="flex flex-col">
				{/* ── SUMMARY HEADER ──────────────────────────────────── */}
				<div
					class={`space-y-3 border-b border-clens bg-surface-raised p-3 ${CATEGORY.risk.ruleClass}`}
				>
					{/* Headline tiles — each self-gates on a non-zero value. */}
					<div class="flex flex-wrap gap-1.5">
						<StatTile category="risk" label="Backtracks" value={total()} class="flex-1" />
						<Show when={wasted() > 0}>
							<StatTile category="risk" label="Wasted attempts" value={wasted()} class="flex-1" />
						</Show>
						<Show when={toolCount() > 0}>
							<StatTile category="risk" label="Tools" value={toolCount()} class="flex-1" />
						</Show>
						<Show when={fileCount() > 0}>
							<StatTile category="risk" label="Files" value={fileCount()} class="flex-1" />
						</Show>
					</div>

					{/* By type (donut) + by tool (bar). */}
					<div class="grid gap-3 md:grid-cols-2">
						<Show when={byType().length > 0}>
							<div>
								<span class="instrument-microcaps text-[10px] text-muted">By type</span>
								<div class="mt-1.5">
									<DonutChart
										segments={byType()}
										size={120}
										centerLabel="Total"
										centerValue={String(total())}
										formatValue={(v) => String(v)}
										ariaLabel="Backtracks by type"
									/>
								</div>
							</div>
						</Show>
						<Show when={byTool().length > 0}>
							<div>
								<span class="instrument-microcaps text-[10px] text-muted">By tool</span>
								<div class="mt-1.5">
									<HorizontalBar
										data={byTool()}
										label={(d) => d.tool_name}
										value={(d) => d.count}
										color={CATEGORY.risk.cssVar}
										ariaLabel="Backtracks by tool"
										tooltipLabel={(d) => `${d.tool_name}: ${d.count} backtracks`}
									/>
								</div>
							</div>
						</Show>
					</div>

					{/* Distribution over the session span — clustering at a glance. */}
					<div>
						<span class="instrument-microcaps text-[10px] text-muted">
							Distribution over session
						</span>
						<svg
							viewBox={`0 0 ${STRIP_BINS} ${STRIP_H}`}
							preserveAspectRatio="none"
							class="mt-1.5 w-full rounded-none border border-clens"
							style={{ height: `${STRIP_H}px` }}
							role="img"
							aria-label="Backtracks distributed over the session span"
						>
							<rect
								x={0}
								y={0}
								width={STRIP_BINS}
								height={STRIP_H}
								fill="var(--clens-surface-inset)"
							/>
							<For each={binnedRects()}>
								{(r) => (
									<rect
										x={r.x + 0.1}
										y={r.y}
										width={0.8}
										height={r.h}
										fill={r.color}
										opacity={0.85}
									/>
								)}
							</For>
						</svg>
						<div class="mt-1 flex justify-between">
							<span class="font-mono text-[9px] tabular-nums text-muted">start</span>
							<span class="font-mono text-[9px] tabular-nums text-muted">end</span>
						</div>
					</div>
				</div>

				{/* ── CONTROLS: sort + type filter ─────────────────────── */}
				<div class="flex flex-wrap items-center gap-2 border-b border-clens px-3 py-1.5">
					<span class="instrument-microcaps text-[9px] text-muted">Sort</span>
					<div class="flex gap-1">
						<button type="button" class={sortBtnClass("time")} onClick={() => setSortMode("time")}>
							Time
						</button>
						<button type="button" class={sortBtnClass("type")} onClick={() => setSortMode("type")}>
							By type
						</button>
					</div>
					<Show when={presentTypes().length > 1}>
						<span class="ml-2 h-3 w-px bg-clens" aria-hidden="true" />
						<button
							type="button"
							class={`instrument-microcaps rounded-none border px-2 py-0.5 text-[9px] transition ${
								typeFilter() === "all"
									? "border-strong bg-surface-inset text-primary"
									: "border-clens text-muted hover:text-secondary"
							}`}
							onClick={() => setTypeFilter("all")}
						>
							All
						</button>
						<For each={presentTypes()}>
							{(chip) => (
								<button
									type="button"
									class={`instrument-microcaps flex items-center gap-1 rounded-none border px-2 py-0.5 text-[9px] transition ${
										typeFilter() === chip.type
											? "border-strong bg-surface-inset text-primary"
											: "border-clens text-muted hover:text-secondary"
									}`}
									onClick={() => setTypeFilter((cur) => (cur === chip.type ? "all" : chip.type))}
								>
									<span
										class="instrument-led"
										style={{ "background-color": BACKTRACK_COLORS[chip.type] }}
									/>
									{humanizeType(chip.type)}
									<span class="font-mono tabular-nums text-muted">{chip.count}</span>
								</button>
							)}
						</For>
					</Show>
				</div>

				{/* ── DETAIL LIST ──────────────────────────────────────── */}
				<For each={groups()}>
					{(group) => (
						<div>
							<Show when={group.type}>
								{(t) => (
									<div
										class="flex items-center gap-1.5 border-b border-clens bg-surface-inset px-3 py-1"
										style={{ "box-shadow": `inset 2px 0 0 0 ${BACKTRACK_COLORS[t()]}` }}
									>
										<span
											class="instrument-led"
											style={{ "background-color": BACKTRACK_COLORS[t()] }}
										/>
										<span class="instrument-microcaps text-[9px] text-secondary">
											{humanizeType(t())}
										</span>
										<span class="font-mono text-[9px] tabular-nums text-muted">
											{group.items.length}
										</span>
									</div>
								)}
							</Show>
							<div class="divide-y divide-clens">
								<For each={group.items}>
									{(bt) => (
										<button
											type="button"
											onClick={() => props.onBacktrackClick?.(bt.start_t)}
											class="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition hover:bg-surface-hover"
											title="Jump to this point in the timeline"
										>
											<div class="flex items-center gap-2 text-xs">
												<span class="w-14 flex-shrink-0 font-mono text-[10px] tabular-nums text-muted">
													{formatRelTime(bt.start_t, startTime())}
												</span>
												<span
													class="instrument-microcaps flex-shrink-0 rounded-none border border-clens px-1.5 py-0.5 text-[9px] text-secondary"
													style={{ "border-left": `2px solid ${BACKTRACK_COLORS[bt.type]}` }}
												>
													{humanizeType(bt.type)}
												</span>
												<span class="flex-shrink-0 font-mono text-[11px] text-secondary">
													{bt.tool_name}
												</span>
												<Show when={bt.file_path}>
													{(fp) => (
														<span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
															{fp()}
														</span>
													)}
												</Show>
												<span class="ml-auto flex-shrink-0 font-mono text-[10px] tabular-nums text-muted">
													{bt.attempts}×
												</span>
											</div>
											<Show when={bt.error_message}>
												{(msg) => (
													<span class="truncate pl-16 font-mono text-[10px] text-cat-risk">
														{firstLine(msg())}
													</span>
												)}
											</Show>
										</button>
									)}
								</For>
							</div>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
};

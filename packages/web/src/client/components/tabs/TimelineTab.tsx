import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import { DensityRibbon } from "../charts/DensityRibbon";
import { formatDuration, formatRelTime } from "../../lib/format";
import type { TabProps } from "./types";

// ── TimelineTab — Wave 2 rework (DensityRibbon headline) ─────────────
//
// SUMMARY VIZ (the headline, R-C5 / AC9): a full-span DensityRibbon over the
// whole session [start, end], one band per event coloured by type — so the
// run's rhythm, bursts, idle gaps and phase boundaries read at a glance.
// Dragging a region of the ribbon filters the detail list to that time window
// (custom overlay brush — the shared `createBrush` is calendar-day-domain only);
// a single click clears the window. Phase boundaries are overlaid as ticks.
//
// DETAIL: the original filterable chronological list is preserved (R-F2) but
// reworked for density + per-type colour: legend chips now carry a coloured LED
// swatch + per-type count and toggle inclusion, and each row gets a coloured
// left-rule + coloured type label. The headline "N events" reflects the live
// (type + window) filtered view.

// Canonical legend ordering (typed wide so `.includes(string)` is clean).
const CANON_TYPES: readonly string[] = [
	"user_prompt",
	"thinking",
	"tool_call",
	"tool_result",
	"failure",
	"backtrack",
	"phase_boundary",
	"agent_spawn",
	"agent_stop",
	"task_create",
	"task_assign",
	"task_complete",
	"msg_send",
	"teammate_idle",
];

// Per-type stroke — kept in lock-step with DensityRibbon's own DENSITY_COLORS
// so the legend swatch + row rule match the band colour exactly (the ribbon
// does not export its map, so it is mirrored here).
const TYPE_COLOR: Readonly<Record<string, string>> = {
	user_prompt: "var(--clens-cat-outcome)",
	thinking: "var(--clens-cat-context)",
	tool_call: "var(--clens-cat-timing)",
	tool_result: "var(--clens-cat-timing)",
	failure: "var(--clens-cat-risk)",
	backtrack: "var(--clens-cat-cost)",
	phase_boundary: "var(--clens-tick)",
	agent_spawn: "var(--clens-cat-agents)",
	agent_stop: "var(--clens-cat-agents)",
	task_create: "var(--clens-cat-agents)",
	task_assign: "var(--clens-cat-agents)",
	task_complete: "var(--clens-cat-agents)",
	msg_send: "var(--clens-cat-comms)",
	teammate_idle: "var(--clens-text-muted)",
};

const typeColor = (t: string): string => TYPE_COLOR[t] ?? "var(--clens-text-muted)";
const typeLabel = (t: string): string => t.replaceAll("_", " ");

// Smallest drag (as a fraction of ribbon width) that counts as a brush; below
// it the gesture is treated as a click and clears any active window.
const MIN_BRUSH_FRAC = 0.012;

const EmptyTab: Component<{ readonly message: string }> = (props) => (
	<div class="flex h-full items-center justify-center py-8">
		<span class="instrument-microcaps border border-clens px-3 py-1.5 text-[10px] text-muted">
			{props.message}
		</span>
	</div>
);

const Stat: Component<{ readonly label: string; readonly value: string | number }> = (props) => (
	<div class="flex items-baseline gap-1.5">
		<span class="font-mono text-sm tabular-nums text-secondary">{props.value}</span>
		<span class="instrument-microcaps text-[10px] text-muted">{props.label}</span>
	</div>
);

export const TimelineTab: Component<TabProps> = (props) => {
	const timeline = createMemo(() => props.session.timeline ?? []);

	// The timeline is not guaranteed sorted, so derive [min,max] in one pass
	// rather than trusting events[0]/[last].
	const bounds = createMemo(() =>
		timeline().reduce(
			(acc, e) => ({ min: Math.min(acc.min, e.t), max: Math.max(acc.max, e.t) }),
			{ min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
		),
	);

	// Span derivation MUST match what is handed to DensityRibbon (and mirrors
	// ActivityWidget) so the brush band lines up with the bars: honest
	// wall-clock first, then the last event, then the idle-trimmed duration.
	const startTime = createMemo(() => props.session.start_time ?? bounds().min);
	const endTime = createMemo(() => {
		const s = startTime();
		const wall = props.session.stats.wall_duration_ms;
		if (wall !== undefined && wall > 0) return s + wall;
		const max = bounds().max;
		if (Number.isFinite(max) && max > s) return max;
		return s + props.session.stats.duration_ms;
	});
	const spanMs = () => Math.max(1, endTime() - startTime());

	// Session-total counts per present type, in canonical order, with any
	// non-canonical types appended defensively.
	const presentTypes = createMemo(() => {
		const tl = timeline();
		const countOf = (t: string): number => tl.filter((e) => e.type === t).length;
		const known = CANON_TYPES.map((t) => ({ type: t, count: countOf(t) })).filter((c) => c.count > 0);
		const extras = [...new Set(tl.map((e) => e.type))]
			.filter((t) => !CANON_TYPES.includes(t))
			.map((t) => ({ type: t, count: countOf(t) }));
		return [...known, ...extras];
	});

	// Longest idle gap between consecutive events — a glanceable rhythm metric.
	const longestIdleMs = createMemo(() => {
		const ts = [...timeline().map((e) => e.t)].sort((a, b) => a - b);
		return ts.reduce((acc, t, i) => (i === 0 ? acc : Math.max(acc, t - ts[i - 1])), 0);
	});

	const phaseMarkers = createMemo(() =>
		timeline()
			.filter((e) => e.type === "phase_boundary")
			.map((e) => ({
				frac: Math.max(0, Math.min(1, (e.t - startTime()) / spanMs())),
				label: e.content_preview ?? "phase",
			})),
	);

	// ── Filters ──────────────────────────────────────────────────────
	// Type filter tracked as the EXCLUDED set (default empty = all shown), so a
	// fresh session reactively shows everything without seeding state.
	const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
	const toggleType = (t: string) =>
		setExcluded((prev) =>
			prev.has(t) ? new Set([...prev].filter((x) => x !== t)) : new Set([...prev, t]),
		);

	// Window selection in fractions [0..1] of the span. Committed on mouseup so
	// the 493-row list only re-filters once per drag; the band <div> follows the
	// live drag signals.
	const [windowSel, setWindowSel] = createSignal<{ readonly lo: number; readonly hi: number } | undefined>();
	const [dragOrigin, setDragOrigin] = createSignal<number | undefined>();
	const [dragCur, setDragCur] = createSignal<number | undefined>();

	const fracFrom = (e: MouseEvent): number => {
		const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return 0;
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	};

	const onDown = (e: MouseEvent) => {
		e.preventDefault();
		const f = fracFrom(e);
		setDragOrigin(f);
		setDragCur(f);
	};
	const onMove = (e: MouseEvent) => {
		if (dragOrigin() === undefined) return;
		setDragCur(fracFrom(e));
	};
	const onUp = (e: MouseEvent) => {
		const o = dragOrigin();
		if (o === undefined) return;
		const c = fracFrom(e);
		setDragOrigin(undefined);
		setDragCur(undefined);
		const lo = Math.min(o, c);
		const hi = Math.max(o, c);
		// Sub-threshold drag = a click → clear the window.
		setWindowSel(hi - lo < MIN_BRUSH_FRAC ? undefined : { lo, hi });
	};
	const onLeave = () => {
		setDragOrigin(undefined);
		setDragCur(undefined);
	};

	const band = createMemo(() => {
		const o = dragOrigin();
		const c = dragCur();
		if (o !== undefined && c !== undefined) return { lo: Math.min(o, c), hi: Math.max(o, c) };
		return windowSel();
	});

	const windowMs = createMemo(() => {
		const w = windowSel();
		if (!w) return undefined;
		return { lo: startTime() + w.lo * spanMs(), hi: startTime() + w.hi * spanMs() };
	});

	const filtered = createMemo(() => {
		const ex = excluded();
		const w = windowMs();
		return timeline().filter(
			(e) => !ex.has(e.type) && (w === undefined || (e.t >= w.lo && e.t <= w.hi)),
		);
	});

	return (
		<Show when={timeline().length > 0} fallback={<EmptyTab message="No timeline data" />}>
			<div class="flex h-full flex-col">
				{/* ── Summary viz: headline stats + full-span ribbon (brush) ── */}
				<div class="border-b border-clens px-3 py-2">
					<div class="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
						<div class="flex items-baseline gap-1.5">
							<span class="font-mono text-2xl leading-none tabular-nums text-primary">
								{filtered().length}
							</span>
							<span class="instrument-microcaps text-[10px] text-muted">events</span>
							<Show when={filtered().length !== timeline().length}>
								<span class="font-mono text-[10px] tabular-nums text-muted">
									/ {timeline().length}
								</span>
							</Show>
						</div>
						<Stat label="span" value={formatDuration(spanMs())} />
						<Show when={longestIdleMs() > 0}>
							<Stat label="idle gap" value={formatDuration(longestIdleMs())} />
						</Show>
						<Stat label="types" value={presentTypes().length} />
						<Show when={windowMs()}>
							{(w) => (
								<button
									onClick={() => setWindowSel(undefined)}
									class="instrument-microcaps ml-auto inline-flex items-center gap-1 rounded-none border border-clens px-1.5 py-0.5 text-[10px] text-secondary transition hover:text-primary"
								>
									<span
										class="inline-block h-2 w-2 rounded-none"
										style={{ background: "var(--clens-brand)" }}
									/>
									{formatRelTime(w().lo, startTime())}–{formatRelTime(w().hi, startTime())}
									<span class="text-muted">clear</span>
								</button>
							)}
						</Show>
					</div>

					<div class="relative select-none">
						<DensityRibbon
							events={timeline()}
							startTime={startTime()}
							endTime={endTime()}
							height={40}
							ariaLabel="Event density over the session span"
						/>
						<For each={phaseMarkers()}>
							{(m) => (
								<div
									class="pointer-events-none absolute bottom-0 top-0 w-px"
									style={{ left: `${m.frac * 100}%`, background: "var(--clens-cat-outcome)" }}
									title={m.label}
								/>
							)}
						</For>
						<Show when={band()}>
							{(b) => (
								<div
									class="pointer-events-none absolute bottom-0 top-0 border-x border-clens"
									style={{
										left: `${b().lo * 100}%`,
										width: `${Math.max(0, b().hi - b().lo) * 100}%`,
										background: "var(--clens-brand)",
										opacity: "0.18",
									}}
								/>
							)}
						</Show>
						<div
							class="absolute inset-0 cursor-crosshair"
							onMouseDown={onDown}
							onMouseMove={onMove}
							onMouseUp={onUp}
							onMouseLeave={onLeave}
						/>
					</div>
					<div class="instrument-microcaps mt-1 text-[9px] text-muted">
						drag a region to filter the list · click to clear
					</div>
				</div>

				{/* ── Legend / per-type filter chips ── */}
				<div class="flex flex-wrap items-center gap-1 border-b border-clens px-3 py-1.5">
					<For each={presentTypes()}>
						{(pt) => {
							const active = () => !excluded().has(pt.type);
							return (
								<button
									onClick={() => toggleType(pt.type)}
									class="instrument-microcaps inline-flex items-center gap-1 rounded-none border px-1.5 py-0.5 text-[10px] transition"
									classList={{
										"border-clens text-secondary": active(),
										"border-transparent text-muted opacity-50 hover:opacity-80": !active(),
									}}
								>
									<span
										class="inline-block h-2 w-2 rounded-none"
										style={{ background: active() ? typeColor(pt.type) : "var(--clens-text-muted)" }}
									/>
									{typeLabel(pt.type)}
									<span class="font-mono tabular-nums text-muted">{pt.count}</span>
								</button>
							);
						}}
					</For>
				</div>

				{/* ── Detail list (chronological, per-type left-rule) ── */}
				<Show
					when={filtered().length > 0}
					fallback={<EmptyTab message="No events match the current filters" />}
				>
					<div class="flex-1 divide-y divide-clens overflow-y-auto">
						<For each={filtered()}>
							{(entry) => (
								<div
									class="flex items-center gap-3 border-l-2 px-3 py-1 text-xs"
									style={{ "border-left-color": typeColor(entry.type) }}
								>
									<span class="w-14 shrink-0 font-mono text-[10px] tabular-nums text-muted">
										{formatRelTime(entry.t, startTime())}
									</span>
									<span
										class="w-24 shrink-0 truncate text-[11px] font-medium"
										style={{ color: typeColor(entry.type) }}
									>
										{typeLabel(entry.type)}
									</span>
									<Show when={entry.tool_name}>
										{(tn) => <span class="shrink-0 font-mono text-[11px] text-secondary">{tn()}</span>}
									</Show>
									<Show when={entry.content_preview}>
										{(cp) => <span class="flex-1 truncate text-muted">{cp()}</span>}
									</Show>
								</div>
							)}
						</For>
					</div>
				</Show>
			</div>
		</Show>
	);
};

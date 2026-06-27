import { createSignal, type Accessor } from "solid-js";

// ── Chart utilities ─────────────────────────────────────────────────

export interface BaseChartProps {
	readonly height?: number;
	readonly class?: string;
	readonly ariaLabel: string;
	readonly onClickPoint?: (datum: unknown, index: number) => void;
}

/**
 * Inline drag-brush contract (analytics-truth-and-brush, AC7/AC11).
 *
 * Time charts (StackedArea / LineChart / BarChart) opt in by accepting this
 * prop. On a drag across the plot rect the chart maps the pixel span back to
 * the covered calendar days and emits an inclusive `YYYY-MM-DD` window. The
 * page wires `onBrushSelect={(r) => setCustomRange({ from: r.start, to: r.end })}`
 * so every KPI/chart/table re-scopes to exactly that window.
 */
export type BrushRange = {
	readonly start: string;
	readonly end: string;
};

export interface BrushableChartProps {
	readonly onBrushSelect?: (range: BrushRange) => void;
}

// ── Categorical palette ────────────────────────────────────────────
//
// INSTRUMENT direction (locked): ONE accent — signal green — for the
// primary/live series; amber for warnings; danger red strictly for
// failures. Every other discrete series falls back to a muted graphite
// ramp so multi-series charts stay legible WITHOUT a rainbow.
//
// There is a SINGLE categorical token ramp (`CHART_CATEGORICAL`); every
// other chart palette here (the named CHART_COLORS aliases and per-model
// swatches) derives from it, so a given rank always maps to the same
// instrument tone on both paper (light) and instrument-black (dark) and no
// two categories collapse onto the same green. Inline SVG reads these as
// fill/stroke, so CSS vars are used directly.

/**
 * The one muted categorical token ramp. Index-stable: callers pass
 * sorted-by-magnitude series so a given rank always maps to the same
 * swatch. Overflow series collapse to {@link MODEL_OTHER}.
 */
export const CHART_CATEGORICAL = [
	"var(--clens-brand)", // signal green — primary/dominant series
	"var(--clens-text-secondary)", // graphite
	"var(--clens-warning)", // amber
	"var(--clens-text-muted)", // muted graphite
	"var(--clens-tick)", // faint tick
] as const;

/** Stable swatch for the Nth-ranked categorical series, from the one ramp. */
export const categoricalColor = (index: number): string =>
	CHART_CATEGORICAL[index % CHART_CATEGORICAL.length];

// Named aliases used by single-series charts and small fixed legends. All
// resolve onto the one CHART_CATEGORICAL ramp, so no two keys map to the same
// green (fixed-legend series like the decision-pattern stacked bar stay
// distinct) and the whole palette stays unified.
export const CHART_COLORS = {
	blue: CHART_CATEGORICAL[0], // signal green — primary trace
	violet: CHART_CATEGORICAL[1], // graphite
	amber: CHART_CATEGORICAL[2], // amber
	emerald: CHART_CATEGORICAL[3], // muted graphite (distinct from green)
	slate: CHART_CATEGORICAL[3], // muted graphite
	pink: CHART_CATEGORICAL[3], // muted graphite
} as const;

export const MODEL_OTHER = "var(--clens-text-muted)";

/**
 * Stable swatch for the Nth-ranked per-model series. Alias of
 * {@link categoricalColor} so model breakdowns share the one ramp.
 */
export const modelColor = categoricalColor;

// Distinct graphite/green/amber tones for stacked token series — kept
// separable without leaving the instrument palette.
export const TOKEN_COLORS = {
	input: "var(--clens-brand)",
	output: "var(--clens-text-secondary)",
	cache_read: "var(--clens-text-muted)",
	cache_create: "var(--clens-warning)",
} as const;

export const BACKTRACK_COLORS = {
	failure_retry: "var(--clens-danger)",
	iteration_struggle: "var(--clens-warning)",
	debugging_loop: "var(--clens-text-secondary)",
} as const;

export const REASONING_COLORS: Readonly<Record<string, string>> = {
	planning: "var(--clens-brand)",
	debugging: "var(--clens-danger)",
	research: "var(--clens-text-secondary)",
	deciding: "var(--clens-text-muted)",
	general: "var(--clens-tick)",
	unclassified: "var(--clens-tick)",
} as const;

export const DRIFT_COLORS = {
	good: "var(--clens-success)",
	warn: "var(--clens-warning)",
	bad: "var(--clens-danger)",
} as const;

// ── Scale helpers ──────────────────────────────────────────────────

export const linearScale = (
	domain: readonly [number, number],
	range: readonly [number, number],
) => {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0;
	return (value: number): number =>
		span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0);
};

// ── Continuous time x-scale (AC11) ─────────────────────────────────
//
// Date points were previously plotted by ARRAY INDEX, so a calendar gap (e.g.
// 3/28 → 5/18 with nothing between) compressed into one evenly-spaced step and
// read as "adjacent". A continuous time scale instead positions each point by
// its actual calendar day, so missing days render as proportional horizontal
// gaps. Charts share one accessor here so axes + brush agree exactly.

const MS_PER_DAY = 86_400_000;

/**
 * Parse a `YYYY-MM-DD` calendar date to an integer day-epoch (days since the
 * Unix epoch). UTC-anchored so the value is purely the calendar day with no
 * timezone drift — equal date strings always yield equal numbers. Returns NaN
 * for unparseable input so callers can guard.
 */
export const parseDay = (dateStr: string): number => {
	const [y, m, d] = dateStr.split("-").map((p) => parseInt(p, 10));
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
	return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
};

/** Inverse of {@link parseDay}: integer day-epoch → `YYYY-MM-DD`. */
export const dayToDate = (dayEpoch: number): string => {
	const date = new Date(Math.round(dayEpoch) * MS_PER_DAY);
	const y = date.getUTCFullYear();
	const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
	const d = `${date.getUTCDate()}`.padStart(2, "0");
	return `${y}-${m}-${d}`;
};

/**
 * Calendar-day domain `[minDayEpoch, maxDayEpoch]` covered by a set of
 * `YYYY-MM-DD` strings. Unparseable dates are ignored. Returns undefined when
 * no usable date exists so callers can fall back (e.g. single-point centering).
 */
export const dateDomain = (
	dates: readonly string[],
): readonly [number, number] | undefined => {
	const days = dates.map(parseDay).filter((n) => Number.isFinite(n));
	if (days.length === 0) return undefined;
	return [Math.min(...days), Math.max(...days)];
};

/**
 * Continuous time x-scale. Maps a `YYYY-MM-DD` string to an x pixel by ACTUAL
 * calendar time across [r0, r1]. A zero-width domain (single distinct day, or
 * all points on the same date) centres the reading in the plot — matching the
 * existing single-point convention in the line/area charts rather than pinning
 * it to the left axis. Out-of-domain dates are positioned proportionally (the
 * caller is responsible for clamping if needed).
 */
export const timeScale = (
	domain: readonly [number, number],
	range: readonly [number, number],
) => {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const span = d1 - d0;
	const mid = r0 + (r1 - r0) / 2;
	return (dateStr: string): number => {
		const day = parseDay(dateStr);
		if (!Number.isFinite(day) || span === 0) return mid;
		return r0 + ((day - d0) / span) * (r1 - r0);
	};
};

/**
 * Inverse of {@link timeScale}: map a pixel x back to the covered calendar day,
 * clamped to the domain, returned as `YYYY-MM-DD`. Used by the drag-brush to
 * resolve a pixel span into inclusive dates. A zero-width domain resolves every
 * pixel to that single day.
 */
export const pixelToDate = (
	px: number,
	domain: readonly [number, number],
	range: readonly [number, number],
): string => {
	const [d0, d1] = domain;
	const [r0, r1] = range;
	const pxSpan = r1 - r0;
	if (pxSpan === 0 || d1 === d0) return dayToDate(d0);
	const frac = Math.min(1, Math.max(0, (px - r0) / pxSpan));
	const day = Math.round(d0 + frac * (d1 - d0));
	return dayToDate(day);
};

export const niceMax = (max: number): number => {
	if (max <= 0) return 1;
	const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
	const normalized = max / magnitude;
	const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	return nice * magnitude;
};

export const generateTicks = (max: number, count: number = 5): readonly number[] => {
	const nMax = niceMax(max);
	const step = nMax / count;
	return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step));
};

// ── Formatting ─────────────────────────────────────────────────────

export const formatCompact = (n: number): string => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n < 10 ? n.toFixed(1) : String(Math.round(n));
};

export const formatShortDate = (dateStr: string): string => {
	const [, month, day] = dateStr.split("-");
	return `${parseInt(month, 10)}/${parseInt(day, 10)}`;
};

// ── SVG padding ────────────────────────────────────────────────────

export const CHART_PADDING = {
	top: 16,
	right: 16,
	bottom: 32,
	left: 52,
} as const;

export type ChartPadding = typeof CHART_PADDING;

// ── Instrument trace tokens (inline SVG) ────────────────────────────

/** Hairline graticule / axis rule color. */
export const CHART_HAIRLINE = "var(--clens-hairline)";
/** Trace/series fallback when none supplied. */
export const CHART_TRACE = "var(--clens-brand)";
/** Surface a point/line is stroked against (instrument black/paper). */
export const CHART_SURFACE = "var(--clens-surface-overlay)";

/**
 * Cap a single/sparse-series band so one datapoint does not fill the whole
 * plot. Bars/columns are clamped to this max so a lone bar reads as a tick,
 * not a wall.
 */
export const MAX_BAND = 56;

// ── Drag-brush overlay (AC7) ───────────────────────────────────────
//
// Shared so StackedArea / LineChart / BarChart get identical brush behavior.
// The PURE half (band geometry + selection resolution) lives as plain
// functions so it is unit-testable without Solid; the REACTIVE half
// (`createBrush`) wires pointer events and exposes the live band signal.

/** Live selection band geometry in plot-local coordinates. */
export type BrushBand = {
	readonly x: number;
	readonly width: number;
};

/** Translucent fill for the in-progress selection band. */
export const BRUSH_FILL = "var(--clens-brand)";

/**
 * Pure: the selection rect for a drag between two pixel x positions, clamped
 * to the plot range [r0, r1]. Works regardless of drag direction (a
 * right-to-left drag yields the same band). `x` is the left edge.
 */
export const brushBand = (
	downX: number,
	moveX: number,
	range: readonly [number, number],
): BrushBand => {
	const [r0, r1] = range;
	const lo = Math.max(r0, Math.min(downX, moveX));
	const hi = Math.min(r1, Math.max(downX, moveX));
	return { x: lo, width: Math.max(0, hi - lo) };
};

/** Smallest drag (px) that counts as a brush rather than a click. */
export const BRUSH_MIN_PX = 4;

/**
 * Pure: resolve a pixel drag span into an inclusive `{ start, end }` date
 * window over the supplied date strings. Returns undefined when the drag is too
 * small (a click, not a brush) or no usable date domain exists — the caller
 * should then leave the existing window untouched. Direction-agnostic.
 */
export const resolveBrushSelection = (
	downX: number,
	upX: number,
	dates: readonly string[],
	range: readonly [number, number],
): BrushRange | undefined => {
	if (Math.abs(upX - downX) < BRUSH_MIN_PX) return undefined;
	const domain = dateDomain(dates);
	if (!domain) return undefined;
	const lo = Math.min(downX, upX);
	const hi = Math.max(downX, upX);
	const start = pixelToDate(lo, domain, range);
	const end = pixelToDate(hi, domain, range);
	return start <= end ? { start, end } : { start: end, end: start };
};

/** Inputs the reactive brush needs from its host chart. */
export interface CreateBrushArgs {
	/** Inclusive date strings currently plotted (drive the resolved window). */
	readonly dates: Accessor<readonly string[]>;
	/** Plot-local x range [0, chartWidth]. */
	readonly range: Accessor<readonly [number, number]>;
	/** Emit the resolved inclusive window on a completed drag. */
	readonly onSelect: ((range: BrushRange) => void) | undefined;
}

/**
 * Reactive drag-brush controller for an SVG plot. Attach the returned handlers
 * to a full-plot transparent <rect> and render the band <rect> when `band()`
 * is set. Pointer x is taken relative to the overlay rect, then shifted into
 * plot-local space by the chart's left padding via the rect's own bbox — the
 * overlay rect is expected to sit inside the padded <g>, so its client x is the
 * plot origin. mousedown→move tracks; mouseup resolves and clears.
 *
 *   const brush = createBrush({ dates, range, onSelect: props.onBrushSelect });
 *   <rect ... onMouseDown={brush.onMouseDown}
 *             onMouseMove={brush.onMouseMove}
 *             onMouseUp={brush.onMouseUp}
 *             onMouseLeave={brush.onMouseLeave} />
 *   <Show when={brush.band()}>{(b) => <rect x={b().x} width={b().width} ... />}</Show>
 */
export const createBrush = (args: CreateBrushArgs) => {
	const [origin, setOrigin] = createSignal<number | undefined>();
	const [band, setBand] = createSignal<BrushBand | undefined>();

	// Pointer x in plot-local coordinates: clientX minus the overlay's own left
	// edge (the overlay rect spans exactly the plot, so its left is x=0).
	const localX = (e: MouseEvent): number => {
		const rect = (e.currentTarget as SVGGraphicsElement | null)?.getBoundingClientRect();
		return rect ? e.clientX - rect.left : 0;
	};

	const enabled = (): boolean => args.onSelect !== undefined;

	const onMouseDown = (e: MouseEvent): void => {
		if (!enabled()) return;
		e.preventDefault();
		setOrigin(localX(e));
		setBand(undefined);
	};

	const onMouseMove = (e: MouseEvent): void => {
		const start = origin();
		if (start === undefined) return;
		setBand(brushBand(start, localX(e), args.range()));
	};

	const finish = (e: MouseEvent): void => {
		const start = origin();
		setOrigin(undefined);
		setBand(undefined);
		if (start === undefined) return;
		const selection = resolveBrushSelection(start, localX(e), args.dates(), args.range());
		if (selection) args.onSelect?.(selection);
	};

	const onMouseUp = (e: MouseEvent): void => {
		if (origin() === undefined) return;
		finish(e);
	};

	// Releasing outside the plot still completes the drag with whatever span was
	// reached, so a brush dragged off the right edge selects to the last day.
	const onMouseLeave = (e: MouseEvent): void => {
		if (origin() === undefined) return;
		finish(e);
	};

	return {
		band: band as Accessor<BrushBand | undefined>,
		active: (): boolean => origin() !== undefined,
		enabled,
		onMouseDown,
		onMouseMove,
		onMouseUp,
		onMouseLeave,
	} as const;
};

// ── Chart utilities ─────────────────────────────────────────────────

export interface BaseChartProps {
	readonly height?: number;
	readonly class?: string;
	readonly ariaLabel: string;
	readonly onClickPoint?: (datum: unknown, index: number) => void;
}

// ── Color palette ──────────────────────────────────────────────────
//
// INSTRUMENT direction: traces derive from the token palette so light
// (paper/graphite) and dark (instrument-black/phosphor) modes both work.
// Signal green is reserved for primary/live series; amber for secondary
// warnings; danger red strictly for failures. Remaining series fall back
// to a muted graphite ramp so multi-series charts stay legible without a
// rainbow. Inline SVG reads these as fill/stroke, so CSS vars are used
// directly.

export const CHART_COLORS = {
	// Primary signal trace
	blue: "var(--clens-brand)",
	// Secondary graphite traces
	violet: "var(--clens-text-secondary)",
	emerald: "var(--clens-brand)",
	slate: "var(--clens-text-muted)",
	gray: "var(--clens-tick)",
	// Status traces
	amber: "var(--clens-warning)",
	orange: "var(--clens-warning)",
	red: "var(--clens-danger)",
	pink: "var(--clens-text-muted)",
} as const;

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

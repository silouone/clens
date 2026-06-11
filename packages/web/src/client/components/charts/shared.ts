// ── Chart utilities ─────────────────────────────────────────────────

export interface BaseChartProps {
	readonly height?: number;
	readonly class?: string;
	readonly ariaLabel: string;
	readonly onClickPoint?: (datum: unknown, index: number) => void;
}

// ── Color palette ──────────────────────────────────────────────────

export const CHART_COLORS = {
	blue: "#3B82F6",
	violet: "#8B5CF6",
	emerald: "#10B981",
	amber: "#F59E0B",
	pink: "#EC4899",
	red: "#EF4444",
	orange: "#F97316",
	gray: "#6B7280",
	slate: "#94A3B8",
} as const;

export const TOKEN_COLORS = {
	input: CHART_COLORS.blue,
	output: CHART_COLORS.violet,
	cache_read: CHART_COLORS.emerald,
	cache_create: CHART_COLORS.amber,
} as const;

export const BACKTRACK_COLORS = {
	failure_retry: CHART_COLORS.red,
	iteration_struggle: CHART_COLORS.amber,
	debugging_loop: CHART_COLORS.orange,
} as const;

export const REASONING_COLORS: Readonly<Record<string, string>> = {
	planning: CHART_COLORS.blue,
	debugging: CHART_COLORS.red,
	research: CHART_COLORS.emerald,
	deciding: CHART_COLORS.violet,
	general: CHART_COLORS.gray,
	unclassified: CHART_COLORS.slate,
} as const;

export const DRIFT_COLORS = {
	good: CHART_COLORS.emerald,
	warn: CHART_COLORS.amber,
	bad: CHART_COLORS.red,
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

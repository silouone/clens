import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import type { BaseChartProps, BrushableChartProps } from "./shared";
import {
	BRUSH_FILL,
	CHART_COLORS,
	CHART_HAIRLINE,
	CHART_PADDING,
	MAX_BAND,
	createBrush,
	dateDomain,
	formatCompact,
	formatShortDate,
	generateTicks,
	linearScale,
	niceMax,
	timeScale,
} from "./shared";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import { ChartEmpty } from "./ChartEmpty";

interface BarChartProps<T> extends BaseChartProps, BrushableChartProps {
	readonly data: readonly T[];
	readonly x: (d: T) => string;
	readonly y: (d: T) => number;
	readonly color?: string;
	readonly tooltipLabel?: (d: T) => string;
}

export const BarChart = <T,>(props: BarChartProps<T>): ReturnType<Component> => {
	const [width, setWidth] = createSignal(400);
	let containerRef: HTMLDivElement | undefined;

	onMount(() => {
		if (!containerRef) return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(containerRef);
		onCleanup(() => observer.disconnect());
	});

	const chartWidth = () => width() - CHART_PADDING.left - CHART_PADDING.right;
	const chartHeight = () => (props.height ?? 200) - CHART_PADDING.top - CHART_PADDING.bottom;
	const color = () => props.color ?? CHART_COLORS.blue;

	const maxY = createMemo(() => niceMax(props.data.reduce((m, d) => Math.max(m, props.y(d)), 0)));
	const ticks = createMemo(() => generateTicks(maxY()));
	const yScale = createMemo(() => linearScale([0, maxY()], [chartHeight(), 0]));

	// Continuous time x-scale (AC11): bars are centred on their actual calendar
	// day, so a gap between dates renders as a horizontal gap rather than a
	// compressed evenly-spaced step. A single distinct day (or no usable date)
	// falls back to the plot centre, matching the line/area single-point rule.
	const dates = createMemo(() => props.data.map(props.x));
	const domain = createMemo(() => dateDomain(dates()));
	const xScale = createMemo(() => {
		const dom = domain();
		return dom ? timeScale(dom, [0, chartWidth()]) : () => chartWidth() / 2;
	});

	// Bar width derives from the smallest spacing between adjacent centres so
	// bars never overlap on dense windows, while a lone/sparse bar is capped to
	// MAX_BAND so one datapoint reads as a tick, not a wall.
	const barWidth = createMemo(() => {
		const n = props.data.length;
		if (n === 0) return 0;
		const scale = xScale();
		const centers = dates()
			.map((dateStr) => scale(dateStr))
			.sort((a, b) => a - b);
		const minGap = centers.reduce<number>((m, c, i) => (i === 0 ? m : Math.min(m, c - centers[i - 1])), Number.POSITIVE_INFINITY);
		const spacing = Number.isFinite(minGap) && minGap > 0 ? minGap : chartWidth();
		return Math.max(2, Math.min(MAX_BAND, spacing * 0.8));
	});

	const brush = createBrush({
		dates,
		range: () => [0, chartWidth()],
		onSelect: props.onBrushSelect,
	});

	return (
		<Show
			when={props.data.length > 0}
			fallback={<ChartEmpty height={props.height} class={props.class} ariaLabel={props.ariaLabel} label="No data" />}
		>
			<div ref={containerRef} class={`w-full ${props.class ?? ""}`}>
				<svg
					width={width()}
					height={props.height ?? 200}
					role="img"
					aria-label={props.ariaLabel}
					class="overflow-visible"
				>
				<g transform={`translate(${CHART_PADDING.left},${CHART_PADDING.top})`}>
					{/* Y-axis grid lines + labels */}
					<For each={ticks()}>
						{(tick) => (
							<>
								<line
									x1={0} y1={yScale()(tick)}
									x2={chartWidth()} y2={yScale()(tick)}
									stroke={CHART_HAIRLINE}
									stroke-opacity={tick === 0 ? 1 : 0.55}
								/>
								<text
									x={-8} y={yScale()(tick)}
									text-anchor="end" dominant-baseline="middle"
									class="fill-muted font-mono text-[10px] tabular-nums"
								>
									{formatCompact(tick)}
								</text>
							</>
						)}
					</For>

					{/* Drag-brush capture surface (behind bars so bars stay clickable). */}
					<rect
						x={0} y={0}
						width={chartWidth()} height={chartHeight()}
						fill="transparent"
						class={brush.enabled() ? "cursor-crosshair" : undefined}
						onMouseDown={brush.onMouseDown}
						onMouseMove={brush.onMouseMove}
						onMouseUp={brush.onMouseUp}
						onMouseLeave={brush.onMouseLeave}
					/>

					{/* Bars */}
					<For each={props.data}>
						{(d, i) => {
							const val = props.y(d);
							const h = chartHeight() - yScale()(val);
							const w = barWidth();
							return (
								<rect
									x={xScale()(props.x(d)) - w / 2}
									y={yScale()(val)}
									width={w}
									height={Math.max(0, h)}
									fill={color()}
									rx={0}
									class="cursor-pointer transition-opacity hover:opacity-80"
									onClick={(e) => {
										e.stopPropagation();
										props.onClickPoint?.(d, i());
									}}
									onMouseEnter={(e) => {
										const rect = (e.target as SVGRectElement).getBoundingClientRect();
										const label = props.tooltipLabel?.(d) ?? `${props.x(d)}: ${formatCompact(val)}`;
										showTooltip(rect.x + rect.width / 2, rect.y, label);
									}}
									onMouseLeave={hideTooltip}
								/>
							);
						}}
					</For>

					{/* Live brush band (never blocks pointer events). */}
					<Show when={brush.band()}>
						{(b) => (
							<rect
								x={b().x} width={b().width}
								y={0} height={chartHeight()}
								fill={BRUSH_FILL}
								fill-opacity={0.15}
								pointer-events="none"
							/>
						)}
					</Show>

					{/* X-axis labels (show subset to avoid crowding) */}
					<For each={props.data}>
						{(d, i) => {
							const n = props.data.length;
							const step = Math.max(1, Math.floor(n / 8));
							if (i() % step !== 0 && i() !== n - 1) return null;
							return (
								<text
									x={xScale()(props.x(d))}
									y={chartHeight() + 16}
									text-anchor="middle"
									class="fill-muted font-mono text-[10px] tabular-nums"
								>
									{formatShortDate(props.x(d))}
								</text>
							);
						}}
					</For>
				</g>
				</svg>
			</div>
		</Show>
	);
};

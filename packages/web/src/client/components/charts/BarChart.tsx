import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import type { BaseChartProps } from "./shared";
import { CHART_COLORS, CHART_HAIRLINE, CHART_PADDING, MAX_BAND, formatCompact, formatShortDate, generateTicks, linearScale, niceMax } from "./shared";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import { ChartEmpty } from "./ChartEmpty";

interface BarChartProps<T> extends BaseChartProps {
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

	const slot = createMemo(() => {
		const n = props.data.length;
		if (n === 0) return 0;
		const available = chartWidth();
		const gap = Math.max(2, available / n * 0.2);
		return (available - gap * (n - 1)) / n + gap;
	});

	// Cap a single/sparse bar so one datapoint reads as a tick, not a wall.
	const barWidth = createMemo(() => {
		const n = props.data.length;
		if (n === 0) return 0;
		const available = chartWidth();
		const gap = Math.max(2, available / n * 0.2);
		return Math.max(2, Math.min(MAX_BAND, (available - gap * (n - 1)) / n));
	});

	const barX = (i: number) => {
		const n = props.data.length;
		if (n === 0) return 0;
		return i * slot() + (slot() - barWidth()) / 2;
	};

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

					{/* Bars */}
					<For each={props.data}>
						{(d, i) => {
							const val = props.y(d);
							const h = chartHeight() - yScale()(val);
							return (
								<rect
									x={barX(i())}
									y={yScale()(val)}
									width={barWidth()}
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

					{/* X-axis labels (show subset to avoid crowding) */}
					<For each={props.data}>
						{(d, i) => {
							const n = props.data.length;
							const step = Math.max(1, Math.floor(n / 8));
							if (i() % step !== 0 && i() !== n - 1) return null;
							return (
								<text
									x={barX(i()) + barWidth() / 2}
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

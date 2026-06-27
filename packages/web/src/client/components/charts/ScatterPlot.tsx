import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import type { BaseChartProps } from "./shared";
import { CHART_HAIRLINE, CHART_PADDING, CHART_SURFACE, DRIFT_COLORS, formatCompact, formatShortDate, generateTicks, linearScale, niceMax } from "./shared";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import { ChartEmpty } from "./ChartEmpty";

interface ScatterPlotProps<T> extends BaseChartProps {
	readonly data: readonly T[];
	readonly x: (d: T) => string; // date string
	readonly y: (d: T) => number;
	readonly size?: (d: T) => number;
	readonly colorFn?: (d: T) => string;
	readonly tooltipLabel?: (d: T) => string;
	readonly formatY?: (v: number) => string;
}

export const ScatterPlot = <T,>(props: ScatterPlotProps<T>): ReturnType<Component> => {
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

	const cw = () => width() - CHART_PADDING.left - CHART_PADDING.right;
	const ch = () => (props.height ?? 200) - CHART_PADDING.top - CHART_PADDING.bottom;

	// Sort data by x date for positioning
	const sorted = createMemo(() => [...props.data].sort((a, b) => props.x(a).localeCompare(props.x(b))));

	// Build date index for x positioning
	const dates = createMemo(() => [...new Set(sorted().map((d) => props.x(d)))].sort());
	const xScale = createMemo(() => {
		const d = dates();
		if (d.length <= 1) return (_: string) => cw() / 2;
		const step = cw() / (d.length - 1);
		const indexMap = new Map(d.map((date, i) => [date, i]));
		return (date: string) => (indexMap.get(date) ?? 0) * step;
	});

	const maxY = createMemo(() => niceMax(props.data.reduce((m, d) => Math.max(m, props.y(d)), 0)));
	const ticks = createMemo(() => generateTicks(maxY(), 4));
	const yScale = createMemo(() => linearScale([0, maxY()], [ch(), 0]));

	const fmtY = () => props.formatY ?? formatCompact;

	const defaultColor = (d: T) => {
		const v = props.y(d);
		if (v < 0.2) return DRIFT_COLORS.good;
		if (v < 0.5) return DRIFT_COLORS.warn;
		return DRIFT_COLORS.bad;
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
					<For each={ticks()}>
						{(tick) => (
							<>
								<line
									x1={0} y1={yScale()(tick)}
									x2={cw()} y2={yScale()(tick)}
									stroke={CHART_HAIRLINE}
									stroke-opacity={tick === 0 ? 1 : 0.55}
								/>
								<text
									x={-8} y={yScale()(tick)}
									text-anchor="end" dominant-baseline="middle"
									class="fill-muted font-mono text-[10px] tabular-nums"
								>
									{fmtY()(tick)}
								</text>
							</>
						)}
					</For>

					<For each={sorted()}>
						{(d, i) => {
							const px = () => xScale()(props.x(d));
							const py = () => yScale()(props.y(d));
							const r = () => props.size?.(d) ?? 5;
							const fill = () => (props.colorFn ?? defaultColor)(d);

							return (
								<circle
									cx={px()} cy={py()}
									r={Math.max(3, Math.min(12, r()))}
									fill={fill()}
									fill-opacity="0.8"
									stroke={fill()}
									stroke-width="1"
									stroke-opacity="0.4"
									class="cursor-pointer transition-all hover:fill-opacity-100"
									onClick={(e) => {
										e.stopPropagation();
										props.onClickPoint?.(d, i());
									}}
									onMouseEnter={(e) => {
										const rect = (e.target as SVGCircleElement).getBoundingClientRect();
										const label = props.tooltipLabel?.(d) ??
											`${props.x(d)}: ${fmtY()(props.y(d))}`;
										showTooltip(rect.x + rect.width / 2, rect.y, label);
									}}
									onMouseLeave={hideTooltip}
								/>
							);
						}}
					</For>

					{/* X-axis labels */}
					{(() => {
						const d = dates();
						const step = Math.max(1, Math.floor(d.length / 6));
						return (
							<For each={d}>
								{(date, i) => {
									if (i() % step !== 0 && i() !== d.length - 1) return null;
									return (
										<text
											x={xScale()(date)}
											y={ch() + 16}
											text-anchor="middle"
											class="fill-muted font-mono text-[10px] tabular-nums"
										>
											{formatShortDate(date)}
										</text>
									);
								}}
							</For>
						);
					})()}
				</g>
			</svg>

			{/* Legend for drift colors */}
			<div class="mt-2 flex gap-3 px-2 text-xs text-muted">
				<div class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ "background-color": DRIFT_COLORS.good }} />
					<span class="instrument-microcaps text-[10px] text-muted">Low (&lt;0.2)</span>
				</div>
				<div class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ "background-color": DRIFT_COLORS.warn }} />
					<span class="instrument-microcaps text-[10px] text-muted">Medium (0.2-0.5)</span>
				</div>
				<div class="flex items-center gap-1">
					<span class="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ "background-color": DRIFT_COLORS.bad }} />
					<span class="instrument-microcaps text-[10px] text-muted">High (&gt;0.5)</span>
				</div>
				</div>
			</div>
		</Show>
	);
};

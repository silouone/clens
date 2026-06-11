import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import type { BaseChartProps } from "./shared";
import { CHART_HAIRLINE, CHART_PADDING, formatCompact, formatShortDate, generateTicks, linearScale, niceMax } from "./shared";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import { ChartEmpty } from "./ChartEmpty";

interface SeriesConfig {
	readonly key: string;
	readonly label: string;
	readonly color: string;
}

interface StackedAreaProps<T> extends BaseChartProps {
	readonly data: readonly T[];
	readonly x: (d: T) => string;
	readonly series: readonly SeriesConfig[];
	readonly getValue: (d: T, key: string) => number;
	readonly tooltipLabel?: (d: T) => string;
}

export const StackedArea = <T,>(props: StackedAreaProps<T>): ReturnType<Component> => {
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
	const xStep = createMemo(() => (props.data.length <= 1 ? cw() : cw() / (props.data.length - 1)));

	// Compute stacked values
	const stacked = createMemo(() =>
		props.data.map((d) => {
			const values = props.series.map((s) => props.getValue(d, s.key));
			const cumulative = values.reduce<readonly number[]>(
				(acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v],
				[],
			);
			return { values, cumulative, total: cumulative[cumulative.length - 1] ?? 0 };
		}),
	);

	const maxY = createMemo(() => niceMax(stacked().reduce((m, s) => Math.max(m, s.total), 0)));
	const ticks = createMemo(() => generateTicks(maxY()));
	const yScale = createMemo(() => linearScale([0, maxY()], [ch(), 0]));

	// Build area paths (top-to-bottom so the last series is at the bottom)
	const areaPaths = createMemo(() => {
		const data = props.data;
		const stackedData = stacked();
		if (data.length === 0) return [];

		return props.series.map((series, si) =>
			({
				...series,
				d: (() => {
					// Top line: cumulative[si]
					const topLine = data.map((_, i) => {
						const px = i * xStep();
						const py = yScale()(stackedData[i].cumulative[si]);
						return `${i === 0 ? "M" : "L"}${px},${py}`;
					}).join(" ");

					// Bottom line: cumulative[si-1] or 0, reversed
					const bottomLine = [...data].map((_, idx) => {
						const i = data.length - 1 - idx;
						const px = i * xStep();
						const base = si > 0 ? stackedData[i].cumulative[si - 1] : 0;
						const py = yScale()(base);
						return `L${px},${py}`;
					}).join(" ");

					return `${topLine} ${bottomLine} Z`;
				})(),
			}),
		);
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
					<For each={ticks()}>
						{(tick) => (
							<>
								<line
									x1={0} y1={yScale()(tick)}
									x2={cw()} y2={yScale()(tick)}
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

					{/* Stacked areas (render in reverse so first series is on top) */}
					<For each={[...areaPaths()].reverse()}>
						{(area) => (
							<path d={area.d} fill={area.color} fill-opacity="0.6" />
						)}
					</For>

					{/* Hover columns */}
					<For each={props.data}>
						{(d, i) => (
							<rect
								x={i() * xStep() - xStep() / 2}
								y={0}
								width={xStep()}
								height={ch()}
								fill="transparent"
								class="cursor-pointer"
								onClick={(e) => {
									e.stopPropagation();
									props.onClickPoint?.(d, i());
								}}
								onMouseEnter={(e) => {
									const rect = (e.target as SVGRectElement).getBoundingClientRect();
									const label = props.tooltipLabel?.(d) ??
										`${props.x(d)}: ${formatCompact(stacked()[i()].total)}`;
									showTooltip(rect.x + rect.width / 2, rect.y, label);
								}}
								onMouseLeave={hideTooltip}
							/>
						)}
					</For>

					{/* X-axis labels */}
					<For each={props.data}>
						{(d, i) => {
							const n = props.data.length;
							const step = Math.max(1, Math.floor(n / 8));
							if (i() % step !== 0 && i() !== n - 1) return null;
							return (
								<text
									x={i() * xStep()}
									y={ch() + 16}
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

			{/* Legend */}
			<div class="mt-2 flex flex-wrap gap-3 px-2 text-xs text-muted">
				<For each={props.series}>
					{(s) => (
						<div class="flex items-center gap-1">
							<span class="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ "background-color": s.color }} />
							<span>{s.label}</span>
						</div>
					)}
				</For>
			</div>
			</div>
		</Show>
	);
};

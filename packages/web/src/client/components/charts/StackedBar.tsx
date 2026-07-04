import { type Component, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ChartEmpty } from "./ChartEmpty";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import type { BaseChartProps } from "./shared";
import {
	CHART_HAIRLINE,
	CHART_PADDING,
	formatCompact,
	formatShortDate,
	generateTicks,
	linearScale,
	MAX_BAND,
	niceMax,
} from "./shared";

interface SeriesConfig {
	readonly key: string;
	readonly label: string;
	readonly color: string;
}

interface StackedBarProps<T> extends BaseChartProps {
	readonly data: readonly T[];
	readonly x: (d: T) => string;
	readonly series: readonly SeriesConfig[];
	readonly getValue: (d: T, key: string) => number;
	readonly tooltipLabel?: (d: T) => string;
}

export const StackedBar = <T,>(props: StackedBarProps<T>): ReturnType<Component> => {
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

	const slot = createMemo(() => {
		const n = props.data.length;
		if (n === 0) return 0;
		const gap = Math.max(2, (cw() / n) * 0.2);
		return (cw() - gap * (n - 1)) / n + gap;
	});

	// Cap a single/sparse column so one datapoint reads as a tick, not a wall.
	const barWidth = createMemo(() => {
		const n = props.data.length;
		if (n === 0) return 0;
		const gap = Math.max(2, (cw() / n) * 0.2);
		return Math.max(2, Math.min(MAX_BAND, (cw() - gap * (n - 1)) / n));
	});

	const barX = (i: number) => {
		const n = props.data.length;
		if (n === 0) return 0;
		return i * slot() + (slot() - barWidth()) / 2;
	};

	return (
		<Show
			when={props.data.length > 0}
			fallback={
				<ChartEmpty
					height={props.height}
					class={props.class}
					ariaLabel={props.ariaLabel}
					label="No data"
				/>
			}
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
										x1={0}
										y1={yScale()(tick)}
										x2={cw()}
										y2={yScale()(tick)}
										stroke={CHART_HAIRLINE}
									/>
									<text
										x={-8}
										y={yScale()(tick)}
										text-anchor="end"
										dominant-baseline="middle"
										class="fill-muted font-mono text-[10px] tabular-nums"
									>
										{formatCompact(tick)}
									</text>
								</>
							)}
						</For>

						<For each={props.data}>
							{(d, i) => {
								const st = () => stacked()[i()];
								return (
									<g
										role="menuitem"
										aria-label={
											props.tooltipLabel?.(d) ?? `${props.x(d)}: ${formatCompact(st().total)}`
										}
										class="cursor-pointer"
										onClick={(e) => {
											e.stopPropagation();
											props.onClickPoint?.(d, i());
										}}
										onMouseEnter={(e) => {
											const rect = (e.currentTarget as SVGGElement).getBoundingClientRect();
											const label =
												props.tooltipLabel?.(d) ?? `${props.x(d)}: ${formatCompact(st().total)}`;
											showTooltip(rect.x + rect.width / 2, rect.y, label);
										}}
										onMouseLeave={hideTooltip}
									>
										<For each={props.series}>
											{(series, si) => {
												const top = () => st().cumulative[si()];
												const base = () => (si() > 0 ? st().cumulative[si() - 1] : 0);
												const h = () => yScale()(base()) - yScale()(top());
												return (
													<rect
														x={barX(i())}
														y={yScale()(top())}
														width={barWidth()}
														height={Math.max(0, h())}
														fill={series.color}
														rx={0}
													/>
												);
											}}
										</For>
									</g>
								);
							}}
						</For>

						<For each={props.data}>
							{(d, i) => {
								const n = props.data.length;
								const step = Math.max(1, Math.floor(n / 8));
								if (i() % step !== 0 && i() !== n - 1) return null;
								return (
									<text
										x={barX(i()) + barWidth() / 2}
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

				<div class="mt-2 flex flex-wrap gap-3 px-2 text-xs text-muted">
					<For each={props.series}>
						{(s) => (
							<div class="flex items-center gap-1">
								<span
									class="inline-block h-2.5 w-2.5 rounded-[2px]"
									style={{ "background-color": s.color }}
								/>
								<span class="instrument-microcaps text-[10px] text-muted">{s.label}</span>
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
};

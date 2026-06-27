import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import type { BaseChartProps, BrushableChartProps } from "./shared";
import {
	BRUSH_FILL,
	BRUSH_MIN_PX,
	CHART_HAIRLINE,
	CHART_PADDING,
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

interface SeriesConfig {
	readonly key: string;
	readonly label: string;
	readonly color: string;
}

interface StackedAreaProps<T> extends BaseChartProps, BrushableChartProps {
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

	// Continuous time x-scale (AC11): position each point by its actual calendar
	// day so gaps render as proportional horizontal gaps, not compressed evenly
	// spaced steps. A single distinct day (zero-width domain) centres in the plot.
	const dates = createMemo<readonly string[]>(() => props.data.map((d) => props.x(d)));
	const domain = createMemo(() => dateDomain(dates()));
	const xScale = createMemo(() => {
		const dom = domain();
		const center = cw() / 2;
		return dom ? timeScale(dom, [0, cw()]) : () => center;
	});
	const pointX = (d: T) => xScale()(props.x(d));

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
					const topLine = data.map((d, i) => {
						const px = pointX(d);
						const py = yScale()(stackedData[i].cumulative[si]);
						return `${i === 0 ? "M" : "L"}${px},${py}`;
					}).join(" ");

					// Bottom line: cumulative[si-1] or 0, reversed
					const bottomLine = [...data].map((_, idx) => {
						const i = data.length - 1 - idx;
						const px = pointX(data[i]);
						const base = si > 0 ? stackedData[i].cumulative[si - 1] : 0;
						const py = yScale()(base);
						return `L${px},${py}`;
					}).join(" ");

					return `${topLine} ${bottomLine} Z`;
				})(),
			}),
		);
	});

	// Nearest-point hit-test by plot-local x. Hover/click and the brush share the
	// one full-plot overlay rect (so the brush keeps its plot-origin left edge),
	// so per-point tooltips resolve the closest calendar point to the cursor
	// rather than relying on tiled hit columns.
	const nearestIndex = (localX: number): number =>
		props.data.reduce(
			(best, d, i) =>
				Math.abs(pointX(d) - localX) < Math.abs(pointX(props.data[best]) - localX) ? i : best,
			0,
		);

	const overlayLocalX = (e: MouseEvent): number => {
		const rect = (e.currentTarget as SVGGraphicsElement | null)?.getBoundingClientRect();
		return rect ? e.clientX - rect.left : 0;
	};

	const showPointTooltip = (e: MouseEvent): void => {
		if (props.data.length === 0) return;
		const i = nearestIndex(overlayLocalX(e));
		const d = props.data[i];
		const label = props.tooltipLabel?.(d) ?? `${props.x(d)}: ${formatCompact(stacked()[i].total)}`;
		showTooltip(e.clientX, e.clientY - 8, label);
	};

	// Inline drag-brush (AC7): a no-op when onBrushSelect is undefined so the
	// overlay rect can render unconditionally.
	const brush = createBrush({
		dates,
		range: () => [0, cw()] as const,
		onSelect: props.onBrushSelect,
	});

	// Compose brush pointer handlers with hover-tooltip / click on the shared
	// overlay: the brush owns drag (mousedown→move→up); hover drives tooltips when
	// not dragging; a press that moves less than the brush threshold is a click, so
	// point navigation still works whether or not brushing is enabled.
	const [downX, setDownX] = createSignal<number | undefined>();

	const onOverlayDown = (e: MouseEvent): void => {
		setDownX(overlayLocalX(e));
		brush.onMouseDown(e);
	};

	const onOverlayMove = (e: MouseEvent): void => {
		brush.onMouseMove(e);
		if (!brush.active()) showPointTooltip(e);
	};

	const onOverlayUp = (e: MouseEvent): void => {
		const start = downX();
		setDownX(undefined);
		brush.onMouseUp(e);
		const isClick = start === undefined || Math.abs(overlayLocalX(e) - start) < BRUSH_MIN_PX;
		if (isClick && props.data.length > 0) {
			const i = nearestIndex(overlayLocalX(e));
			props.onClickPoint?.(props.data[i], i);
		}
	};

	const onOverlayLeave = (e: MouseEvent): void => {
		setDownX(undefined);
		brush.onMouseLeave(e);
		hideTooltip();
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

					{/* A single data point degenerates the area path to zero width —
					    render visible square markers per series instead (one per
					    cumulative level), matching the line charts' point markers */}
					<Show when={props.data.length === 1}>
						<For each={props.series}>
							{(series, si) => (
								<rect
									x={cw() / 2 - 3}
									y={yScale()(stacked()[0].cumulative[si()]) - 3}
									width={6}
									height={6}
									fill={series.color}
								/>
							)}
						</For>
					</Show>

					{/* X-axis labels */}
					<For each={props.data}>
						{(d, i) => {
							const n = props.data.length;
							const step = Math.max(1, Math.floor(n / 8));
							if (i() % step !== 0 && i() !== n - 1) return null;
							return (
								<text
									x={pointX(d)}
									y={ch() + 16}
									text-anchor="middle"
									class="fill-muted font-mono text-[10px] tabular-nums"
								>
									{formatShortDate(props.x(d))}
								</text>
							);
						}}
					</For>

					{/* Drag-brush + hover overlay: one full-plot transparent rect is the
					    single interaction surface. The brush owns drag (mousedown→up);
					    hover drives nearest-point tooltips; a non-drag mouseup is a click.
					    Sitting inside the padded <g>, its client x is the plot origin so
					    the brush's range is [0, cw()]. */}
					<rect
						x={0}
						y={0}
						width={cw()}
						height={ch()}
						fill="transparent"
						class={brush.enabled() ? "cursor-crosshair" : "cursor-pointer"}
						onMouseDown={onOverlayDown}
						onMouseMove={onOverlayMove}
						onMouseUp={onOverlayUp}
						onMouseLeave={onOverlayLeave}
					/>
					<Show when={brush.band()}>
						{(b) => (
							<rect
								x={b().x}
								y={0}
								width={b().width}
								height={ch()}
								fill={BRUSH_FILL}
								fill-opacity="0.15"
								pointer-events="none"
							/>
						)}
					</Show>
				</g>
			</svg>

			{/* Legend */}
			<div class="mt-2 flex flex-wrap gap-3 px-2 text-xs text-muted">
				<For each={props.series}>
					{(s) => (
						<div class="flex items-center gap-1">
							<span class="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ "background-color": s.color }} />
							<span class="instrument-microcaps text-[10px] text-muted">{s.label}</span>
						</div>
					)}
				</For>
			</div>
			</div>
		</Show>
	);
};

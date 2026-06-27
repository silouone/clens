import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import type { BaseChartProps, BrushableChartProps } from "./shared";
import {
	BRUSH_FILL,
	BRUSH_MIN_PX,
	CHART_COLORS,
	CHART_HAIRLINE,
	CHART_PADDING,
	CHART_SURFACE,
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

interface LineChartProps<T> extends BaseChartProps, BrushableChartProps {
	readonly data: readonly T[];
	readonly x: (d: T) => string;
	readonly y: (d: T) => number;
	readonly color?: string;
	readonly fillArea?: boolean;
	readonly tooltipLabel?: (d: T) => string;
	readonly formatY?: (v: number) => string;
}

export const LineChart = <T,>(props: LineChartProps<T>): ReturnType<Component> => {
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
	const color = () => props.color ?? CHART_COLORS.blue;

	const maxY = createMemo(() => niceMax(props.data.reduce((m, d) => Math.max(m, props.y(d)), 0)));
	const ticks = createMemo(() => generateTicks(maxY()));
	const yScale = createMemo(() => linearScale([0, maxY()], [ch(), 0]));

	// Continuous time x-scale (AC11): position each point by its actual calendar
	// day so missing days render as proportional gaps instead of evenly-spaced
	// index steps. A missing/zero-width domain (no usable date, or a single
	// distinct day) centres the reading in the plot — matching the lone-point
	// convention rather than pinning it to the left axis.
	const dom = createMemo(() => dateDomain(props.data.map(props.x)));
	const xScale = createMemo(() => {
		const d = dom();
		return d ? timeScale(d, [0, cw()]) : () => cw() / 2;
	});
	const pointX = (d: T) => xScale()(props.x(d));

	const pathD = createMemo(() => {
		if (props.data.length === 0) return "";
		return props.data
			.map((d, i) => {
				const px = pointX(d);
				const py = yScale()(props.y(d));
				return `${i === 0 ? "M" : "L"}${px},${py}`;
			})
			.join(" ");
	});

	const areaD = createMemo(() => {
		if (props.data.length <= 1 || !props.fillArea) return "";
		const base = pathD();
		const first = props.data[0];
		const last = props.data[props.data.length - 1];
		if (!first || !last) return "";
		const firstX = pointX(first);
		const lastX = pointX(last);
		return `${base} L${lastX},${ch()} L${firstX},${ch()} Z`;
	});

	const fmtY = () => props.formatY ?? formatCompact;

	// Nearest-point hit-test by plot-local x. The brush and hover/click share one
	// full-plot overlay rect, so the closest calendar point to the cursor drives
	// tooltips AND click navigation — keeping point interactivity alive even when
	// brushing is enabled (a layered capture rect otherwise swallows the circles'
	// own click/hover, which killed click-to-drill on Cost Trend in brush mode).
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
		const label = props.tooltipLabel?.(d) ?? `${props.x(d)}: ${fmtY()(props.y(d))}`;
		showTooltip(e.clientX, e.clientY - 8, label);
	};

	// Inline drag-brush (AC7): a no-op when onBrushSelect is undefined.
	const brush = createBrush({
		dates: () => props.data.map(props.x),
		range: () => [0, cw()] as const,
		onSelect: props.onBrushSelect,
	});

	// One overlay surface composes brush-drag + hover-tooltip + click: the brush owns
	// drag (mousedown→up); hover drives nearest-point tooltips when not dragging; a
	// press that moves less than BRUSH_MIN_PX is a click → point navigation still fires.
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
									{fmtY()(tick)}
								</text>
							</>
						)}
					</For>

					{/* Area fill */}
					{props.fillArea && areaD() && (
						<path d={areaD()} fill={color()} fill-opacity="0.1" />
					)}

					{/* Line */}
					<path d={pathD()} fill="none" stroke={color()} stroke-width="2" />

					{/* Single-point guide: a faint horizontal rule from the y-axis to
					    the marker so a lone reading registers as an intentional level. */}
					<Show when={props.data.length === 1 && props.data[0]}>
						{(only) => (
							<line
								x1={0} y1={yScale()(props.y(only()))}
								x2={pointX(only())} y2={yScale()(props.y(only()))}
								stroke={color()} stroke-width="1" stroke-dasharray="2 3" stroke-opacity="0.5"
							/>
						)}
					</Show>

					{/* Points (visual only — the overlay rect below owns hover/click) */}
					<For each={props.data}>
						{(d) => (
							<circle
								cx={pointX(d)} cy={yScale()(props.y(d))} r={props.data.length === 1 ? 4 : 3}
								fill={color()} stroke={CHART_SURFACE} stroke-width="1.5"
								pointer-events="none"
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
					    single interaction surface (rendered last, above the points). The
					    brush owns drag; hover drives nearest-point tooltips; a non-drag
					    mouseup is a click → onClickPoint still fires in brush mode. Sitting
					    inside the padded <g>, its client x is the plot origin so the brush
					    range is [0, cw()]. Mirrors StackedArea so both behave identically. */}
					<rect
						x={0} y={0} width={cw()} height={ch()}
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
								x={b().x} width={b().width} y={0} height={ch()}
								fill={BRUSH_FILL} fill-opacity="0.15" pointer-events="none"
							/>
						)}
					</Show>
				</g>
				</svg>
			</div>
		</Show>
	);
};

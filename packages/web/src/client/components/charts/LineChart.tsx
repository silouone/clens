import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import type { BaseChartProps } from "./shared";
import { CHART_COLORS, CHART_HAIRLINE, CHART_PADDING, CHART_SURFACE, formatCompact, formatShortDate, generateTicks, linearScale, niceMax } from "./shared";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import { ChartEmpty } from "./ChartEmpty";

interface LineChartProps<T> extends BaseChartProps {
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
	const xStep = createMemo(() => (props.data.length <= 1 ? cw() : cw() / (props.data.length - 1)));

	const pathD = createMemo(() => {
		if (props.data.length === 0) return "";
		return props.data
			.map((d, i) => {
				const px = i * xStep();
				const py = yScale()(props.y(d));
				return `${i === 0 ? "M" : "L"}${px},${py}`;
			})
			.join(" ");
	});

	const areaD = createMemo(() => {
		if (props.data.length === 0 || !props.fillArea) return "";
		const base = pathD();
		const lastX = (props.data.length - 1) * xStep();
		return `${base} L${lastX},${ch()} L0,${ch()} Z`;
	});

	const fmtY = () => props.formatY ?? formatCompact;

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

					{/* Points */}
					<For each={props.data}>
						{(d, i) => {
							const px = () => i() * xStep();
							const py = () => yScale()(props.y(d));
							return (
								<circle
									cx={px()} cy={py()} r={3}
									fill={color()} stroke={CHART_SURFACE} stroke-width="1.5"
									class="cursor-pointer"
									onClick={(e) => {
										e.stopPropagation();
										props.onClickPoint?.(d, i());
									}}
									onMouseEnter={(e) => {
										const rect = (e.target as SVGCircleElement).getBoundingClientRect();
										const label = props.tooltipLabel?.(d) ?? `${props.x(d)}: ${fmtY()(props.y(d))}`;
										showTooltip(rect.x + rect.width / 2, rect.y, label);
									}}
									onMouseLeave={hideTooltip}
								/>
							);
						}}
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
			</div>
		</Show>
	);
};

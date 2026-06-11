import { createMemo, For, type Component } from "solid-js";
import type { BaseChartProps } from "./shared";
import { CHART_COLORS, formatCompact, niceMax, linearScale } from "./shared";
import { hideTooltip, showTooltip } from "./ChartTooltip";

interface HorizontalBarProps<T> extends BaseChartProps {
	readonly data: readonly T[];
	readonly label: (d: T) => string;
	readonly value: (d: T) => number;
	readonly color?: string;
	readonly tooltipLabel?: (d: T) => string;
	readonly barHeight?: number;
}

export const HorizontalBar = <T,>(props: HorizontalBarProps<T>): ReturnType<Component> => {
	const barH = () => props.barHeight ?? 24;
	const gap = 6;
	const labelWidth = 120;
	const valueWidth = 60;
	const color = () => props.color ?? CHART_COLORS.blue;

	const maxVal = createMemo(() => niceMax(props.data.reduce((m, d) => Math.max(m, props.value(d)), 0)));

	const totalHeight = createMemo(() => {
		const n = props.data.length;
		return n > 0 ? n * (barH() + gap) + 8 : 40;
	});

	return (
		<div class={`w-full ${props.class ?? ""}`} role="img" aria-label={props.ariaLabel}>
			<div class="flex flex-col gap-1">
				<For each={props.data}>
					{(d, i) => {
						const pct = () => maxVal() > 0 ? (props.value(d) / maxVal()) * 100 : 0;
						return (
							<div
								class="flex items-center gap-2 cursor-pointer group"
								onClick={() => props.onClickPoint?.(d, i())}
								onMouseEnter={(e) => {
									const rect = e.currentTarget.getBoundingClientRect();
									const label = props.tooltipLabel?.(d) ??
										`${props.label(d)}: ${formatCompact(props.value(d))}`;
									showTooltip(rect.x + rect.width / 2, rect.y, label);
								}}
								onMouseLeave={hideTooltip}
							>
								<span class="w-28 truncate text-xs text-muted flex-shrink-0">
									{props.label(d)}
								</span>
								<div class="flex-1 h-5 bg-surface-muted rounded overflow-hidden">
									<div
										class="h-full rounded transition-all group-hover:opacity-80"
										style={{
											width: `${pct()}%`,
											"background-color": color(),
										}}
									/>
								</div>
								<span class="w-14 text-right text-xs font-medium text-secondary flex-shrink-0">
									{formatCompact(props.value(d))}
								</span>
							</div>
						);
					}}
				</For>
			</div>
		</div>
	);
};

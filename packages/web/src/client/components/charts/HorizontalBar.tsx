import { type Component, createMemo, For, Show } from "solid-js";
import { ChartEmpty } from "./ChartEmpty";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import type { BaseChartProps } from "./shared";
import { CHART_COLORS, formatCompact, niceMax } from "./shared";

interface HorizontalBarProps<T> extends BaseChartProps {
	readonly data: readonly T[];
	readonly label: (d: T) => string;
	readonly value: (d: T) => number;
	readonly color?: string;
	readonly tooltipLabel?: (d: T) => string;
	readonly barHeight?: number;
}

export const HorizontalBar = <T,>(props: HorizontalBarProps<T>): ReturnType<Component> => {
	const color = () => props.color ?? CHART_COLORS.blue;

	const maxVal = createMemo(() =>
		niceMax(props.data.reduce((m, d) => Math.max(m, props.value(d)), 0)),
	);

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
			<div class={`w-full ${props.class ?? ""}`} role="img" aria-label={props.ariaLabel}>
				<div class="flex flex-col gap-1">
					<For each={props.data}>
						{(d, i) => {
							const pct = () => (maxVal() > 0 ? (props.value(d) / maxVal()) * 100 : 0);
							return (
								<button
									type="button"
									class="flex w-full items-center gap-2 text-left cursor-pointer group"
									onClick={() => props.onClickPoint?.(d, i())}
									onMouseEnter={(e) => {
										const rect = e.currentTarget.getBoundingClientRect();
										const label =
											props.tooltipLabel?.(d) ??
											`${props.label(d)}: ${formatCompact(props.value(d))}`;
										showTooltip(rect.x + rect.width / 2, rect.y, label);
									}}
									onMouseLeave={hideTooltip}
								>
									<span class="w-28 truncate instrument-microcaps text-[10px] text-muted flex-shrink-0">
										{props.label(d)}
									</span>
									<div class="flex-1 h-5 bg-surface-inset border border-clens rounded-none overflow-hidden">
										<div
											class="h-full rounded-none transition-all group-hover:opacity-80"
											style={{
												width: `${pct()}%`,
												"background-color": color(),
											}}
										/>
									</div>
									<span class="w-14 text-right font-mono text-xs tabular-nums text-secondary flex-shrink-0">
										{formatCompact(props.value(d))}
									</span>
								</button>
							);
						}}
					</For>
				</div>
			</div>
		</Show>
	);
};

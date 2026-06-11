import { createMemo, For, Show, type Component } from "solid-js";
import type { BaseChartProps } from "./shared";
import { formatCompact } from "./shared";
import { hideTooltip, showTooltip } from "./ChartTooltip";
import { ChartEmpty } from "./ChartEmpty";

interface DonutSegment {
	readonly label: string;
	readonly value: number;
	readonly color: string;
}

interface DonutChartProps extends BaseChartProps {
	readonly segments: readonly DonutSegment[];
	readonly innerRadius?: number;
	readonly size?: number;
	readonly formatValue?: (v: number) => string;
	readonly centerLabel?: string;
	readonly centerValue?: string;
}

const describeArc = (
	cx: number, cy: number, r: number,
	startAngle: number, endAngle: number,
): string => {
	const startRad = (startAngle - 90) * (Math.PI / 180);
	const endRad = (endAngle - 90) * (Math.PI / 180);
	const x1 = cx + r * Math.cos(startRad);
	const y1 = cy + r * Math.sin(startRad);
	const x2 = cx + r * Math.cos(endRad);
	const y2 = cy + r * Math.sin(endRad);
	const largeArc = endAngle - startAngle > 180 ? 1 : 0;
	return `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2}`;
};

export const DonutChart: Component<DonutChartProps> = (props) => {
	const size = () => props.size ?? 180;
	const cx = () => size() / 2;
	const cy = () => size() / 2;
	const outerR = () => size() / 2 - 4;
	const innerR = () => props.innerRadius ?? outerR() * 0.6;
	const fmtVal = () => props.formatValue ?? formatCompact;

	const total = createMemo(() => props.segments.reduce((s, seg) => s + seg.value, 0));

	const arcs = createMemo(() => {
		const t = total();
		if (t === 0) return [];
		let currentAngle = 0;
		return props.segments.map((seg) => {
			const pct = seg.value / t;
			const sweep = pct * 360;
			const startAngle = currentAngle;
			const endAngle = currentAngle + sweep;
			currentAngle = endAngle;

			// For full circle, we need two arcs
			const sweepClamped = Math.min(sweep, 359.99);
			const path = describeArc(cx(), cy(), outerR(), startAngle, startAngle + sweepClamped);
			const innerPath = describeArc(cx(), cy(), innerR(), startAngle + sweepClamped, startAngle);

			return {
				...seg,
				pct,
				d: `${path} L${cx() + innerR() * Math.cos((startAngle + sweepClamped - 90) * Math.PI / 180)},${cy() + innerR() * Math.sin((startAngle + sweepClamped - 90) * Math.PI / 180)} ${innerPath} Z`,
				startAngle,
				endAngle,
			};
		});
	});

	return (
		<Show
			when={total() > 0}
			fallback={<ChartEmpty height={size()} class={props.class} ariaLabel={props.ariaLabel} label="No data" />}
		>
		<div class={`flex items-center gap-4 ${props.class ?? ""}`}>
			<svg
				width={size()} height={size()}
				viewBox={`0 0 ${size()} ${size()}`}
				class="overflow-visible"
				role="img" aria-label={props.ariaLabel}
			>
				<For each={arcs()}>
					{(arc, i) => (
						<path
							d={arc.d}
							fill={arc.color}
							class="cursor-pointer transition-opacity hover:opacity-80"
							onClick={(e) => {
								e.stopPropagation();
								props.onClickPoint?.(arc, i());
							}}
							onMouseEnter={(e) => {
								const rect = (e.target as SVGPathElement).getBoundingClientRect();
								showTooltip(
									rect.x + rect.width / 2,
									rect.y + rect.height / 2,
									`${arc.label}: ${fmtVal()(arc.value)} (${(arc.pct * 100).toFixed(0)}%)`,
								);
							}}
							onMouseLeave={hideTooltip}
						/>
					)}
				</For>

				{/* Center text */}
				{props.centerLabel && (
					<>
						<text
							x={cx()} y={cy() - 6}
							text-anchor="middle" dominant-baseline="middle"
							class="fill-muted instrument-microcaps text-[10px]"
						>
							{props.centerLabel}
						</text>
						<text
							x={cx()} y={cy() + 10}
							text-anchor="middle" dominant-baseline="middle"
							class="fill-primary font-mono text-sm font-semibold tabular-nums"
						>
							{props.centerValue ?? ""}
						</text>
					</>
				)}
			</svg>

			{/* Legend */}
			<div class="flex flex-col gap-1.5 text-xs">
				<For each={props.segments}>
					{(seg) => (
						<div class="flex items-center gap-1.5">
							<span
								class="inline-block h-2.5 w-2.5 rounded-[2px] flex-shrink-0"
								style={{ "background-color": seg.color }}
							/>
							<span class="instrument-microcaps text-[10px] text-muted">{seg.label}</span>
							<span class="ml-auto font-mono tabular-nums text-secondary">{fmtVal()(seg.value)}</span>
						</div>
					)}
				</For>
			</div>
		</div>
		</Show>
	);
};

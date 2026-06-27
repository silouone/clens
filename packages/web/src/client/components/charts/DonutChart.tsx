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

/** Polar point on a circle, with 0° at 12 o'clock (SVG y grows downward). */
const polar = (cx: number, cy: number, r: number, angleDeg: number): readonly [number, number] => {
	const rad = (angleDeg - 90) * (Math.PI / 180);
	return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};

/**
 * Build a closed donut-segment (ring sector) path between two radii.
 * The outer arc is swept clockwise (flag 1) and the inner arc back
 * counter-clockwise (flag 0); BOTH use the same large-arc flag derived from the
 * sweep. The previous implementation hard-coded sweep flag 1 on both arcs and
 * recomputed large-arc from a negated angle delta (always 0), so any slice
 * wider than 180° drew its inner edge the short way round — producing the
 * lens/overlap artifact. This is the geometrically correct version.
 */
const donutSegment = (
	cx: number, cy: number, outerR: number, innerR: number,
	startAngle: number, sweep: number,
): string => {
	const endAngle = startAngle + sweep;
	const largeArc = sweep > 180 ? 1 : 0;
	const [ox0, oy0] = polar(cx, cy, outerR, startAngle);
	const [ox1, oy1] = polar(cx, cy, outerR, endAngle);
	const [ix1, iy1] = polar(cx, cy, innerR, endAngle);
	const [ix0, iy0] = polar(cx, cy, innerR, startAngle);
	return `M${ox0},${oy0} A${outerR},${outerR} 0 ${largeArc} 1 ${ox1},${oy1} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc} 0 ${ix0},${iy0} Z`;
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
			// Clamp just below a full turn so a lone 100% slice still renders as a
			// ring (a true 360° arc collapses to a zero-length path in SVG).
			const sweep = Math.min(pct * 360, 359.999);
			const startAngle = currentAngle;
			const endAngle = currentAngle + sweep;
			currentAngle = endAngle;

			return {
				...seg,
				pct,
				d: donutSegment(cx(), cy(), outerR(), innerR(), startAngle, sweep),
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

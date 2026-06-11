import { type Component, createMemo, createUniqueId, For, Show } from "solid-js";
import type { ContextConsumption } from "../../shared/types";
import { Card } from "./ui/Card";

// ── Pure helpers ─────────────────────────────────────────────────────

const WIDTH = 300;
const HEIGHT = 120;
const PADDING = { top: 4, right: 4, bottom: 4, left: 4 };
const PLOT_W = WIDTH - PADDING.left - PADDING.right;
const PLOT_H = HEIGHT - PADDING.top - PADDING.bottom;

const scaleX = (turnIndex: number, maxTurn: number): number =>
	PADDING.left + (maxTurn > 0 ? (turnIndex / maxTurn) * PLOT_W : 0);

const scaleY = (pct: number): number =>
	PADDING.top + PLOT_H * (1 - Math.min(pct, 110) / 110);

const buildAreaPath = (
	points: readonly { readonly turn_index: number; readonly context_pct: number }[],
	maxTurn: number,
): string => {
	if (points.length === 0) return "";
	const baseline = scaleY(0);
	const segments = points.map(
		(p) => `${scaleX(p.turn_index, maxTurn)},${scaleY(p.context_pct)}`,
	);
	const firstX = scaleX(points[0].turn_index, maxTurn);
	const lastX = scaleX(points[points.length - 1].turn_index, maxTurn);
	return `M${firstX},${baseline} L${segments.join(" L")} L${lastX},${baseline} Z`;
};

const buildLinePath = (
	points: readonly { readonly turn_index: number; readonly context_pct: number }[],
	maxTurn: number,
): string => {
	if (points.length === 0) return "";
	const segments = points.map(
		(p, i) =>
			`${i === 0 ? "M" : "L"}${scaleX(p.turn_index, maxTurn)},${scaleY(p.context_pct)}`,
	);
	return segments.join(" ");
};

// ── Component ────────────────────────────────────────────────────────

export const ContextChart: Component<{
	readonly consumption: ContextConsumption;
}> = (props) => {
	const uid = createUniqueId();
	const gradientId = `ctx-gradient-${uid}`;
	const lineGradientId = `ctx-line-gradient-${uid}`;

	const points = createMemo(() => props.consumption.points);
	const maxTurn = createMemo(() => {
		const pts = points();
		return pts.length > 0 ? pts[pts.length - 1].turn_index : 1;
	});

	const areaPath = createMemo(() => buildAreaPath(points(), maxTurn()));
	const linePath = createMemo(() => buildLinePath(points(), maxTurn()));

	const compactionPoints = createMemo(() =>
		points().filter((p) => p.is_compaction),
	);

	const limitY = scaleY(100);

	// Gradient stop positions (map pct thresholds to SVG y-axis fraction)
	// SVG gradient goes top-to-bottom: offset 0 = top (110%), offset 1 = bottom (0%)
	const greenStop = ((110 - 50) / 110) * 100;   // 50% threshold
	const yellowStop = ((110 - 75) / 110) * 100;   // 75% threshold

	return (
		<Card title="Context Consumption">
			<div class="px-4 py-3">
				<svg
					viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
					class="w-full"
					preserveAspectRatio="xMidYMid meet"
				>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset={`${yellowStop}%`} stop-color="#ef4444" stop-opacity="0.5" />
							<stop offset={`${yellowStop}%`} stop-color="#f59e0b" stop-opacity="0.4" />
							<stop offset={`${greenStop}%`} stop-color="#f59e0b" stop-opacity="0.4" />
							<stop offset={`${greenStop}%`} stop-color="#10b981" stop-opacity="0.3" />
							<stop offset="100%" stop-color="#10b981" stop-opacity="0.1" />
						</linearGradient>
						<linearGradient id={lineGradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset={`${yellowStop}%`} stop-color="#ef4444" />
							<stop offset={`${yellowStop}%`} stop-color="#f59e0b" />
							<stop offset={`${greenStop}%`} stop-color="#f59e0b" />
							<stop offset={`${greenStop}%`} stop-color="#10b981" />
						</linearGradient>
					</defs>

					{/* Area fill */}
					<path d={areaPath()} fill={`url(#${gradientId})`} />

					{/* Line stroke */}
					<path
						d={linePath()}
						fill="none"
						stroke={`url(#${lineGradientId})`}
						stroke-width="1.5"
						stroke-linejoin="round"
					/>

					{/* 100% limit dashed line */}
					<line
						x1={PADDING.left}
						y1={limitY}
						x2={WIDTH - PADDING.right}
						y2={limitY}
						stroke="currentColor"
						stroke-width="0.5"
						stroke-dasharray="4 3"
						class="text-muted"
						opacity="0.4"
					/>

					{/* Compaction event markers */}
					<For each={compactionPoints()}>
						{(p) => (
							<circle
								cx={scaleX(p.turn_index, maxTurn())}
								cy={scaleY(p.context_pct)}
								r="3"
								fill="#ef4444"
								stroke="#fff"
								stroke-width="1"
							/>
						)}
					</For>
				</svg>

				{/* Summary stats */}
				<div class="mt-2 flex items-center gap-4 text-xs">
					<span class="text-muted">
						Peak:{" "}
						<span class="font-medium text-secondary">
							{Math.round(props.consumption.peak_context_pct)}%
						</span>
					</span>
					<Show when={props.consumption.compaction_count > 0}>
						<span class="text-muted">
							Compactions:{" "}
							<span class="font-medium text-secondary">
								{props.consumption.compaction_count}
							</span>
						</span>
					</Show>
					<span class="text-muted">
						Velocity:{" "}
						<span class="font-medium text-secondary">
							{props.consumption.context_velocity_per_min.toFixed(1)}%/min
						</span>
					</span>
				</div>
			</div>
		</Card>
	);
};

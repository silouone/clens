import { type Component, createMemo, For, Show } from "solid-js";
import { ChartEmpty } from "./ChartEmpty";
import { hideTooltip, showTooltip } from "./ChartTooltip";

// ── AgentGraph (overview-moat-refactor, Wave 2 — only CommunicationTab) ─
//
// A hub-and-spoke topology of an agent run: one central orchestrator node with
// every spawned agent radiating out on a ring, sized by activity. Two STRICTLY
// SEPARATE channels keep it honest (R-D):
//
//   • spawn spokes — neutral hairlines (hub → each agent). Structural only:
//     "these agents belong to this run". No arrowheads, no color.
//   • message edges — comms-colored arcs drawn from `edges` (real captured
//     messages), thicker by volume; a hub self-loop renders with its count.
//
// This separation is the point: a run can have 133 agents but ~5 messages
// (massive fan-out, near-zero cross-talk), and the graph must show THAT, not a
// dressed-up dense network. Workers are capped to `maxSpokes` (highest activity
// first, plus any that carry a message edge); the rest spill to a "+N more"
// marker while the consumer's roster carries full detail.

export type AgentGraphNode = {
	readonly id: string;
	readonly label: string;
	readonly type: string;
	/** Activity metric (e.g. tool calls) driving node size. ≥ 0. */
	readonly weight: number;
};

export type AgentGraphEdge = {
	/** Node id (or the hub id) of the sender. */
	readonly from: string;
	/** Node id (or the hub id) of the receiver. */
	readonly to: string;
	readonly count: number;
};

interface AgentGraphProps {
	/** The synthetic orchestrator at the centre (no measured size — a role marker). */
	readonly hubId: string;
	readonly hubLabel: string;
	readonly workers: readonly AgentGraphNode[];
	readonly edges?: readonly AgentGraphEdge[];
	readonly height?: number;
	readonly maxSpokes?: number;
	readonly colorFor?: (type: string) => string;
	readonly hubColor?: string;
	readonly messageColor?: string;
	readonly ariaLabel: string;
	readonly onNodeClick?: (node: AgentGraphNode) => void;
}

const VIEWBOX_W = 460;
const MIN_SIDE = 5;
const MAX_SIDE = 15;
const HUB_SIDE = 20;

type Placed = {
	readonly node: AgentGraphNode;
	readonly x: number;
	readonly y: number;
	readonly side: number;
};

/** sqrt-scaled square side so area (not edge) tracks activity. */
const sideFor = (weight: number, wMin: number, wMax: number): number => {
	const lo = Math.sqrt(Math.max(0, wMin));
	const hi = Math.sqrt(Math.max(0, wMax));
	const v = Math.sqrt(Math.max(0, weight));
	const frac = hi <= lo ? 0.5 : (v - lo) / (hi - lo);
	return MIN_SIDE + frac * (MAX_SIDE - MIN_SIDE);
};

export const AgentGraph: Component<AgentGraphProps> = (props) => {
	const height = () => props.height ?? 320;
	const cx = () => VIEWBOX_W / 2;
	const cy = () => height() / 2;
	const ringR = () => Math.min(cx(), cy()) - 28;
	const colorFor = () => props.colorFor ?? (() => "var(--clens-text-secondary)");
	const messageColor = () => props.messageColor ?? "var(--clens-cat-comms)";
	const hubColor = () => props.hubColor ?? "var(--clens-cat-agents)";
	const maxSpokes = () => props.maxSpokes ?? 60;

	// Workers that carry a real message edge are force-included so no captured
	// message ever loses an endpoint to the activity cap.
	const edgeParticipants = createMemo(() => {
		const ids = (props.edges ?? []).flatMap((e) => [e.from, e.to]);
		return new Set(ids.filter((id) => id !== props.hubId));
	});

	// Highest-activity first, then force-included edge participants, deduped.
	const rendered = createMemo<readonly AgentGraphNode[]>(() => {
		const sorted = [...props.workers].sort((a, b) => b.weight - a.weight);
		const top = sorted.slice(0, maxSpokes());
		const topIds = new Set(top.map((w) => w.id));
		const extra = sorted.filter((w) => !topIds.has(w.id) && edgeParticipants().has(w.id));
		return [...top, ...extra];
	});

	const overflow = () => Math.max(0, props.workers.length - rendered().length);

	const placed = createMemo<readonly Placed[]>(() => {
		const list = rendered();
		const n = list.length;
		if (n === 0) return [];
		const weights = props.workers.map((w) => w.weight);
		const wMin = Math.min(...weights);
		const wMax = Math.max(...weights);
		const r = ringR();
		return list.map((node, i) => {
			// Start at 12 o'clock, sweep clockwise.
			const theta = -Math.PI / 2 + (i / n) * 2 * Math.PI;
			return {
				node,
				x: cx() + r * Math.cos(theta),
				y: cy() + r * Math.sin(theta),
				side: sideFor(node.weight, wMin, wMax),
			};
		});
	});

	// id → centre, including the hub, for edge endpoints.
	const positions = createMemo<ReadonlyMap<string, readonly [number, number]>>(
		() =>
			new Map<string, readonly [number, number]>([
				[props.hubId, [cx(), cy()]],
				...placed().map((p) => [p.node.id, [p.x, p.y]] as [string, readonly [number, number]]),
			]),
	);

	// Message edges resolvable to two placed endpoints; self-loops kept separate.
	const messageArcs = createMemo(() => {
		const pos = positions();
		return (props.edges ?? [])
			.filter((e) => e.from !== e.to && pos.has(e.from) && pos.has(e.to))
			.map((e) => {
				const from = pos.get(e.from);
				const to = pos.get(e.to);
				// Both are guaranteed present by the filter above.
				const [x1, y1] = from ?? [cx(), cy()];
				const [x2, y2] = to ?? [cx(), cy()];
				// Bow the arc toward the hub for a chord-diagram read.
				const mx = (x1 + x2) / 2;
				const my = (y1 + y2) / 2;
				const qx = mx + (cx() - mx) * 0.4;
				const qy = my + (cy() - my) * 0.4;
				return {
					d: `M${x1},${y1} Q${qx},${qy} ${x2},${y2}`,
					width: 1 + Math.min(e.count, 5) * 0.5,
				};
			});
	});

	const selfLoopCount = createMemo(() =>
		(props.edges ?? [])
			.filter((e) => e.from === e.to && e.from === props.hubId)
			.reduce((sum, e) => sum + e.count, 0),
	);

	const hubHalf = HUB_SIDE / 2;

	return (
		<Show
			when={props.workers.length > 0}
			fallback={<ChartEmpty height={height()} ariaLabel={props.ariaLabel} label="No agents" />}
		>
			<svg
				width="100%"
				height={height()}
				viewBox={`0 0 ${VIEWBOX_W} ${height()}`}
				preserveAspectRatio="xMidYMid meet"
				role="img"
				aria-label={props.ariaLabel}
				class="overflow-visible"
			>
				{/* Channel 1 — spawn spokes (neutral hairlines, structural only). */}
				<g>
					<For each={placed()}>
						{(p) => (
							<line
								x1={cx()}
								y1={cy()}
								x2={p.x}
								y2={p.y}
								stroke="var(--clens-tick)"
								stroke-width="1"
								opacity="0.3"
							/>
						)}
					</For>
				</g>

				{/* Channel 2 — message edges (comms color, sized by volume). */}
				<g>
					<For each={messageArcs()}>
						{(arc) => (
							<path
								d={arc.d}
								fill="none"
								stroke={messageColor()}
								stroke-width={arc.width}
								opacity="0.85"
							/>
						)}
					</For>
				</g>

				{/* Worker nodes — LED squares, sized by activity, colored by type. */}
				<g>
					<For each={placed()}>
						{(p) => (
							<rect
								role="menuitem"
								aria-label={`${p.node.label} · ${p.node.type}`}
								x={p.x - p.side / 2}
								y={p.y - p.side / 2}
								width={p.side}
								height={p.side}
								rx="1"
								fill={colorFor()(p.node.type)}
								class="cursor-pointer transition-opacity hover:opacity-70"
								onClick={(e) => {
									e.stopPropagation();
									props.onNodeClick?.(p.node);
								}}
								onMouseEnter={(e) => {
									const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
									// No numeric claim here: `weight` is an opaque activity metric
									// to this generic chart (the consumer may pass tools OR a
									// duration fallback), so labelling it "tools" could fabricate.
									// The consumer's roster shows the real, honest figures.
									showTooltip(r.x + r.width / 2, r.y, `${p.node.label} · ${p.node.type}`);
								}}
								onMouseLeave={hideTooltip}
							/>
						)}
					</For>
				</g>

				{/* Hub self-loop (real messages the orchestrator logged to itself). */}
				<Show when={selfLoopCount() > 0}>
					<path
						d={`M${cx() - 6},${cy() - hubHalf} C${cx() - 20},${cy() - hubHalf - 30} ${cx() + 20},${cy() - hubHalf - 30} ${cx() + 6},${cy() - hubHalf}`}
						fill="none"
						stroke={messageColor()}
						stroke-width="1.5"
						opacity="0.9"
					/>
					<text
						x={cx()}
						y={cy() - hubHalf - 34}
						text-anchor="middle"
						class="instrument-microcaps text-[10px]"
						fill={messageColor()}
					>
						{selfLoopCount()} msg
					</text>
				</Show>

				{/* Hub — synthetic orchestrator (a role marker, never a measured size). */}
				<rect
					role="menuitem"
					aria-label={`${props.hubLabel} · orchestrator`}
					x={cx() - hubHalf}
					y={cy() - hubHalf}
					width={HUB_SIDE}
					height={HUB_SIDE}
					rx="2"
					fill={hubColor()}
					onMouseEnter={(e) => {
						const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
						showTooltip(r.x + r.width / 2, r.y, `${props.hubLabel} · orchestrator`);
					}}
					onMouseLeave={hideTooltip}
				/>

				{/* Overflow marker — full detail lives in the consumer's roster. */}
				<Show when={overflow() > 0}>
					<text
						x={cx()}
						y={height() - 6}
						text-anchor="middle"
						class="instrument-microcaps text-[10px]"
						fill="var(--clens-text-muted)"
					>
						+{overflow()} more agents
					</text>
				</Show>
			</svg>
		</Show>
	);
};

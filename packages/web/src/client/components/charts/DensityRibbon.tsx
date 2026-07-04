import { type Component, createMemo, For } from "solid-js";

// ── DensityRibbon (overview-moat-refactor, Wave 0 cross-wave primitive) ─
//
// A horizontal SVG strip that maps events onto the session span [startTime,
// endTime], one thin band per event coloured by event type — so the rhythm and
// clustering of a run reads at a glance (R-C5). Consumed by BOTH the Wave 1
// ActivityWidget (mini ribbon) and the Wave 2 TimelineTab (full-span ribbon),
// which is why it lives in Wave 0. The viewBox + preserveAspectRatio="none"
// makes it stretch to its container width responsively.
//
// The event type is intentionally a plain `string` (not the TimelineEntry union)
// so callers can pass `session.timeline` directly — its `type` field widens to
// string in a readonly position.

export type DensityRibbonEvent = {
	readonly t: number;
	readonly type: string;
};

type DensityRibbonProps = {
	readonly events: readonly DensityRibbonEvent[];
	readonly startTime: number;
	readonly endTime: number;
	readonly height?: number;
	readonly class?: string;
	readonly ariaLabel?: string;
};

// Internal coordinate width; the SVG scales to its container via viewBox.
const VIEW_W = 1000;
const BAND_W = 2;

/** Event type → CSS-var stroke. Falls back to muted graphite for unknowns. */
const DENSITY_COLORS: Readonly<Record<string, string>> = {
	user_prompt: "var(--clens-cat-outcome)",
	thinking: "var(--clens-cat-context)",
	tool_call: "var(--clens-cat-timing)",
	tool_result: "var(--clens-cat-timing)",
	failure: "var(--clens-cat-risk)",
	backtrack: "var(--clens-cat-cost)",
	phase_boundary: "var(--clens-tick)",
	agent_spawn: "var(--clens-cat-agents)",
	agent_stop: "var(--clens-cat-agents)",
	task_create: "var(--clens-cat-agents)",
	task_assign: "var(--clens-cat-agents)",
	task_complete: "var(--clens-cat-agents)",
	msg_send: "var(--clens-cat-comms)",
	teammate_idle: "var(--clens-text-muted)",
};

const densityColor = (type: string): string => DENSITY_COLORS[type] ?? "var(--clens-text-muted)";

export const DensityRibbon: Component<DensityRibbonProps> = (props) => {
	const height = () => props.height ?? 24;
	const span = () => Math.max(1, props.endTime - props.startTime);
	const xOf = (t: number): number => {
		const x = ((t - props.startTime) / span()) * VIEW_W;
		return Math.max(0, Math.min(VIEW_W - BAND_W, x));
	};

	const bands = createMemo(() =>
		props.events.map((ev) => ({ x: xOf(ev.t), fill: densityColor(ev.type) })),
	);

	return (
		<svg
			viewBox={`0 0 ${VIEW_W} ${height()}`}
			preserveAspectRatio="none"
			class={`w-full rounded-none border border-clens ${props.class ?? ""}`}
			style={{ height: `${height()}px` }}
			role="img"
			aria-label={props.ariaLabel ?? "Event density over the session span"}
		>
			<rect x={0} y={0} width={VIEW_W} height={height()} fill="var(--clens-surface-inset)" />
			<For each={bands()}>
				{(b) => (
					<rect x={b.x} y={0} width={BAND_W} height={height()} fill={b.fill} opacity={0.55} />
				)}
			</For>
		</svg>
	);
};

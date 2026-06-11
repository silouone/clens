import { type Component } from "solid-js";

// ── Instrument empty state ──────────────────────────────────────────
//
// A styled "no signal" frame for charts with no data: a hairline-bordered
// plot area with a centered microcaps label. An unstyled blank chart is a
// defect — every chart renders this when its dataset is empty.

export const ChartEmpty: Component<{
	readonly height?: number;
	readonly class?: string;
	readonly label?: string;
	readonly ariaLabel?: string;
}> = (props) => (
	<div
		class={`flex w-full items-center justify-center border border-clens bg-surface-inset ${props.class ?? ""}`}
		style={{ height: `${props.height ?? 200}px` }}
		role="img"
		aria-label={props.ariaLabel ?? "No data"}
	>
		<span class="instrument-microcaps text-[10px] text-muted">
			{props.label ?? "No data"}
		</span>
	</div>
);

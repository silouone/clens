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
		class={`flex w-full flex-col items-center justify-center gap-2 border border-clens bg-surface-inset ${props.class ?? ""}`}
		style={{ height: `${props.height ?? 200}px` }}
		role="img"
		aria-label={props.ariaLabel ?? "No data"}
	>
		{/* Flat-line "no signal" trace — a hairline baseline reads as an idle
		    instrument rather than a blank panel. */}
		<svg width="56" height="9" viewBox="0 0 56 9" aria-hidden="true" class="opacity-70">
			<line x1="0" y1="4.5" x2="56" y2="4.5" stroke="var(--clens-tick)" stroke-width="1" stroke-dasharray="2 3" />
		</svg>
		<span class="instrument-microcaps text-[10px] text-muted">
			{props.label ?? "No signal"}
		</span>
	</div>
);

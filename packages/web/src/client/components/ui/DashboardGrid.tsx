import type { Component, JSX } from "solid-js";

// ── Dashboard bento grid (overview-moat-refactor, Wave 0) ────────────
//
// The responsive 12-column host for Overview widgets. Children declare their
// desktop span via the `span` prop on <Widget>, which emits the matching
// `sm:`/`lg:` col-span classes. The grid itself only sets the column count per
// tier (breakpoint-contract.md):
//   base (<640px)  grid-cols-1   — everything stacks full width (375px target)
//   sm   (≥640px)  grid-cols-6   — tablet, 2-up
//   lg   (≥1024px) grid-cols-12  — full bento
// No horizontal scroll, nothing clips below sm.

type DashboardGridProps = {
	readonly children: JSX.Element;
	readonly class?: string;
};

export const DashboardGrid: Component<DashboardGridProps> = (props) => (
	<div class={`grid grid-cols-1 gap-3 sm:grid-cols-6 lg:grid-cols-12 ${props.class ?? ""}`}>
		{props.children}
	</div>
);

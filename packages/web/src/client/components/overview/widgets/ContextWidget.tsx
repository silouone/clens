import { Show, type Component } from "solid-js";
import { Widget } from "../../ui/Widget";
import { ContextChart } from "../../ContextChart";
import type { WidgetProps } from "../types";

// ── ContextWidget [context] — Wave 1 ─────────────────────────────────
//
// Promotes the existing ContextChart to a first-class context-channel widget
// (R-C1, AC6). The chart already renders everything the spec asks to be legible
// at a glance — the area/line curve, the 100% breach (dashed reference line +
// gradient that turns danger-red above 75%), the compaction markers (red dots),
// and the peak figure in tabular mono — so we reuse it verbatim rather than
// duplicate its SVG logic, and only supply the category channel + empty state.
//
// Context has no sibling detail tab (CATEGORY.context.targetTab is undefined),
// so this widget is informational only — no click-through.
//
// Honesty (R-D4 / R-E1): if the session carries no context curve we render a
// deliberate empty state instead of an empty colored shell. The grid host also
// guards this widget behind `context_consumption`, but the widget stays
// self-sufficient so it never paints a broken panel on a sparse fixture.

export const ContextWidget: Component<WidgetProps> = (props) => {
	const ctx = () => props.session.context_consumption;
	return (
		<Widget category="context" title="Context" span={8}>
			<Show
				when={ctx()}
				fallback={<p class="text-xs italic text-muted">No context data</p>}
			>
				{(c) => <ContextChart consumption={c()} />}
			</Show>
		</Widget>
	);
};

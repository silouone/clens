import type { DistilledSession } from "../../../shared/types";
import type { DetailTabId } from "../../lib/categories";

// ── Shared Overview widget contract (overview-moat-refactor, Wave 0) ──
//
// Every widget under overview/widgets/ takes this exact prop shape. Keeping it
// uniform means the grid host (OverviewPanel) wires all widgets identically and
// a Wave 1 builder fleshing out one widget never has to touch the host or a
// shared barrel — they derive whatever they need from `session` and use
// `onNavigate` for the single-click jump to a sibling tab (R-A5).

export type WidgetProps = {
	readonly session: DistilledSession;
	readonly isMultiAgent: boolean;
	/** Jump to a sibling detail tab (click-through from a glanceable signal). */
	readonly onNavigate?: (tab: DetailTabId) => void;
};

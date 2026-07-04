import type { DistilledSession } from "../../../shared/types";

// ── Shared sibling-tab contract (overview-moat-refactor, Wave 0) ─────
//
// Every tab under tabs/ takes this exact prop shape so BottomPanel can dispatch
// to all four identically and a Wave 2 builder reworking one tab never touches
// the dispatcher or the barrel. Each tab derives what it needs from `session`
// (timeline, backtracks, edit_chains, comm_sequence, start_time, …).

export type TabProps = {
	readonly session: DistilledSession;
	readonly isMultiAgent: boolean;
	/** Backtrack → timeline jump, preserved from the original BottomPanel (R-F2). */
	readonly onBacktrackClick?: (startT: number) => void;
};

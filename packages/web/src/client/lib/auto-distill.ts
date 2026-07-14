/**
 * Pure guard for auto-distilling a session on the detail view. (B17 / D13)
 *
 * Lives in its own (type-only-dependency) module so it can be unit-tested
 * without pulling in the SolidJS component tree or the browser-only
 * `api`/`window` module graph that `stores.ts` transitively imports.
 */

import type { SessionStatus } from "@silou/clens";

/**
 * Inputs governing whether the detail view should auto-distill a session.
 * `summaryStatus` is the list-derived session status ("complete" | "active" |
 * "idle"), or undefined when the session list hasn't loaded yet.
 */
export type AutoDistillGuardInput = {
	readonly autoDistillEnabled: boolean;
	readonly isNotDistilled: boolean;
	readonly alreadyTriggered: boolean;
	readonly detailLoading: boolean;
	readonly summaryStatus: SessionStatus | undefined;
};

/**
 * Decide whether to auto-distill a session on view.
 *
 * Auto-distill is only safe for sessions that have actually finished. A LIVE
 * (still-running) session must NOT be auto-distilled on view — doing so freezes
 * a stale "complete" snapshot seconds into a running session; the live timeline
 * view is shown instead. Manual Re-analyze stays available regardless.
 *
 * A session counts as finished only when the list summary reports
 * status === "complete" (last event is a terminal SessionEnd). If the summary
 * is missing (list not yet loaded) or reports "active"/"idle" (still live), we
 * conservatively skip auto-distill.
 */
export const shouldAutoDistill = (input: AutoDistillGuardInput): boolean =>
	input.autoDistillEnabled &&
	input.isNotDistilled &&
	!input.alreadyTriggered &&
	!input.detailLoading &&
	input.summaryStatus === "complete";

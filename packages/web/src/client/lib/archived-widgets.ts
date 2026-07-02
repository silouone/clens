// ── Overview widget archive (session-detail-v6, slice #3) ───────────
//
// The widget election dissolved the Overview bento grid: the Overview is the
// answer card (HeroBand) plus the four forensic tabs, and all twelve glance
// widgets are ARCHIVED — kept in code, gated out of render by this single
// reversible set. Restoring a card is deleting one id from ARCHIVED_WIDGETS;
// nothing else changes (imports, barrels, and widget files all stay). Never
// delete widget code — this set is the only off switch.
//
// Pure module (no Solid, no window) so the grid-dissolution gate test can
// import it directly under bun.

/** Every widget id the Overview grid ever hosted, in grid order. */
export const OVERVIEW_WIDGET_IDS = [
	"w_context",
	"w_risk",
	"w_edits",
	"w_activity",
	"w_agents",
	"w_cost",
	"w_outcome",
	"w_files",
	"w_config",
	"w_taskplan",
	"w_harness",
	"w_reasoning",
] as const;

export type OverviewWidgetId = (typeof OVERVIEW_WIDGET_IDS)[number];

/**
 * The reversible archive flag (election verdict — mechanism verbatim): while
 * an id is in this set its widget does not render. Remove one id to restore
 * that card with zero other changes.
 */
export const ARCHIVED_WIDGETS = new Set<string>([
	"w_activity",
	"w_agents",
	"w_context",
	"w_cost",
	"w_edits",
	"w_files",
	"w_outcome",
	"w_risk",
	"w_taskplan",
	"w_reasoning",
	"w_config",
	"w_harness",
]);

/** True when a widget id is NOT archived and may render. */
export const shown = (id: OverviewWidgetId): boolean => !ARCHIVED_WIDGETS.has(id);

/**
 * True while at least one widget survives the archive. Gates the grid
 * container itself: while every id is archived the DashboardGrid disappears
 * entirely instead of rendering an empty shell.
 */
export const anyOverviewWidgetShown = (): boolean => OVERVIEW_WIDGET_IDS.some(shown);

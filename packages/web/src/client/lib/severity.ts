// ── Severity style utilities ────────────────────────────────────────

/** Backtrack severity badge styles (used in BottomPanel timeline). */
const SEVERITY_STYLES: Readonly<Record<string, string>> = {
	failure_retry: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50",
	iteration_struggle: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/50 dark:text-orange-400 dark:border-orange-700/50",
	debugging_loop: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-400 dark:border-red-700/50",
};

/** Get severity border+bg style for a backtrack type (BottomPanel). */
export const getSeverityStyle = (type: string): string =>
	SEVERITY_STYLES[type] ?? "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700/50";

/** Backtrack badge class for IssuesPanel (no border variant). */
const BACKTRACK_BADGE_CLASSES: Readonly<Record<string, string>> = {
	failure_retry: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
	iteration_struggle: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
	debugging_loop: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
};

/** Get badge class for backtrack type in IssuesPanel. */
export const getBacktrackBadgeClass = (type: string): string =>
	BACKTRACK_BADGE_CLASSES[type] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";

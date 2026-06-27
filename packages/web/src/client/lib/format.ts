/** Format a duration in milliseconds to a short human-readable string (e.g. "3m 42s"). */
export const formatDuration = (ms: number): string => {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

/**
 * Format a USD cost value (e.g. "$1.23", or "~$1.23" / "~<$0.01" for estimated).
 *
 * `isEstimated` should be `true` whenever the source `cost_basis !== "measured"`
 * (per-session costs are ~0% measured on disk — cache_read dominates). The `~`
 * is applied to BOTH the normal and sub-cent branches so an estimated session
 * never renders a bare exact figure (NUM-5 / locked honesty caveat).
 */
export const formatCost = (usd: number, isEstimated?: boolean): string => {
	const prefix = isEstimated ? "~" : "";
	return usd < 0.01 ? `${prefix}<$0.01` : `${prefix}$${usd.toFixed(2)}`;
};

/**
 * Humanize a raw model id into its public display name (NUM-6).
 *
 * Captured model ids arrive in their raw API form — lowercase, hyphenated, and
 * sometimes carrying a context-window variant suffix (e.g. `claude-fable-5`,
 * `CLAUDE-FABLE-5`, `claude-opus-4-8[1m]`). Rendered verbatim in a public UI
 * they read as internal/unpolished. This maps them to the canonical Anthropic
 * display names ("Claude Fable 5", "Claude Opus 4.8") and strips the bracketed
 * `[1m]`/`[200k]` variant suffix entirely.
 *
 * Algorithmic (no lookup table): the dash-number id pattern title-cases the
 * leading name tokens and dot-joins the trailing numeric version segments —
 * `claude-opus-4-8` → "Claude Opus 4.8", `claude-fable-5` → "Claude Fable 5".
 * Unrecognized shapes fall through unchanged.
 */
export const modelDisplayName = (modelId: string): string => {
	if (!modelId) return modelId;
	// Drop a context-window variant suffix like "[1m]" / "[200k]".
	const base = modelId.replace(/\s*\[[^\]]*\]\s*$/i, "").trim();
	const parts = base.split("-").filter(Boolean);
	if (parts.length === 0) return modelId;
	const words: string[] = [];
	const version: string[] = [];
	for (const p of parts) {
		if (/^\d+$/.test(p)) version.push(p);
		else words.push(p.charAt(0).toUpperCase() + p.slice(1));
	}
	const name = words.join(" ");
	return version.length > 0 ? `${name} ${version.join(".")}` : name;
};

/** Format a percentage from value/total (e.g. "59%" or "< 1%"). */
export const formatPercentage = (value: number, total: number): string => {
	if (total <= 0) return "0%";
	const pct = (value / total) * 100;
	if (pct < 1 && pct > 0) return "< 1%";
	return `${Math.round(pct)}%`;
};

/** Classify backtrack severity: green (<2), yellow (2-4), red (>4). */
export const classifySeverity = (backtrackCount: number): { readonly label: string; readonly color: string } => {
	if (backtrackCount < 2) return { label: "low", color: "text-emerald-600 dark:text-emerald-400" };
	if (backtrackCount <= 4) return { label: "moderate", color: "text-amber-600 dark:text-amber-400" };
	return { label: "high", color: "text-red-600 dark:text-red-400" };
};


/** Truncate text to maxLines, returning whether it was truncated. */
export const truncateMultiline = (text: string, maxLines: number): { readonly text: string; readonly truncated: boolean } => {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return { text, truncated: false };
	return { text: lines.slice(0, maxLines).join("\n"), truncated: true };
};

/**
 * Number of LOCAL calendar days between two timestamps (bug B21).
 *
 * Counts midnight boundaries crossed in the local timezone, NOT elapsed 24h
 * buckets — so an event at "yesterday 23:00" is 1 day ago even if it is under
 * 24h ago, and an event from "today 00:30" is 0 days ago. Both timestamps are
 * normalized to local midnight before differencing, sidestepping DST drift.
 */
export const calendarDaysBetween = (laterTs: number, earlierTs: number): number => {
	const startOfLocalDay = (ts: number): number => {
		const d = new Date(ts);
		return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	};
	const diff = startOfLocalDay(laterTs) - startOfLocalDay(earlierTs);
	return Math.round(diff / 86_400_000);
};

/** Format a timestamp as either relative ("2d ago") or absolute ("Mar 5, 14:32") based on mode. */
export const formatDate = (ts: number, mode: "relative" | "absolute", now: number = Date.now()): string => {
	const d = new Date(ts);
	if (mode === "absolute") {
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	// Relative mode buckets by LOCAL calendar day, not 24h windows (bug B21):
	// today -> HH:MM, yesterday -> "Yesterday", within a week -> "Nd ago",
	// otherwise an absolute month/day.
	const daysAgo = calendarDaysBetween(now, ts);
	if (daysAgo <= 0) {
		return d.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	if (daysAgo === 1) return "Yesterday";
	if (daysAgo < 7) return `${daysAgo}d ago`;
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
};

/** Format relative time from a reference start (e.g. "+2m 30s"). */
export const formatRelTime = (t: number, start: number): string => {
	const delta = Math.max(0, t - start);
	const s = Math.floor(delta / 1000);
	if (s < 60) return `+${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `+${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `+${h}h ${m % 60}m`;
};

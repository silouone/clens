/** Format a duration in milliseconds to a short human-readable string (e.g. "3m 42s"). */
export const formatDuration = (ms: number): string => {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

/** Format a USD cost value (e.g. "$1.23" or "~$1.23" for estimated). */
export const formatCost = (usd: number, isEstimated?: boolean): string => {
	const prefix = isEstimated ? "~" : "";
	return usd < 0.01 ? "<$0.01" : `${prefix}$${usd.toFixed(2)}`;
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

/** Format a timestamp as either relative ("2d ago") or absolute ("Mar 5, 14:32") based on mode. */
export const formatDate = (ts: number, mode: "relative" | "absolute"): string => {
	const d = new Date(ts);
	if (mode === "absolute") {
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffDays = Math.floor(diffMs / 86_400_000);
	if (diffDays === 0) {
		return d.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return `${diffDays}d ago`;
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

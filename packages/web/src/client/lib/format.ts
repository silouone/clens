/** Format a duration in milliseconds to a short human-readable string (e.g. "3m 42s"). */
export const formatDuration = (ms: number): string => {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

/** Format a USD cost value (e.g. "$1.23" or "<$0.01"). */
export const formatCost = (usd: number): string =>
	usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;

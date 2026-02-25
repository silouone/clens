import { green, red, yellow } from "./shared";

/**
 * Format milliseconds as "Xm Xs" or "Xs" for short durations.
 */
export const fmtDuration = (ms: number): string => {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0
		? `${minutes}m${seconds > 0 ? `${String(seconds).padStart(2, "0")}s` : ""}`
		: `${seconds}s`;
};

/**
 * Format epoch ms as HH:MM:SS local time.
 */
export const fmtTime = (t: number): string => {
	const d = new Date(t);
	return [d.getHours(), d.getMinutes(), d.getSeconds()]
		.map((n) => String(n).padStart(2, "0"))
		.join(":");
};

/**
 * Truncate a string to maxLen, appending "..." if truncated.
 */
export const truncate = (s: string, maxLen: number): string =>
	s.length <= maxLen ? s : `${s.slice(0, maxLen - 3)}...`;

/**
 * Color a drift score: green (<0.3), yellow (<0.7), red (>=0.7).
 */
export const colorDrift = (score: number): string => {
	const formatted = score.toFixed(2);
	if (score < 0.3) return green(formatted);
	if (score < 0.7) return yellow(formatted);
	return red(formatted);
};

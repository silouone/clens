import type { BacktrackResult, DistilledSession } from "../types/distill";
import { fmtDuration, fmtTime, truncate } from "./format-helpers";
import { bold, cyan, dim, green, red, yellow } from "./shared";

/**
 * Compute total backtrack time in ms from an array of backtracks.
 */
const totalBacktrackMs = (backtracks: readonly BacktrackResult[]): number =>
	backtracks.reduce((sum, bt) => sum + (bt.end_t - bt.start_t), 0);

/**
 * Classify severity based on backtrack count and time percentage.
 */
const classifySeverity = (
	count: number,
	timePercent: number,
): { label: string; color: (s: string) => string } =>
	count >= 5 || timePercent > 25
		? { label: "HIGH", color: red }
		: count >= 3 || timePercent > 10
			? { label: "MEDIUM", color: yellow }
			: { label: "LOW", color: green };

/**
 * Human-readable label for backtrack types.
 */
const typeLabel = (type: BacktrackResult["type"]): string =>
	type === "failure_retry"
		? "Failure Retry"
		: type === "iteration_struggle"
			? "Iteration Struggle"
			: "Debugging Loop";

/**
 * Color a backtrack type label.
 */
const colorType = (type: BacktrackResult["type"]): string =>
	type === "failure_retry"
		? red(typeLabel(type))
		: type === "iteration_struggle"
			? yellow(typeLabel(type))
			: cyan(typeLabel(type));

/**
 * Group backtracks by type and compute aggregate stats per group.
 */
const groupByType = (
	backtracks: readonly BacktrackResult[],
): readonly {
	readonly type: BacktrackResult["type"];
	readonly count: number;
	readonly totalAttempts: number;
	readonly totalMs: number;
}[] => {
	const types = ["failure_retry", "iteration_struggle", "debugging_loop"] as const;
	return types
		.map((type) => {
			const matching = backtracks.filter((bt) => bt.type === type);
			return {
				type,
				count: matching.length,
				totalAttempts: matching.reduce((sum, bt) => sum + bt.attempts, 0),
				totalMs: matching.reduce((sum, bt) => sum + (bt.end_t - bt.start_t), 0),
			};
		})
		.filter((g) => g.count > 0);
};

/**
 * Find files appearing in 2+ backtracks (hot files).
 */
const findHotFiles = (
	backtracks: readonly BacktrackResult[],
): readonly { readonly file: string; readonly count: number }[] => {
	const initial: Record<string, number> = {};
	const fileCounts = backtracks
		.filter((bt): bt is BacktrackResult & { file_path: string } => bt.file_path !== undefined)
		.reduce(
			(acc, bt) => ({
				...acc,
				[bt.file_path]: (acc[bt.file_path] ?? 0) + 1,
			}),
			initial,
		);

	return Object.entries(fileCounts)
		.filter(([, count]) => count >= 2)
		.map(([file, count]) => ({ file, count }))
		.sort((a, b) => b.count - a.count);
};

/**
 * Find the costliest backtrack (highest attempt count).
 */
const findCostliest = (
	backtracks: readonly BacktrackResult[],
): BacktrackResult | undefined =>
	backtracks.length === 0
		? undefined
		: backtracks.reduce((worst, bt) => (bt.attempts > worst.attempts ? bt : worst));

/**
 * Render a summary of backtrack analysis from a distilled session.
 */
export const renderBacktracksSummary = (distilled: DistilledSession): string => {
	const { backtracks, stats } = distilled;
	const sessionPrefix = distilled.session_id.slice(0, 8);
	const btTimeMs = totalBacktrackMs(backtracks);
	const timePercent = stats.duration_ms > 0 ? (btTimeMs / stats.duration_ms) * 100 : 0;
	const severity = classifySeverity(backtracks.length, timePercent);

	const header = bold(`Session ${sessionPrefix} -- Backtrack Analysis`);
	const severityLine = `Severity: ${severity.color(severity.label)} (${backtracks.length} backtracks, ${timePercent.toFixed(1)}% of session time)`;

	// Type breakdown
	const groups = groupByType(backtracks);
	const breakdownHeader = bold("Breakdown by type:");
	const breakdownLines = groups.map(
		(g) =>
			`  ${colorType(g.type)}: ${g.count} occurrences, ${g.totalAttempts} total attempts, ${fmtDuration(g.totalMs)}`,
	);

	// Hot files
	const hotFiles = findHotFiles(backtracks);
	const hotFilesSection =
		hotFiles.length > 0
			? [
					bold("Hot files (2+ backtracks):"),
					...hotFiles.map((hf) => `  ${hf.file} ${dim(`(${hf.count}x)`)}`),
				]
			: [];

	// Costliest backtrack
	const costliest = findCostliest(backtracks);
	const costliestSection = costliest
		? [
				bold("Costliest backtrack:"),
				`  ${colorType(costliest.type)} on ${costliest.tool_name} -- ${costliest.attempts} attempts`,
				...(costliest.error_message
					? [`  ${dim(`Error: "${truncate(costliest.error_message, 80)}"`)}`]
					: []),
			]
		: [];

	// Time summary
	const timeSummary = `${fmtDuration(btTimeMs)} spent backtracking out of ${fmtDuration(stats.duration_ms)} total (${timePercent.toFixed(1)}%)`;

	return [
		header,
		"",
		severityLine,
		"",
		breakdownHeader,
		...breakdownLines,
		...(hotFilesSection.length > 0 ? ["", ...hotFilesSection] : []),
		...(costliestSection.length > 0 ? ["", ...costliestSection] : []),
		"",
		timeSummary,
	].join("\n");
};

/**
 * Render a single backtrack detail block.
 */
const renderSingleBacktrack = (bt: BacktrackResult, index: number): string => {
	const durationMs = bt.end_t - bt.start_t;
	const lines = [
		`${bold(`#${index + 1}`)} ${colorType(bt.type)}`,
		`  Tool:       ${bt.tool_name}`,
		...(bt.file_path ? [`  File:       ${bt.file_path}`] : []),
		`  Attempts:   ${bt.attempts}`,
		`  Duration:   ${fmtDuration(durationMs)}`,
		`  Time:       ${fmtTime(bt.start_t)} - ${fmtTime(bt.end_t)}`,
		...(bt.error_message ? [`  Error:      ${truncate(bt.error_message, 120)}`] : []),
		...(bt.command ? [`  Command:    ${truncate(bt.command, 120)}`] : []),
		`  Tool calls: ${bt.tool_use_ids.length}`,
	];
	return lines.join("\n");
};

/**
 * Render per-backtrack detail view from a distilled session.
 */
export const renderBacktracksDetail = (distilled: DistilledSession): string => {
	const { backtracks } = distilled;
	const sessionPrefix = distilled.session_id.slice(0, 8);

	const header = bold(`Session ${sessionPrefix} -- ${backtracks.length} Backtracks (Detail)`);
	const separator = dim("---");

	const blocks = backtracks.map((bt, i) => renderSingleBacktrack(bt, i));
	const joined = blocks.reduce<readonly string[]>(
		(acc, block, i) => (i === 0 ? [block] : [...acc, separator, block]),
		[],
	);

	return [header, "", ...joined].join("\n");
};


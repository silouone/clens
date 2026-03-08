import { mkdirSync, writeFileSync } from "node:fs";
import type { BacktrackResult, CostEstimate, DistilledSession } from "../types/distill";
import { fmtDuration } from "./format-helpers";
import { bold, cyan, dim, green, red, yellow } from "./shared";

const BACKTRACK_LABELS: Readonly<Record<BacktrackResult["type"], string>> = {
	debugging_loop: "debugging loop",
	failure_retry: "failure retry",
	iteration_struggle: "iteration struggle",
} as const;

/** Group backtracks by type and produce "N type_label" fragments. */
const backtrackBreakdown = (backtracks: readonly BacktrackResult[]): string => {
	const counts = backtracks.reduce<Readonly<Record<string, number>>>(
		(acc, b) => ({ ...acc, [b.type]: (acc[b.type] ?? 0) + 1 }),
		{},
	);
	return Object.entries(counts)
		.map(([type, count]) => `${count} ${BACKTRACK_LABELS[type as BacktrackResult["type"]] ?? type}${count !== 1 ? "s" : ""}`)
		.join(", ");
};

/** Format cost line: "$0.43 (claude-sonnet-4-6)" or "~$0.43 (rough estimate)" */
const formatCost = (ce: CostEstimate): string => {
	const prefix = ce.is_estimated ? "~" : "";
	const suffix = ce.is_estimated ? " (rough estimate)" : ` (${ce.model})`;
	return `${prefix}$${ce.estimated_cost_usd.toFixed(2)}${suffix}`;
};

/** Pad a label to a fixed width for two-column alignment. */
const metricLine = (label: string, value: string, width: number = 13): string =>
	`  ${label.padEnd(width)}${value}`;

/** Build structured narrative lines from distilled data. */
const buildNarrative = (result: DistilledSession): readonly string[] => {
	const { stats, backtracks, summary } = result;

	// Line 1: duration, active time, model, tool calls
	const activeDurMs = summary?.key_metrics?.active_duration_ms;
	const model = stats.model ?? stats.cost_estimate?.model;
	const durationPart = activeDurMs
		? `${fmtDuration(stats.duration_ms)} session (${fmtDuration(activeDurMs)} active)`
		: `${fmtDuration(stats.duration_ms)} session`;
	const modelPart = model ? ` using ${model}` : "";
	const line1 = `A ${durationPart}${modelPart} with ${stats.tool_call_count} tool calls.`;

	// Line 2: phases
	const phaseNames = summary?.phases?.map((p) => p.name) ?? [];
	const line2 = phaseNames.length > 0
		? `${phaseNames.length} phase${phaseNames.length === 1 ? "" : "s"}: ${phaseNames.join(", ")}.`
		: undefined;

	// Line 3: primary tools + files modified
	const topTools = Object.entries(stats.tools_by_name)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([name]) => name);
	const filesModified = summary?.key_metrics?.files_modified ?? stats.unique_files.length;
	const toolsPart = topTools.length > 0 ? `Primary tools: ${topTools.join(", ")}.` : "";
	const filesPart = `${filesModified} file${filesModified === 1 ? "" : "s"} modified.`;
	const line3 = toolsPart ? `${toolsPart} ${filesPart}` : filesPart;

	// Line 4: backtracks + failure rate
	const failRate = (stats.failure_rate * 100).toFixed(1);
	const line4 = backtracks.length > 0
		? `${backtracks.length} backtrack${backtracks.length === 1 ? "" : "s"} (${backtrackBreakdown(backtracks)}). Failure rate: ${failRate}%.`
		: `No backtracks. Failure rate: ${failRate}%.`;

	return [`  ${line1}`, ...(line2 ? [`  ${line2}`] : []), `  ${line3}`, `  ${line4}`];
};

/** Build the two-column metrics block. */
const buildMetrics = (result: DistilledSession): readonly string[] => {
	const ce = result.cost_estimate ?? result.stats.cost_estimate;
	const timelineCount = result.timeline?.length;

	const leftCol = [
		metricLine("Backtracks:", String(result.backtracks.length)),
		metricLine("Files:", String(result.file_map.files.length)),
		metricLine("User msgs:", String(result.user_messages.length)),
		metricLine("Cost:", ce ? formatCost(ce) : "n/a"),
	];

	const rightCol = [
		`Decisions: ${result.decisions.length}`,
		`Reasoning: ${result.reasoning.length} blocks`,
		`Timeline:  ${timelineCount ?? "n/a"} entries`,
	];

	// Merge columns side by side
	const colWidth = 28;
	return leftCol.map((left, i) => {
		const right = rightCol[i];
		const stripped = left.replace(/\x1b\[[0-9;]*m/g, "");
		const padding = Math.max(0, colWidth - stripped.length);
		return right ? `${left}${" ".repeat(padding)}${right}` : left;
	});
};

/** Build optional team line. */
const buildTeamLine = (result: DistilledSession): readonly string[] => {
	if (!result.team_metrics) return [];
	const tm = result.team_metrics;
	return [metricLine("Team:", `${tm.agent_count} agents, ${tm.task_completed_count} tasks completed`)];
};

/** Build optional drift line. */
const buildDriftLine = (result: DistilledSession): readonly string[] => {
	if (!result.plan_drift) return [];
	const pd = result.plan_drift;
	const score = pd.drift_score;
	const colorFn = score < 0.3 ? green : score < 0.7 ? yellow : red;
	return [colorFn(metricLine("Drift:", `${score.toFixed(2)} (${pd.spec_path}: ${pd.expected_files.length} expected, ${pd.actual_files.length} actual)`))];
};

export const distillCommand = async (args: {
	readonly sessionId: string;
	readonly projectDir: string;
	readonly deep: boolean;
	readonly json: boolean;
}): Promise<void> => {
	const { distill } = await import("../distill/index");
	const result = await distill(args.sessionId, args.projectDir, { deep: args.deep });

	// Save distilled result to disk
	const distilledDir = `${args.projectDir}/.clens/distilled`;
	mkdirSync(distilledDir, { recursive: true });
	writeFileSync(`${distilledDir}/${args.sessionId}.json`, JSON.stringify(result, null, 2));

	if (args.json) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const sessionPrefix = args.sessionId.slice(0, 8);
	const header = bold(`Distilled session ${cyan(sessionPrefix)}`);
	const narrative = buildNarrative(result);
	const metrics = buildMetrics(result);
	const teamLine = buildTeamLine(result);
	const driftLine = buildDriftLine(result);
	const savedLine = dim(`  Saved to: .clens/distilled/${sessionPrefix}.json`);

	const output = [
		header,
		"",
		...narrative,
		"",
		...metrics.map(dim),
		...teamLine.map(dim),
		...driftLine,
		"",
		savedLine,
	].join("\n");

	console.log(output);
};

import type {
	AgentSpawnDecision,
	DecisionPoint,
	DistilledSession,
	PhaseBoundaryDecision,
	TaskCompletionDecision,
	TaskDelegationDecision,
	TimingGapDecision,
	ToolPivotDecision,
} from "../types/distill";
import { fmtDuration, fmtTime } from "./format-helpers";
import { bold, cyan, dim, green, red, yellow } from "./shared";

/**
 * Color a timing gap classification label.
 */
const colorClassification = (classification: TimingGapDecision["classification"]): string => {
	if (classification === "user_idle") return yellow(classification);
	if (classification === "session_pause") return red(classification);
	return cyan(classification);
};

/**
 * Render the timing gaps section.
 */
const renderTimingGaps = (gaps: readonly TimingGapDecision[]): readonly string[] => {
	if (gaps.length === 0) return [dim("  (none)")];

	const gapLines = gaps.map(
		(g) => `  ${fmtTime(g.t)}  ${colorClassification(g.classification)}  ${dim(fmtDuration(g.gap_ms))}`,
	);

	const countsByClassification = gaps.reduce<Record<string, number>>(
		(acc, g) => ({ ...acc, [g.classification]: (acc[g.classification] ?? 0) + 1 }),
		{},
	);
	const summaryParts = Object.entries(countsByClassification)
		.map(([key, count]) => `${key}: ${count}`)
		.join(", ");

	return [...gapLines, "", dim(`  Summary: ${summaryParts}`)];
};

/**
 * Render the tool pivots section.
 */
const renderToolPivots = (pivots: readonly ToolPivotDecision[]): readonly string[] => {
	if (pivots.length === 0) return [dim("  (none)")];

	const pivotLines = pivots.map(
		(p) =>
			`  ${fmtTime(p.t)}  ${p.from_tool} ${dim("->")} ${p.to_tool}${p.after_failure ? `  ${red("after failure")}` : ""}`,
	);

	const afterFailureCount = pivots.filter((p) => p.after_failure).length;
	const summaryLine = `  Summary: ${pivots.length} pivots, ${afterFailureCount} after failure`;

	return [...pivotLines, "", dim(summaryLine)];
};

/**
 * Render the phase boundaries section.
 */
const renderPhaseBoundaries = (phases: readonly PhaseBoundaryDecision[]): readonly string[] => {
	if (phases.length === 0) return [dim("  (none)")];

	return phases.map(
		(p) => `  ${dim(`[${p.phase_index}]`)}  ${p.phase_name}  ${dim(fmtTime(p.t))}`,
	);
};

/**
 * Render the agent spawns section.
 */
const renderAgentSpawns = (spawns: readonly AgentSpawnDecision[]): readonly string[] => {
	if (spawns.length === 0) return [dim("  (none)")];

	const spawnLines = spawns.map(
		(s) => `  ${fmtTime(s.t)}  ${cyan(s.agent_name)} ${dim(`(${s.agent_type})`)}  ${dim(s.agent_id.slice(0, 8))}`,
	);

	return [...spawnLines, "", dim(`  Summary: ${spawns.length} agent${spawns.length !== 1 ? "s" : ""} spawned`)];
};

/**
 * Render the task delegations section.
 */
const renderTaskDelegations = (delegations: readonly TaskDelegationDecision[]): readonly string[] => {
	if (delegations.length === 0) return [dim("  (none)")];

	const delegationLines = delegations.map(
		(d) => `  ${fmtTime(d.t)}  ${green(d.agent_name)}  ${d.subject ?? dim(d.task_id)}`,
	);

	const uniqueAgents = [...new Set(delegations.map((d) => d.agent_name))];
	return [
		...delegationLines,
		"",
		dim(`  Summary: ${delegations.length} delegation${delegations.length !== 1 ? "s" : ""} to ${uniqueAgents.length} agent${uniqueAgents.length !== 1 ? "s" : ""}`),
	];
};

/**
 * Render the task completions section.
 */
const renderTaskCompletions = (completions: readonly TaskCompletionDecision[]): readonly string[] => {
	if (completions.length === 0) return [dim("  (none)")];

	const completionLines = completions.map(
		(c) => `  ${fmtTime(c.t)}  ${green(c.agent_name)}  ${c.subject ?? dim(c.task_id)}`,
	);

	return [
		...completionLines,
		"",
		dim(`  Summary: ${completions.length} task${completions.length !== 1 ? "s" : ""} completed`),
	];
};

/**
 * Partition decisions into typed arrays by discriminated union type field.
 */
const partitionDecisions = (
	decisions: readonly DecisionPoint[],
): {
	readonly timingGaps: readonly TimingGapDecision[];
	readonly toolPivots: readonly ToolPivotDecision[];
	readonly phaseBoundaries: readonly PhaseBoundaryDecision[];
	readonly agentSpawns: readonly AgentSpawnDecision[];
	readonly taskDelegations: readonly TaskDelegationDecision[];
	readonly taskCompletions: readonly TaskCompletionDecision[];
} => ({
	timingGaps: decisions.filter((d): d is TimingGapDecision => d.type === "timing_gap"),
	toolPivots: decisions.filter((d): d is ToolPivotDecision => d.type === "tool_pivot"),
	phaseBoundaries: decisions.filter((d): d is PhaseBoundaryDecision => d.type === "phase_boundary"),
	agentSpawns: decisions.filter((d): d is AgentSpawnDecision => d.type === "agent_spawn"),
	taskDelegations: decisions.filter((d): d is TaskDelegationDecision => d.type === "task_delegation"),
	taskCompletions: decisions.filter((d): d is TaskCompletionDecision => d.type === "task_completion"),
});

/**
 * Render the active time vs wall clock header section.
 */
const renderTimeSection = (distilled: DistilledSession): readonly string[] => {
	const wallClock = distilled.summary?.key_metrics.duration_human ?? fmtDuration(distilled.stats.duration_ms);
	const activeTime = distilled.summary?.key_metrics.active_duration_human;
	const activeDurationMs = distilled.summary?.key_metrics.active_duration_ms;
	const durationMs = distilled.stats.duration_ms;

	const wallClockLine = `  Wall clock:  ${wallClock}`;
	const activeTimeLine = activeTime ? `  Active time: ${activeTime}` : undefined;
	const utilizationLine =
		activeDurationMs !== undefined && durationMs > 0
			? `  Utilization: ${((activeDurationMs / durationMs) * 100).toFixed(1)}%`
			: undefined;

	return [wallClockLine, activeTimeLine, utilizationLine].filter(
		(line): line is string => line !== undefined,
	);
};

/**
 * Render a complete decisions summary for a distilled session.
 */
export const renderDecisionsSummary = (distilled: DistilledSession): string => {
	const sessionPrefix = distilled.session_id.slice(0, 8);
	const decisions = distilled.decisions;
	const { timingGaps, toolPivots, phaseBoundaries, agentSpawns, taskDelegations, taskCompletions } = partitionDecisions(decisions);

	const header = bold(`Session ${sessionPrefix} -- ${decisions.length} decision points`);

	const timeSection = renderTimeSection(distilled);

	const timingHeader = bold("Timing Gaps") + dim(` (${timingGaps.length})`);
	const timingLines = renderTimingGaps(timingGaps);

	const pivotHeader = bold("Tool Pivots") + dim(` (${toolPivots.length})`);
	const pivotLines = renderToolPivots(toolPivots);

	const phaseHeader = bold("Phase Boundaries") + dim(` (${phaseBoundaries.length})`);
	const phaseLines = renderPhaseBoundaries(phaseBoundaries);

	const agentSections: readonly string[] = agentSpawns.length > 0 || taskDelegations.length > 0 || taskCompletions.length > 0
		? [
				"",
				bold("Agent Spawns") + dim(` (${agentSpawns.length})`),
				...renderAgentSpawns(agentSpawns),
				"",
				bold("Task Delegations") + dim(` (${taskDelegations.length})`),
				...renderTaskDelegations(taskDelegations),
				"",
				bold("Task Completions") + dim(` (${taskCompletions.length})`),
				...renderTaskCompletions(taskCompletions),
			]
		: [];

	return [
		header,
		"",
		...timeSection,
		"",
		timingHeader,
		...timingLines,
		"",
		pivotHeader,
		...pivotLines,
		"",
		phaseHeader,
		...phaseLines,
		...agentSections,
	].join("\n");
};


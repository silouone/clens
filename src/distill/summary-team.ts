import type { AgentNode, StatsResult, TeamMetrics } from "../types";

// --- Team narrative generation ---

export const buildTeamSentence = (
	team_metrics: TeamMetrics,
	agents?: readonly AgentNode[],
	stats?: StatsResult,
): string => {
	// Enhanced narrative when agents data is available
	if (agents && agents.length > 0) {
		const typeBreakdown = agents.reduce(
			(acc, a) => {
				const type = a.agent_type ?? "unknown";
				return { ...acc, [type]: (acc[type] ?? 0) + 1 };
			},
			{} as Record<string, number>,
		);
		const typeStr = Object.entries(typeBreakdown)
			.sort((a, b) => b[1] - a[1])
			.map(([type, count]) => `${count} ${type}`)
			.join(", ");

		const topContributors = [...agents]
			.sort((a, b) => b.tool_call_count - a.tool_call_count)
			.slice(0, 3)
			.map((a) => `${a.agent_name ?? a.agent_type} (${a.session_id.slice(0, 8)})`)
			.join(", ");

		const base = ` Team session coordinating ${team_metrics.agent_count} agents (${typeStr}) across ${team_metrics.task_completed_count} tasks.`;
		const contributors = topContributors ? ` Top contributors: ${topContributors}.` : "";

		const failureEntries =
			stats?.failures_by_tool && Object.keys(stats.failures_by_tool).length > 0
				? Object.entries(stats.failures_by_tool)
						.sort((a, b) => b[1] - a[1])
						.map(([tool, count]) => `${tool} (${count})`)
						.join(", ")
				: undefined;
		const failurePart = failureEntries
			? ` ${stats?.failure_count} failures concentrated in ${failureEntries}.`
			: "";

		const utilization =
			team_metrics.utilization_ratio !== undefined
				? ` Average utilization: ${Math.round(team_metrics.utilization_ratio * 100)}%.`
				: "";

		return `${base}${contributors}${failurePart}${utilization}`;
	}

	// Fallback: basic team sentence
	const base = ` Team session with ${team_metrics.agent_count} agents. ${team_metrics.task_completed_count} tasks completed across ${team_metrics.idle_event_count} idle transitions.`;
	const utilization =
		team_metrics.utilization_ratio !== undefined
			? ` Average utilization: ${Math.round(team_metrics.utilization_ratio * 100)}%.`
			: "";
	return `${base}${utilization}`;
};

// --- Top errors extraction ---

export const extractTopErrors = (
	stats: StatsResult,
	events?: readonly { event: string; data: Record<string, unknown> }[],
): readonly { tool_name: string; count: number; sample_message?: string }[] => {
	if (!stats.failures_by_tool) return [];

	const sorted = Object.entries(stats.failures_by_tool)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);

	return sorted.map(([tool_name, count]) => {
		const sampleEvent = events?.find(
			(e) => e.event === "PostToolUseFailure" && e.data.tool_name === tool_name,
		);
		const sample_message =
			sampleEvent && typeof sampleEvent.data.error === "string"
				? sampleEvent.data.error.slice(0, 200)
				: undefined;

		return { tool_name, count, ...(sample_message ? { sample_message } : {}) };
	});
};

// --- Agent workload extraction ---

const sumChildToolCalls = (agent: AgentNode): number =>
	(agent.children ?? []).reduce(
		(sum, child) => sum + child.tool_call_count + sumChildToolCalls(child),
		0,
	);

const estimateToolCalls = (agent: AgentNode): number =>
	agent.tool_call_count > 0
		? agent.tool_call_count
		: sumChildToolCalls(agent);

export const extractAgentWorkload = (
	agents: readonly AgentNode[],
): readonly { name: string; id: string; tool_calls: number; files_modified: number; duration_ms: number }[] =>
	agents.map((a) => ({
		name: a.agent_name ?? a.agent_type,
		id: a.session_id.slice(0, 8),
		tool_calls: estimateToolCalls(a),
		files_modified: a.file_map
			? a.file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length
			: 0,
		duration_ms: a.duration_ms,
	}));


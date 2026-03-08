import { readdirSync } from "node:fs";
import { readDistilled } from "../session/read";
import type { AgentNode, DistilledSession } from "../types";
import { flattenAgents, formatDuration } from "../utils";

const findAgentByTypeIndex = (
	all: readonly AgentNode[],
	agentId: string,
): AgentNode | undefined => {
	const typeMatch = agentId.match(/^(.+)-(\d+)$/);
	if (!typeMatch) return undefined;
	const agentType = typeMatch[1];
	const index = Number(typeMatch[2]) - 1;
	const ofType = all.filter((a) => a.agent_type === agentType);
	return index >= 0 && index < ofType.length ? ofType[index] : undefined;
};

const findAgent = (agents: readonly AgentNode[], agentId: string): AgentNode | undefined => {
	const all = flattenAgents(agents);
	// Try exact match on agent_name first, then session_id, then partial match
	const directMatch =
		all.find((a) => a.agent_name === agentId) ??
		all.find((a) => a.session_id === agentId) ??
		all.find((a) => a.agent_name?.includes(agentId) || a.session_id.startsWith(agentId));
	if (directMatch) return directMatch;

	// Try tree display format: agent_type-session_id_prefix (e.g., "builder-a82d7f2f" or legacy "builder-a849")
	const treeFormatMatch = all.find(
		(a) => `${a.agent_type}-${a.session_id.slice(0, 8)}` === agentId
			|| `${a.agent_type}-${a.session_id.slice(0, 4)}` === agentId,
	);
	if (treeFormatMatch) return treeFormatMatch;

	// Try agent_type-N pattern (e.g., "builder-1")
	return findAgentByTypeIndex(all, agentId);
};

const formatTokenCount = (tokens: number): string => {
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
	return String(tokens);
};

const formatPercent = (part: number, total: number): string =>
	total > 0 ? `${((part / total) * 100).toFixed(1)}%` : "0.0%";

const buildTeamLeadNode = (distilled: DistilledSession): AgentNode => ({
	session_id: distilled.session_id,
	agent_type: "orchestrator",
	agent_name: "team-lead",
	duration_ms: distilled.stats.duration_ms,
	tool_call_count: distilled.stats.tool_call_count,
	children: distilled.agents ?? [],
	model: distilled.stats.model,
	stats: {
		tool_call_count: distilled.stats.tool_call_count,
		failure_count: distilled.stats.failure_count,
		tools_by_name: distilled.stats.tools_by_name,
		unique_files: distilled.stats.unique_files,
	},
	file_map: distilled.file_map,
	cost_estimate: distilled.cost_estimate,
});

const scanAllDistilledSessions = (
	agentId: string,
	projectDir: string,
): { readonly agent: AgentNode; readonly sessionId: string } | undefined => {
	const distilledDir = `${projectDir}/.clens/distilled`;
	const files = (() => {
		try {
			return readdirSync(distilledDir).filter((f) => f.endsWith(".json"));
		} catch {
			return [];
		}
	})();

	return files.reduce<{ readonly agent: AgentNode; readonly sessionId: string } | undefined>(
		(found, file) => {
			if (found) return found;
			const sid = file.replace(".json", "");
			const distilled = readDistilled(sid, projectDir);
			if (!distilled?.agents || distilled.agents.length === 0) return undefined;
			const agent = findAgent(distilled.agents, agentId);
			return agent ? { agent, sessionId: sid } : undefined;
		},
		undefined,
	);
};

export const getAgentData = (
	agentId: string,
	sessionId: string | undefined,
	projectDir: string,
): AgentNode | { readonly error: string } => {
	// If no sessionId, scan all distilled sessions
	if (sessionId === undefined) {
		const found = scanAllDistilledSessions(agentId, projectDir);
		if (found) return found.agent;

		// Check for team-lead across all sessions
		if (agentId === "team-lead") {
			return { error: "team-lead lookup requires a session ID. Use: clens agent team-lead <session-id>" };
		}

		return { error: `Agent "${agentId}" not found in any distilled session.` };
	}

	const distilled = readDistilled(sessionId, projectDir);

	if (!distilled?.agents || distilled.agents.length === 0) {
		// Handle team-lead for sessions without sub-agents
		if (agentId === "team-lead" && distilled) {
			return buildTeamLeadNode(distilled);
		}
		return {
			error: [
				`No agent data found for session ${sessionId.slice(0, 8)}.`,
				"This appears to be a single-agent session.",
				`For analysis, try: clens report ${sessionId.slice(0, 8)}`,
			].join("\n"),
		};
	}

	// Handle team-lead special case
	if (agentId === "team-lead") {
		return buildTeamLeadNode(distilled);
	}

	const agent = findAgent(distilled.agents, agentId);

	if (!agent) {
		const allAgents = flattenAgents(distilled.agents);
		const names = ["team-lead", ...allAgents.map((a) =>
			`${a.agent_name ?? a.agent_type} (${a.session_id.slice(0, 8)})`,
		)].join(", ");
		return {
			error: `Agent "${agentId}" not found in session ${sessionId.slice(0, 8)}.\nAvailable agents: ${names}`,
		};
	}

	return agent;
};

export const renderAgentReport = (
	agentId: string,
	sessionId: string | undefined,
	projectDir: string,
): string => {
	const data = getAgentData(agentId, sessionId, projectDir);

	if ("error" in data) return data.error;

	const agent = data;
	const effectiveSessionId = sessionId ?? agent.session_id;

	const lines: readonly string[] = [
		`Agent: ${agent.agent_name ?? agent.agent_type} (${agent.agent_type})`,
		`Session ID: ${agent.session_id}`,
		...(agent.model ? [`Model: ${agent.model}`] : []),
		`Duration: ${formatDuration(agent.duration_ms)}`,
		...(agent.task_prompt ? ["", "Task Prompt:", ...agent.task_prompt.split("\n").map((line) => `  ${line}`)] : []),
		"",
		...renderToolUsage(agent),
		...renderCommunication(agent),
		...renderTaskEvents(agent),
		...renderIdlePeriods(agent),
		...renderFilesModified(agent),
		...renderCostSection(agent),
		...renderTokenUsage(agent),
	];

	return lines.join("\n");
};

const renderToolUsage = (agent: AgentNode): readonly string[] => {
	const toolsByName = agent.stats?.tools_by_name;
	if (!toolsByName || Object.keys(toolsByName).length === 0) {
		return ["Tool Usage: (no stats available - run distill --deep)"];
	}

	const totalCalls = agent.stats?.tool_call_count ?? 0;
	const sorted = Object.entries(toolsByName)
		.slice()
		.sort((a, b) => b[1] - a[1]);

	return [
		"Tool Usage:",
		...sorted.map(
			([name, count]) =>
				`  ${name.padEnd(20)} ${String(count).padStart(3)} (${formatPercent(count, totalCalls)})`,
		),
		"",
	];
};

const renderFilesModified = (agent: AgentNode): readonly string[] => {
	if (!agent.file_map || agent.file_map.files.length === 0) return [];

	const filesWithActivity = agent.file_map.files
		.filter((f) => f.reads > 0 || f.edits > 0 || f.writes > 0)
		.slice()
		.sort((a, b) => b.reads + b.edits + b.writes - (a.reads + a.edits + a.writes));

	if (filesWithActivity.length === 0) return [];

	return [
		"Files Modified:",
		...filesWithActivity.slice(0, 15).map((f) => {
			const parts = [
				...(f.reads > 0 ? [`${f.reads}R`] : []),
				...(f.edits > 0 ? [`${f.edits}E`] : []),
				...(f.writes > 0 ? [`${f.writes}W`] : []),
			];
			return `  ${f.file_path.padEnd(40)} ${parts.join(" ")}`;
		}),
		...(filesWithActivity.length > 15
			? [`  ... and ${filesWithActivity.length - 15} more files`]
			: []),
		"",
	];
};

const renderCommunication = (agent: AgentNode): readonly string[] => {
	if (!agent.messages || agent.messages.length === 0) return [];

	const partners = agent.communication_partners ?? [];
	const partnerLines =
		partners.length > 0
			? [
					"Communication Partners:",
					...partners.map(
						(p) =>
							`  ${p.name.padEnd(20)} ${String(p.sent_count).padStart(2)} sent  ${String(p.received_count).padStart(2)} recv  (${p.msg_types.join(", ")})`,
					),
					"",
				]
			: [];

	const recentMessages = agent.messages.slice(-10);
	const messageLines = [
		"Recent Messages:",
		...recentMessages.map((m) => {
			const time = new Date(m.t).toLocaleTimeString();
			const arrow = m.direction === "sent" ? "->" : "<-";
			const summary = m.summary ? `: ${m.summary.slice(0, 50)}` : "";
			return `  ${time} ${arrow} ${m.partner.padEnd(16)} [${m.msg_type}]${summary}`;
		}),
		"",
	];

	return [...partnerLines, ...messageLines];
};

const renderTaskEvents = (agent: AgentNode): readonly string[] => {
	if (!agent.task_events || agent.task_events.length === 0) return [];

	return [
		"Task Activity:",
		...agent.task_events.map((te) => {
			const time = new Date(te.t).toLocaleTimeString();
			const subject = te.subject ? `: ${te.subject.slice(0, 40)}` : "";
			const owner = te.owner ? ` (${te.owner})` : "";
			return `  ${time} ${te.action.padEnd(14)} #${te.task_id}${subject}${owner}`;
		}),
		"",
	];
};

const renderIdlePeriods = (agent: AgentNode): readonly string[] => {
	if (!agent.idle_periods || agent.idle_periods.length === 0) return [];

	return [
		`Idle Periods: ${agent.idle_periods.length} transitions`,
		...agent.idle_periods.slice(0, 10).map((ip) => {
			const time = new Date(ip.t).toLocaleTimeString();
			return `  ${time} idle`;
		}),
		...(agent.idle_periods.length > 10
			? [`  ... and ${agent.idle_periods.length - 10} more`]
			: []),
		"",
	];
};

const renderCostSection = (agent: AgentNode): readonly string[] => {
	if (!agent.cost_estimate) return [];
	const ce = agent.cost_estimate;
	const prefix = ce.is_estimated ? "~" : "";
	const label = ce.is_estimated ? " (rough estimate)" : "";

	return [
		`Cost Estimate:${label}`,
		`  Input:  ${prefix}${formatTokenCount(ce.estimated_input_tokens)} tokens`,
		`  Output: ${prefix}${formatTokenCount(ce.estimated_output_tokens)} tokens`,
		`  Total:  ${prefix}$${ce.estimated_cost_usd.toFixed(2)}`,
		"",
	];
};

const renderTokenUsage = (agent: AgentNode): readonly string[] => {
	const usage = agent.stats?.token_usage;
	if (!usage) return [];

	return [
		"Token Usage (actual):",
		`  Input:  ${formatTokenCount(usage.input_tokens)} tokens`,
		`  Output: ${formatTokenCount(usage.output_tokens)} tokens`,
		...(usage.cache_read_tokens > 0
			? [`  Cache read: ${formatTokenCount(usage.cache_read_tokens)} tokens`]
			: []),
		...(usage.cache_creation_tokens > 0
			? [`  Cache create: ${formatTokenCount(usage.cache_creation_tokens)} tokens`]
			: []),
	];
};


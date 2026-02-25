import { readDistilled } from "../session/read";
import type { AgentNode, DistilledSession } from "../types";
import { flattenAgents, formatDuration } from "../utils";
import { bold, cyan, dim } from "./shared";

interface AgentRow {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly model: string;
	readonly duration: string;
	readonly calls: number;
	readonly files: number;
}

const buildTeamLeadRow = (distilled: DistilledSession): AgentRow => ({
	id: "team-lead",
	name: "team-lead",
	type: "orchestrator",
	model: distilled.stats.model ?? "-",
	duration: formatDuration(distilled.stats.duration_ms),
	calls: distilled.stats.tool_call_count,
	files: distilled.file_map?.files.filter((f) => f.edits > 0 || f.writes > 0).length ?? 0,
});

const agentToRow = (agent: AgentNode): AgentRow => {
	const filesCount = agent.file_map
		? agent.file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length
		: 0;
	return {
		id: agent.session_id.slice(0, 8),
		name: agent.agent_name ?? agent.agent_type,
		type: agent.agent_type,
		model: agent.model ?? "-",
		duration: formatDuration(agent.duration_ms),
		calls: agent.stats?.tool_call_count ?? agent.tool_call_count,
		files: filesCount,
	};
};

const renderAgentsTable = (sessionId: string, rows: readonly AgentRow[]): string => {
	const header = bold(`Agents for session ${sessionId.slice(0, 8)}`);
	const separator = "\u2500".repeat(header.length + 10);

	// Compute dynamic column widths from actual content
	const nameW = Math.max(4, ...rows.map((r) => r.name.length)) + 2;
	const typeW = Math.max(4, ...rows.map((r) => r.type.length)) + 2;
	const modelW = Math.max(5, ...rows.map((r) => r.model.length)) + 2;

	const colHeader = dim(
		[
			"ID".padEnd(12),
			"Name".padEnd(nameW),
			"Type".padEnd(typeW),
			"Model".padEnd(modelW),
			"Duration".padEnd(10),
			"Calls".padEnd(8),
			"Files",
		].join(""),
	);

	const rowLines = rows.map((r) =>
		[
			cyan(r.id.padEnd(12)),
			r.name.padEnd(nameW),
			r.type.padEnd(typeW),
			r.model.slice(0, modelW - 2).padEnd(modelW),
			r.duration.padEnd(10),
			String(r.calls).padEnd(8),
			String(r.files),
		].join(""),
	);

	return [header, separator, colHeader, ...rowLines].join("\n");
};

export const getAgentsData = (
	sessionId: string,
	projectDir: string,
): readonly AgentRow[] | { readonly error: string } => {
	const distilled = readDistilled(sessionId, projectDir);

	if (!distilled) {
		return {
			error: `No distilled data for session ${sessionId.slice(0, 8)}. Run 'clens distill ${sessionId.slice(0, 8)}' first.`,
		};
	}

	const teamLead = buildTeamLeadRow(distilled);
	const agents = distilled.agents ? flattenAgents(distilled.agents).map(agentToRow) : [];

	return [teamLead, ...agents];
};

export const agentsCommand = async (args: {
	readonly sessionId: string;
	readonly projectDir: string;
	readonly json: boolean;
	readonly agentId?: string;
	readonly comms?: boolean;
}): Promise<void> => {
	// --comms: communication timeline
	if (args.comms) {
		const { getMessagesData, renderMessages } = await import("./messages");
		if (args.json) {
			console.log(JSON.stringify(getMessagesData(args.sessionId, args.projectDir), null, 2));
			return;
		}
		console.log(renderMessages(args.sessionId, args.projectDir));
		return;
	}

	// Agent drill-down: delegate to agent.ts helpers
	if (args.agentId) {
		const { getAgentData, renderAgentReport } = await import("./agent");
		if (args.json) {
			console.log(
				JSON.stringify(getAgentData(args.agentId, args.sessionId, args.projectDir), null, 2),
			);
			return;
		}
		console.log(renderAgentReport(args.agentId, args.sessionId, args.projectDir));
		return;
	}

	// Table view
	const data = getAgentsData(args.sessionId, args.projectDir);

	if ("error" in data) {
		if (args.json) {
			console.log(JSON.stringify(data, null, 2));
			return;
		}
		console.log(data.error);
		return;
	}

	// Solo session: only the team-lead row, no subagents
	if (data.length <= 1) {
		if (args.json) {
			console.log(JSON.stringify({ solo: true, message: "Solo session (no subagents)." }));
			return;
		}
		console.log("Solo session (no subagents).");
		return;
	}

	if (args.json) {
		console.log(JSON.stringify(data, null, 2));
		return;
	}

	console.log(renderAgentsTable(args.sessionId, data));
};

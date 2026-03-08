import type { AgentNode, EditChain, SessionSummary } from "../types";
import {
	flattenAgents,
	formatDuration,
	formatSessionDate,
	sanitizeAgentName,
} from "../utils";
import {
	ansi,
	formatAttributedDiff,
	formatEditDetail,
	formatGitDiffSection,
	groupFilesByAgent,
	groupFilesByDirectory,
} from "./tui-formatters";
import type { TuiState } from "./tui-state";
import { CONTENT_SCROLL_TABS, getEditsFileList } from "./tui-state";
import {
	collapseConsecutive,
	formatBacktracksTab,
	formatCommsTab,
	formatDecisionsTabFull,
	formatDriftTab,
	formatGraphTab,
	formatOverviewTab,
	formatReasoningTab,
	formatTimelineTab,
} from "./tui-tabs";

// --- Row formatters (pure, testable) ---

export const formatSessionRow = (
	session: SessionSummary,
	selected: boolean,
	width: number,
): string => {
	const shortId = session.session_id.slice(0, 8);
	const nameLabel = session.session_name
		? `${session.session_name.slice(0, 20)} | ${shortId}`
		: shortId;
	const id = nameLabel.slice(0, 30);
	const started = formatSessionDate(session.start_time);
	const branch = (session.git_branch ?? "-").slice(0, 14);
	const team = (session.team_name ?? "-").slice(0, 10);
	const agentCount = session.agent_count ?? 0;
	const type = agentCount > 0 ? `multi(${agentCount})` : "solo";
	const distillMark = session.is_distilled ? "\u2713" : "-";
	const dur = formatDuration(session.duration_ms);
	const events = String(session.event_count);
	const status = session.status === "complete" ? "complete" : "incomplete";

	const plain =
		`${id.padEnd(32)}${started.padEnd(14)}${branch.padEnd(16)}${team.padEnd(12)}${type.padEnd(10)}${distillMark.padEnd(3)}${dur.padEnd(10)}${events.padEnd(8)}${status}`.slice(
			0,
			width,
		);

	if (selected) {
		return ansi.inverse(plain.padEnd(width));
	}
	return plain;
};

export const formatAgentRow = (
	agent: AgentNode,
	selected: boolean,
	width: number,
	labelWidth?: number,
): string => {
	const label = `${agent.agent_name ?? agent.agent_type} (${agent.session_id.slice(0, 8)})`;
	const maxLabelLen = labelWidth ?? Math.min(label.length, Math.floor(width * 0.35));
	const truncLabel =
		label.length > maxLabelLen ? `${label.slice(0, maxLabelLen - 1)}\u2026` : label;

	const dur = formatDuration(agent.duration_ms).padEnd(8);
	const tools = String(agent.tool_call_count).padEnd(8);
	const filesCount = agent.file_map
		? agent.file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length
		: 0;
	const files = String(filesCount).padEnd(8);
	const cost = agent.cost_estimate ? `$${agent.cost_estimate.estimated_cost_usd.toFixed(2)}` : "-";
	const row = `${truncLabel.padEnd(maxLabelLen + 2)}${dur}${tools}${files}${cost}`;
	const trimmed = row.slice(0, width);
	return selected ? ansi.inverse(trimmed.padEnd(width)) : trimmed;
};

export const formatAgentDetail = (agent: AgentNode): readonly string[] => {
	const header = [
		ansi.bold(`Agent: ${agent.agent_name ?? agent.agent_type} (${agent.session_id.slice(0, 8)})`),
		`Type: ${agent.agent_type}`,
		`Session ID: ${agent.session_id}`,
		...(agent.model ? [`Model: ${agent.model}`] : []),
		`Duration: ${formatDuration(agent.duration_ms)}`,
		"",
	];

	const taskPromptSection = agent.task_prompt
		? [
				ansi.bold("Task Prompt:"),
				...agent.task_prompt.split("\n").map((line: string) => `  ${line}`),
				"",
			]
		: [];

	const toolSection = (() => {
		const stats = agent.stats;
		if (!stats) return [];
		const totalCalls = stats.tool_call_count;
		return [
			ansi.bold("Tool Usage:"),
			...Object.entries(stats.tools_by_name)
				.slice()
				.sort((a, b) => b[1] - a[1])
				.map(([name, count]) => {
					const pct = totalCalls > 0 ? ((count / totalCalls) * 100).toFixed(1) : "0.0";
					return `  ${name.padEnd(20)} ${String(count).padStart(3)} (${pct}%)`;
				}),
			"",
		];
	})();

	const fileSection =
		agent.file_map && agent.file_map.files.length > 0
			? [
					ansi.bold("Files:"),
					...agent.file_map.files
						.filter((f) => f.reads > 0 || f.edits > 0)
						.map((f) => {
							const parts = [
								...(f.reads > 0 ? [`${f.reads}R`] : []),
								...(f.edits > 0 ? [`${f.edits}E`] : []),
								...(f.writes > 0 ? [`${f.writes}W`] : []),
							];
							return `  ${f.file_path.padEnd(35)} ${parts.join(" ")}`;
						}),
					"",
				]
			: [];

	const tokenSection = (() => {
		const usage = agent.stats?.token_usage;
		if (!usage) return [];
		const totalInput = usage.input_tokens + usage.cache_read_tokens;
		return [
			ansi.bold("Token Usage:"),
			`  Input: ${totalInput.toLocaleString()} total${usage.cache_read_tokens > 0 ? ` (${usage.cache_read_tokens.toLocaleString()} cached, ${usage.input_tokens.toLocaleString()} uncached)` : ""}`,
			`  Output: ${usage.output_tokens.toLocaleString()}`,
			...(usage.cache_creation_tokens > 0
				? [`  Cache creation: ${usage.cache_creation_tokens.toLocaleString()}`]
				: []),
			"",
		];
	})();

	const partnersSection =
		agent.communication_partners && agent.communication_partners.length > 0
			? [
					ansi.bold("Communication Partners:"),
					...agent.communication_partners.map((p) => {
						const types = p.msg_types.join(", ");
						return `  ${p.name.padEnd(18)} sent: ${String(p.sent_count).padStart(2)}  recv: ${String(p.received_count).padStart(2)}  [${types}]`;
					}),
					"",
				]
			: [];

	const messagesSection =
		agent.messages && agent.messages.length > 0
			? (() => {
					const recent = [...agent.messages].sort((a, b) => b.t - a.t).slice(0, 5);
					return [
						ansi.bold("Recent Messages:"),
						...recent.map((m) => {
							const time = new Date(m.t).toLocaleTimeString();
							const arrow = m.direction === "sent" ? "->" : "<-";
							const summary = m.summary ? `: ${m.summary}` : "";
							return `  ${ansi.dim(time)} ${arrow} ${m.partner.padEnd(14)} [${m.msg_type}]${summary}`;
						}),
						"",
					];
				})()
			: [];

	const taskSection =
		agent.task_events && agent.task_events.length > 0
			? [
					ansi.bold("Task Activity:"),
					...agent.task_events.map((te) => {
						const subject = te.subject ? `: ${te.subject}` : "";
						return `  ${te.action.padEnd(10)} ${te.task_id}${subject}`;
					}),
					"",
				]
			: [];

	const idleSection =
		agent.idle_periods && agent.idle_periods.length > 0
			? (() => {
					const count = agent.idle_periods.length;
					const recent = [...agent.idle_periods].sort((a, b) => b.t - a.t).slice(0, 3);
					return [
						ansi.bold(`Idle Periods: ${count}`),
						...recent.map((ip) => {
							const time = new Date(ip.t).toLocaleTimeString();
							return `  ${ansi.dim(time)} ${ip.teammate}`;
						}),
						"",
					];
				})()
			: [];

	const costSection = agent.cost_estimate
		? [ansi.bold("Cost:"), `  Total: $${agent.cost_estimate.estimated_cost_usd.toFixed(2)}`]
		: [];

	return [
		...header,
		...taskPromptSection,
		...toolSection,
		...tokenSection,
		...fileSection,
		...partnersSection,
		...messagesSection,
		...taskSection,
		...idleSection,
		...costSection,
	];
};

// --- Screen-level renderers (private, used by render) ---

const renderSessionList = (state: TuiState, rows: number, cols: number): string => {
	const header =
		ansi.bold("clens explorer") + ansi.dim("  [↑↓] navigate  [Enter] select  [q] quit");
	const colHeader = ansi.dim(
		`${"Name / ID".padEnd(32)}${"Started".padEnd(14)}${"Branch".padEnd(16)}${"Team".padEnd(12)}${"Type".padEnd(10)}${"D".padEnd(3)}${"Duration".padEnd(10)}${"Events".padEnd(8)}Status`,
	);
	const separator = ansi.dim("\u2500".repeat(Math.min(cols, 105)));

	const visibleRows = rows - 6;
	const startIdx = Math.max(0, state.selectedIndex - visibleRows + 1);
	const visible = state.sessions.slice(startIdx, startIdx + visibleRows);

	const sessionRows = visible.map((s, i) =>
		formatSessionRow(s, startIdx + i === state.selectedIndex, cols),
	);

	const footer = ansi.dim(`${state.sessions.length} session(s)`);

	return [header, "", colHeader, separator, ...sessionRows, "", footer].join("\n");
};

const renderSessionDetail = (state: TuiState, rows: number, cols: number): string => {
	const session = state.sessions[state.selectedIndex];
	if (!session) return "No session selected.";

	const isSingleAgent = (session.agent_count ?? 0) === 0;
	const tabBar = state.visibleTabs
		.map((t) => (t === state.detailTab ? ansi.inverse(` ${t} `) : ansi.dim(` ${t} `)))
		.join(" ");

	// Prefer distilled session_name over summary session_name
	const sessionName = state.selectedSession?.session_name ?? session.session_name;
	const nameLabel = sessionName ? `  ${ansi.bold(sessionName)}` : "";

	const sessionTypeHeader = isSingleAgent
		? ansi.dim("Single-agent session")
		: ansi.dim(`Multi-agent session (${session.agent_count} agents)`);

	const nav = ansi.dim("[Tab] switch tab  [Esc] back  [q] quit");
	const headerLine = `${ansi.bold("Session Detail")}${nameLabel}  ${sessionTypeHeader}  ${nav}`;

	const content: readonly string[] = (() => {
		switch (state.detailTab) {
			case "overview":
				return formatOverviewTab(session, state.selectedSession, state.selectedJourney, cols);
			case "backtracks": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatBacktracksTab(state.selectedSession);
			}
			case "decisions": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatDecisionsTabFull(state.selectedSession.decisions);
			}
			case "reasoning": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatReasoningTab(state.selectedSession);
			}
			case "edits": {
				if (!state.selectedSession?.file_map) {
					return [ansi.dim("No file data available.")];
				}
				const editChains = state.selectedSession.edit_chains?.chains ?? [];
				const editChainMap: ReadonlyMap<string, EditChain> = new Map(
					editChains.map((c) => [c.file_path, c]),
				);
				const allAgents = flattenAgents(state.selectedSession.agents ?? []);
				const agentNames: readonly string[] = [
					...new Set(
						allAgents
							.filter((a): a is AgentNode & { agent_name: string } => a.agent_name !== undefined)
							.map((a) => sanitizeAgentName(a.agent_name, a.session_id)),
					),
				];

				// Detail view for a selected file
				if (state.editSelectedFile) {
					const chain = editChainMap.get(state.editSelectedFile);
					if (!chain) return [ansi.dim(`No edit chain for ${state.editSelectedFile}`)];

					// Check for diff attribution
					const diffAttr = state.selectedSession?.edit_chains?.diff_attribution?.find(
						(d) => d.file_path === state.editSelectedFile,
					);

					const diffSection = diffAttr
						? [
								...formatAttributedDiff(diffAttr, agentNames, cols),
								"",
								ansi.dim("\u2500".repeat(60)),
								"",
							]
						: [];

					return [
						ansi.dim("[Esc] back  [↑↓] scroll"),
						"",
						...diffSection,
						ansi.bold("Edit History:"),
						"",
						...formatEditDetail(chain, agentNames),
					];
				}

				// File list view
				const files = getEditsFileList(state);
				const filterLabel = state.agentFilter ? ` (agent: ${state.agentFilter})` : "";
				const groupingLabel = state.editGrouping === "agent" ? "agent" : "directory";
				const hasAgents = state.selectedSession.agents && state.selectedSession.agents.length > 0;

				const agentMap: ReadonlyMap<string, string> = new Map(
					editChains
						.filter((c): c is EditChain & { agent_name: string } => c.agent_name !== undefined)
						.map((c) => [c.file_path, sanitizeAgentName(c.agent_name, c.agent_name)] as const),
				);

				const fileListContent: readonly string[] =
					state.editGrouping === "agent" && editChains.length > 0
						? groupFilesByAgent(
								files,
								state.projectDir,
								editChains,
								agentNames,
								editChainMap,
								state.editFileIndex,
							)
						: groupFilesByDirectory(
								files,
								state.projectDir,
								editChainMap,
								agentMap,
								agentNames,
								state.editFileIndex,
							);

				const gitDiffSection =
					state.selectedSession.git_diff && state.selectedSession.git_diff.hunks.length > 0
						? formatGitDiffSection(state.selectedSession.git_diff)
						: [];

				const helpParts = [
					"[up/down] select",
					"[Enter] detail",
					...(hasAgents ? ["[a] filter agent"] : []),
					...(editChains.length > 0 ? ["[g] toggle grouping"] : []),
				];

				return [
					ansi.bold(`Files Modified${filterLabel}:`),
					ansi.dim(`Group by: ${groupingLabel}  ${helpParts.join("  ")}`),
					"",
					...fileListContent,
					...gitDiffSection,
				];
			}
			case "timeline": {
				if (!state.selectedSession?.timeline) {
					return [ansi.dim("No timeline data available.")];
				}
				return formatTimelineTab(
					state.selectedSession.timeline,
					state.timelineOffset,
					state.timelineTypeFilter,
				);
			}
			case "drift": {
				if (!state.selectedSession)
					return [ansi.dim("No distilled data. Run: clens distill <session-id>")];
				return formatDriftTab(state.selectedSession);
			}
			case "agents": {
				if (!state.selectedSession?.agents || state.selectedSession.agents.length === 0) {
					return [ansi.dim("No agent data available.")];
				}
				const allAgents = flattenAgents(state.selectedSession.agents);
				const maxLabelLen = Math.min(
					Math.floor(cols * 0.35),
					Math.max(
						10,
						...allAgents.map(
							(a) => `${a.agent_name ?? a.agent_type} (${a.session_id.slice(0, 8)})`.length,
						),
					),
				);
				const agentHeader = ansi.dim(
					`${"Agent".padEnd(maxLabelLen + 2)}${"Dur".padEnd(8)}${"Calls".padEnd(8)}${"Files".padEnd(8)}Cost`,
				);
				const agentRows = allAgents.map((a, i) =>
					formatAgentRow(a, i === state.agentIndex, cols, maxLabelLen),
				);
				return [ansi.dim("[↑↓] navigate  [Enter] drill into agent"), "", agentHeader, ...agentRows];
			}
			case "messages": {
				if (!state.selectedSession) {
					return [ansi.dim("No communication data available.")];
				}
				return formatCommsTab(state.selectedSession, state.commsOffset, state.projectDir);
			}
			case "graph": {
				if (!state.selectedSession) return [ansi.dim("No graph data available.")];
				return formatGraphTab(state.selectedSession);
			}
		}
	})();

	// Apply generic content scrolling for tabs that use contentOffset
	const availableRows = rows - 5;
	const maxOffset = Math.max(0, content.length - availableRows);
	const clampedOffset = Math.min(state.contentOffset, maxOffset);
	const useContentScroll =
		CONTENT_SCROLL_TABS.has(state.detailTab) ||
		(state.detailTab === "edits" && state.editSelectedFile !== undefined);
	const scrolledContent = useContentScroll
		? content.slice(clampedOffset, clampedOffset + availableRows)
		: content;

	const scrollIndicator =
		useContentScroll && content.length > availableRows
			? [
					ansi.dim(
						`[${clampedOffset + 1}-${Math.min(clampedOffset + availableRows, content.length)} of ${content.length}] [↑↓] scroll`,
					),
				]
			: [];

	return [headerLine, "", tabBar, "", ...scrolledContent, ...scrollIndicator].join("\n");
};

const renderAgentDetail = (state: TuiState, rows: number, _cols: number): string => {
	if (!state.selectedAgent) return "No agent selected.";
	const nav = ansi.dim("[Esc] back  [↑↓] scroll  [q] quit");
	const content = formatAgentDetail(state.selectedAgent);
	const availableRows = rows - 4;
	const maxOffset = Math.max(0, content.length - availableRows);
	const clampedOffset = Math.min(state.agentDetailOffset, maxOffset);
	const scrolledContent = content.slice(clampedOffset, clampedOffset + availableRows);
	const scrollIndicator =
		content.length > availableRows
			? [
					ansi.dim(
						`[${clampedOffset + 1}-${Math.min(clampedOffset + availableRows, content.length)} of ${content.length}] [↑↓] scroll`,
					),
				]
			: [];
	return [nav, "", ...scrolledContent, ...scrollIndicator].join("\n");
};

// --- Top-level view dispatcher ---

export const render = (state: TuiState, rows: number, cols: number): string => {
	switch (state.view) {
		case "session_list":
			return renderSessionList(state, rows, cols);
		case "session_detail":
			return renderSessionDetail(state, rows, cols);
		case "agent_detail":
			return renderAgentDetail(state, rows, cols);
	}
};

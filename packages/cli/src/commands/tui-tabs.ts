import type {
	AgentNode,
	DecisionPoint,
	DistilledSession,
	Journey,
	SessionSummary,
	TimelineEntry,
} from "../types";
import { flattenAgents, formatDuration, formatSessionDateFull } from "../utils";
import {
	ansi,
	colorizeTimelineType,
	formatAgentLifetimeBar,
	formatCommGraphSummary,
	formatDecisionsSection,
	formatSequenceEntry,
	pluralize,
} from "./tui-formatters";

// --- Overview tab ---

export const formatOverviewTab = (
	session: SessionSummary,
	distilled: DistilledSession | undefined,
	journey?: Journey,
	width: number = 120,
): readonly string[] => {
	const dateStr = formatSessionDateFull(session.start_time);
	const sessionLabel = session.session_name
		? `${session.session_name} (${session.session_id.slice(0, 8)})`
		: session.session_id.slice(0, 8);
	const header = [
		ansi.bold(`Session: ${sessionLabel}`),
		ansi.dim(dateStr),
		ansi.dim("[↑↓] scroll"),
		"",
	] as const;

	if (distilled?.summary) {
		const km = distilled.summary.key_metrics;
		const failRate = km.tool_calls > 0 ? ((km.failures / km.tool_calls) * 100).toFixed(1) : "0.0";
		const model = distilled.stats.model ?? "-";
		const agentCount = distilled.team_metrics?.agent_count ?? 0;
		const taskCount = distilled.team_metrics?.task_completed_count ?? 0;

		const topTools = Object.entries(distilled.stats.tools_by_name)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([name]) => name);

		const overviewLines: readonly string[] = [
			ansi.bold("Session Overview"),
			ansi.dim(
				`  ${km.duration_human} session${km.active_duration_human ? ` (${km.active_duration_human} active)` : ""} using ${model}`,
			),
			ansi.dim(`  ${km.tool_calls} tool calls across ${km.files_modified} files`),
		];

		const phaseNames = distilled.summary.phases.map((p) => p.name).join(", ");
		const phaseLine: readonly string[] =
			distilled.summary.phases.length > 0
				? [
						"",
						`Phases: ${phaseNames}`,
						ansi.dim(`  Primary tools: ${topTools.length > 0 ? topTools.join(", ") : "none"}`),
					]
				: [];

		const backtracksDescription: readonly string[] =
			distilled.backtracks.length > 0
				? (() => {
						const typeCounts = distilled.backtracks.reduce(
							(acc, bt) => ({
								...acc,
								[bt.type]: (acc[bt.type] ?? 0) + 1,
							}),
							{} as Record<string, number>,
						);
						const btTypeSummary = Object.entries(typeCounts)
							.map(([type, count]) => `${count} ${type.replace(/_/g, " ")}`)
							.join(", ");
						const reasoningCount = distilled.reasoning.length;
						const dominantIntentValue =
							reasoningCount > 0
								? Object.entries(
										distilled.reasoning.reduce(
											(acc, r) => {
												const intent = r.intent_hint ?? "general";
												return { ...acc, [intent]: (acc[intent] ?? 0) + 1 };
											},
											{} as Record<string, number>,
										),
									).reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
								: undefined;
						return [
							"",
							ansi.bold("Quality:"),
							ansi.dim(
								`  ${distilled.backtracks.length} ${distilled.backtracks.length === 1 ? "backtrack" : "backtracks"} (${btTypeSummary})`,
							),
							ansi.dim(`  Failure rate: ${failRate}%`),
							...(reasoningCount > 0
								? [
										ansi.dim(
											`  ${reasoningCount} thinking ${reasoningCount === 1 ? "block" : "blocks"}, primarily ${dominantIntentValue}`,
										),
									]
								: []),
						];
					})()
				: [];

		const editChainDescription: readonly string[] = (() => {
			const chainsCount = km.edit_chains_count ?? 0;
			const abandoned = km.abandoned_edits ?? 0;
			if (chainsCount === 0) return [];
			const backtrackedFiles = distilled.edit_chains
				? distilled.edit_chains.chains.filter((c) => c.has_backtrack).length
				: 0;
			return [
				"",
				ansi.bold("Edit Activity:"),
				ansi.dim(
					`  ${chainsCount} ${chainsCount === 1 ? "file" : "files"} modified, ${abandoned} abandoned ${abandoned === 1 ? "attempt" : "attempts"}, ${backtrackedFiles} ${backtrackedFiles === 1 ? "backtrack" : "backtracks"}`,
				),
			];
		})();

		const teamDescription: readonly string[] = (() => {
			if (!distilled.team_metrics || agentCount === 0) return [];
			const workload = distilled.summary.agent_workload ?? [];
			const topContributors = workload
				.slice(0, 3)
				.map((a) => `${a.name} (${a.id.slice(0, 8)})`)
				.join(", ");
			const utilization =
				distilled.team_metrics.utilization_ratio !== undefined
					? `${(distilled.team_metrics.utilization_ratio * 100).toFixed(0)}%`
					: undefined;
			return [
				"",
				ansi.bold("Team:"),
				ansi.dim(
					`  ${agentCount} ${agentCount === 1 ? "agent" : "agents"} coordinating across ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`,
				),
				...(topContributors ? [ansi.dim(`  Top contributors: ${topContributors}`)] : []),
				...(utilization ? [ansi.dim(`  Average utilization: ${utilization}`)] : []),
			];
		})();

		const narrativeSection: readonly string[] = [
			...overviewLines,
			...phaseLine,
			...backtracksDescription,
			...editChainDescription,
			...teamDescription,
			"",
		];

		const metricsGrid = [
			`  ${ansi.bold("Duration:".padEnd(14))}${`${km.duration_human}${km.active_duration_human ? ` (${km.active_duration_human} active)` : ""}`.padEnd(33)}${ansi.bold("Model:".padEnd(13))}${model}`,
			`  ${ansi.bold("Tool calls:".padEnd(14))}${String(km.tool_calls).padEnd(33)}${ansi.bold("Failures:".padEnd(13))}${km.failures} (${failRate}%)`,
			`  ${ansi.bold("Files:".padEnd(14))}${String(km.files_modified).padEnd(33)}${ansi.bold("Backtracks:".padEnd(13))}${km.backtrack_count}`,
			`  ${ansi.bold("Agents:".padEnd(14))}${String(agentCount).padEnd(33)}${ansi.bold("Tasks:".padEnd(13))}${taskCount}`,
			"",
		];

		const phases =
			distilled.summary.phases.length > 0
				? [
						"",
						ansi.bold("Phases:"),
						...distilled.summary.phases.map((p, i) => {
							const dur = formatDuration(p.end_t - p.start_t);
							const topTools = p.tool_types.slice(0, 3).join(", ");
							return `  ${i + 1}. ${p.name.padEnd(18)}${dur.padEnd(8)} ${topTools}`;
						}),
					]
				: [];

		const topErrors =
			distilled.summary.top_errors && distilled.summary.top_errors.length > 0
				? [
						"",
						ansi.bold("Top Errors:"),
						...distilled.summary.top_errors.map((e) => {
							const sample = e.sample_message ? `  "${e.sample_message.slice(0, 50)}"` : "";
							return `  ${e.tool_name.padEnd(10)}${String(e.count).padStart(2)} failure${e.count !== 1 ? "s" : " "}${sample}`;
						}),
					]
				: [];

		const agentWorkload =
			distilled.summary.agent_workload && distilled.summary.agent_workload.length > 0
				? [
						"",
						ansi.bold("Agent Workload (top 5):"),
						...distilled.summary.agent_workload.slice(0, 5).map((a) => {
							const dur = formatDuration(a.duration_ms);
							const label = `${a.name} (${a.id})`;
							return `  ${label.padEnd(28)}${String(a.tool_calls).padStart(4)} calls  ${dur.padEnd(6)} ${String(a.files_modified).padStart(2)} files`;
						}),
					]
				: [];

		const allAgents = flattenAgents(distilled.agents ?? []);
		const agentNameLookup: ReadonlyMap<string, string> = new Map(
			allAgents
				.filter((a): a is AgentNode & { agent_name: string } => a.agent_name !== undefined)
				.map((a) => [a.session_id, a.agent_name] as const),
		);
		const resolveAgentName = (id: string): string => agentNameLookup.get(id) ?? id.slice(0, 19);

		const taskSummary =
			distilled.summary.task_summary && distilled.summary.task_summary.length > 0
				? [
						"",
						ansi.bold("Tasks (recent 10):"),
						...distilled.summary.task_summary
							.slice()
							.sort((a, b) => b.t - a.t)
							.slice(0, 10)
							.map((t) => {
								const subject = t.subject ? `: ${t.subject}` : "";
								return `  ${resolveAgentName(t.agent).padEnd(19)}completed${subject}`;
							}),
					]
				: [];

		const lifecycle = journey
			? [
					"",
					ansi.bold("Lifecycle:"),
					`  Type: ${journey.lifecycle_type}${journey.phases.length > 1 ? `  (${journey.phases.length} sessions)` : ""}`,
					...(journey.spec_ref ? [`  Spec: ${journey.spec_ref}`] : []),
				]
			: [];

		const driftSection = distilled?.plan_drift
			? (() => {
					const d = distilled.plan_drift;
					const scoreStr = `\x1b[${d.drift_score < 0.3 ? "32" : d.drift_score < 0.7 ? "33" : "31"}m${d.drift_score.toFixed(2)}\x1b[0m`;
					const shortUnexpected = d.unexpected_files.map((f) => f.split("/").pop() ?? f);
					const unexpectedLine =
						shortUnexpected.length > 0
							? [
									`  Unexpected: ${shortUnexpected.slice(0, 5).join(", ")}${shortUnexpected.length > 5 ? ` (+${shortUnexpected.length - 5})` : ""}`,
								]
							: [];
					const shortMissing = d.missing_files.map((f) => f.split("/").pop() ?? f);
					const missingLine =
						shortMissing.length > 0
							? [
									`  Missing: ${shortMissing.slice(0, 5).join(", ")}${shortMissing.length > 5 ? ` (+${shortMissing.length - 5})` : ""}`,
								]
							: [];
					return [
						"",
						ansi.bold("Plan Drift:"),
						`  Spec: ${d.spec_path}`,
						`  Score: ${scoreStr}    Expected: ${d.expected_files.length}    Actual: ${d.actual_files.length}`,
						...unexpectedLine,
						...missingLine,
					];
				})()
			: [];

		const decisionsSection =
			distilled.decisions.length > 0 ? formatDecisionsSection(distilled.decisions) : [];

		return [
			...header,
			...narrativeSection,
			...metricsGrid,
			...phases,
			...topErrors,
			...agentWorkload,
			...taskSummary,
			...lifecycle,
			...driftSection,
			...decisionsSection,
		];
	}

	return [
		...header,
		`Duration:    ${formatDuration(session.duration_ms)}`,
		`Events:      ${session.event_count}`,
		`Branch:      ${session.git_branch ?? "-"}`,
		"",
		ansi.dim("No distilled data. Run: clens distill <session-id>"),
	];
};

// --- Comms tab ---

export const formatCommsTab = (
	distilled: DistilledSession,
	commsOffset: number,
	_projectDir?: string,
): readonly string[] => {
	const lifetimes = distilled.agent_lifetimes ?? [];
	const sequence = distilled.comm_sequence ?? [];

	if (
		lifetimes.length === 0 &&
		sequence.length === 0 &&
		(!distilled.communication_graph || distilled.communication_graph.length === 0)
	) {
		return [
			ansi.dim("No communication data available."),
			"",
			ansi.dim("Re-run: clens distill --deep <session-id>"),
		];
	}

	const commGraphSection =
		distilled.communication_graph && distilled.communication_graph.length > 0
			? formatCommGraphSummary(distilled.communication_graph)
			: [];

	const agentNames: readonly string[] = [
		...new Set([
			...lifetimes.map((l) => `${l.agent_name ?? l.agent_type} (${l.agent_id.slice(0, 8)})`),
			...sequence.flatMap((s) => [s.from_name, s.to_name]),
		]),
	].sort();

	const lifetimeSection =
		lifetimes.length > 0
			? (() => {
					const minT = lifetimes.reduce((m, l) => Math.min(m, l.start_t), Infinity);
					const maxT = lifetimes.reduce((m, l) => Math.max(m, l.end_t), 0);
					const barWidth = 40;
					const labelLen = Math.min(
						28,
						Math.max(
							18,
							...lifetimes.map(
								(l) => `${l.agent_name ?? l.agent_type} (${l.agent_id.slice(0, 8)})`.length,
							),
						),
					);
					return [
						ansi.bold("Agent Lifetimes:"),
						"",
						...lifetimes.map((l) =>
							formatAgentLifetimeBar(l, minT, maxT, barWidth, agentNames, labelLen),
						),
						"",
					];
				})()
			: [];

	const messageSection =
		sequence.length > 0
			? (() => {
					const total = sequence.length;
					const offset = commsOffset;
					const visible = sequence.slice(offset, offset + 30);
					const endIdx = Math.min(offset + 30, total);
					const scrollIndicator = ansi.dim(`[${offset + 1}-${endIdx} of ${total}]`);
					return [
						`${ansi.bold("Messages:")}  ${scrollIndicator}`,
						ansi.dim("[↑↓] scroll"),
						"",
						...visible.map((entry) => formatSequenceEntry(entry, agentNames)),
					];
				})()
			: [];

	return [...commGraphSection, ...lifetimeSection, ...messageSection];
};

// --- Timeline collapsing ---

export interface CollapsedEntry {
	readonly entry: TimelineEntry;
	readonly count: number;
}

export const collapseConsecutive = (entries: readonly TimelineEntry[]): readonly CollapsedEntry[] =>
	entries.reduce<readonly CollapsedEntry[]>((acc, entry) => {
		const prev = acc[acc.length - 1];
		if (
			prev &&
			prev.entry.type === "tool_call" &&
			entry.type === "tool_call" &&
			prev.entry.tool_name === entry.tool_name &&
			prev.entry.agent_name === entry.agent_name
		) {
			return [...acc.slice(0, -1), { entry: prev.entry, count: prev.count + 1 }];
		}
		return [...acc, { entry, count: 1 }];
	}, []);

// --- Timeline formatting ---

export const formatTimelineEntry = (e: TimelineEntry): string => {
	const time = new Date(e.t).toLocaleTimeString();
	const preview = e.content_preview ? `: ${e.content_preview.slice(0, 50)}` : "";
	return `  ${ansi.dim(time)} ${colorizeTimelineType(e)}${preview}`;
};

export const formatCollapsedEntry = (c: CollapsedEntry): string => {
	const suffix = c.count > 1 ? ` ${ansi.dim(`(x${c.count})`)}` : "";
	return `${formatTimelineEntry(c.entry)}${suffix}`;
};

export const formatSwimLaneEntry = (e: TimelineEntry, laneWidth: number): string => {
	const time = new Date(e.t).toLocaleTimeString();
	const rawLabel = e.agent_name
		? `${e.agent_name}${e.agent_id ? ` (${e.agent_id.slice(0, 8)})` : ""}`
		: e.agent_id
			? e.agent_id.slice(0, 8)
			: "";
	const agentLabel = rawLabel.slice(0, laneWidth).padEnd(laneWidth);
	const preview = e.content_preview ? `: ${e.content_preview.slice(0, 40)}` : "";
	return `  ${ansi.dim(time)} ${ansi.cyan(agentLabel)} ${colorizeTimelineType(e)}${preview}`;
};

export const formatCollapsedSwimLaneEntry = (c: CollapsedEntry, laneWidth: number): string => {
	const suffix = c.count > 1 ? ` ${ansi.dim(`(x${c.count})`)}` : "";
	return `${formatSwimLaneEntry(c.entry, laneWidth)}${suffix}`;
};

export const formatTimelineTab = (
	timeline: readonly TimelineEntry[],
	offset: number,
	typeFilter?: TimelineEntry["type"],
): readonly string[] => {
	const filtered = typeFilter ? timeline.filter((e) => e.type === typeFilter) : timeline;
	const collapsed = collapseConsecutive(filtered);
	const total = collapsed.length;
	const visible = collapsed.slice(offset, offset + 30);
	const endIdx = Math.min(offset + 30, total);
	const scrollIndicator = ansi.dim(`[${offset + 1}-${endIdx} of ${total}]`);
	const filterIndicator = typeFilter ? ` filter: ${typeFilter}` : "";

	const uniqueAgents = [...new Set(filtered.flatMap((e) => (e.agent_name ? [e.agent_name] : [])))];
	const isMultiAgent = uniqueAgents.length > 1;

	const header = [
		`${ansi.bold("Timeline:")}  ${scrollIndicator}${filterIndicator}`,
		ansi.dim("[↑↓] scroll  [f] filter type"),
		"",
	];

	if (!isMultiAgent) {
		return [...header, ...visible.map(formatCollapsedEntry)];
	}

	const laneWidth = Math.min(
		16,
		uniqueAgents.reduce((max, name) => Math.max(max, name.length), 0),
	);

	return [...header, ...visible.map((c) => formatCollapsedSwimLaneEntry(c, laneWidth))];
};

// --- Tab content renderers (pure) ---

export const formatBacktracksTab = (distilled: DistilledSession): readonly string[] => {
	const bts = distilled.backtracks;
	if (bts.length === 0)
		return [ansi.bold("Backtracks:"), "", ansi.dim("None detected — clean session.")];

	const btTimeMs = bts.reduce((sum, bt) => sum + (bt.end_t - bt.start_t), 0);
	const timePercent =
		distilled.stats.duration_ms > 0
			? ((btTimeMs / distilled.stats.duration_ms) * 100).toFixed(1)
			: "0.0";
	const typeLabel = (type: string): string =>
		type === "failure_retry"
			? "failure retry"
			: type === "iteration_struggle"
				? "iteration struggle"
				: "debugging loop";

	return [
		ansi.bold(`Backtracks: ${bts.length}`),
		ansi.dim(`  ${timePercent}% of session time`),
		ansi.dim("[↑↓] scroll"),
		"",
		...bts.map((bt) => {
			const time = new Date(bt.start_t).toLocaleTimeString();
			const dur = formatDuration(bt.end_t - bt.start_t);
			const file = (bt.file_path ?? bt.tool_name).padEnd(30);
			const errorHint = bt.error_message ? `  ${ansi.dim(bt.error_message.slice(0, 40))}` : "";
			return `  ${ansi.dim(time)} ${file} ${typeLabel(bt.type).padEnd(18)} ${bt.attempts} attempts  ${dur}${errorHint}`;
		}),
	];
};

export const formatReasoningTab = (distilled: DistilledSession): readonly string[] => {
	const reasoning = distilled.reasoning;
	if (reasoning.length === 0)
		return [
			ansi.bold("Reasoning:"),
			"",
			ansi.dim("No reasoning data. Run 'clens distill --deep' to extract."),
		];

	const byIntent = reasoning.reduce<Readonly<Record<string, number>>>((acc, r) => {
		const key = r.intent_hint ?? "general";
		return { ...acc, [key]: (acc[key] ?? 0) + 1 };
	}, {});

	return [
		ansi.bold(`Reasoning: ${reasoning.length} blocks`),
		ansi.dim("[↑↓] scroll"),
		"",
		ansi.dim("By intent:"),
		...Object.entries(byIntent)
			.sort((a, b) => b[1] - a[1])
			.map(([intent, count]) => `  ${intent.padEnd(20)} ${count}`),
		"",
		ansi.bold("All entries:"),
		...reasoning.map((r) => {
			const preview = r.thinking.slice(0, 60).replace(/\n/g, " ");
			const intent = r.intent_hint ?? "general";
			return `  [${intent}] ${preview}${r.thinking.length > 60 ? "..." : ""}`;
		}),
	];
};

export const formatDriftTab = (distilled: DistilledSession): readonly string[] => {
	const drift = distilled.plan_drift;
	if (!drift)
		return [
			ansi.bold("Plan Drift:"),
			"",
			ansi.dim("No drift data. Run 'clens report drift' to analyze."),
		];

	const scoreColor =
		drift.drift_score < 0.3 ? "\x1b[32m" : drift.drift_score < 0.7 ? "\x1b[33m" : "\x1b[31m";

	return [
		ansi.bold("Plan Drift:"),
		ansi.dim("[↑↓] scroll"),
		"",
		`  Spec:       ${drift.spec_path}`,
		`  Score:      ${scoreColor}${drift.drift_score.toFixed(2)}\x1b[0m`,
		`  Expected:   ${drift.expected_files.length} files`,
		`  Actual:     ${drift.actual_files.length} files`,
		`  Unexpected: ${drift.unexpected_files.length}`,
		`  Missing:    ${drift.missing_files.length}`,
		...(drift.unexpected_files.length > 0
			? ["", ansi.bold("Unexpected files:"), ...drift.unexpected_files.map((f) => `  ${f}`)]
			: []),
		...(drift.missing_files.length > 0
			? ["", ansi.bold("Missing files:"), ...drift.missing_files.map((f) => `  ${f}`)]
			: []),
	];
};

export const formatGraphTab = (distilled: DistilledSession): readonly string[] => {
	const graph = distilled.communication_graph;
	if (!graph || graph.length === 0)
		return [ansi.bold("Communication Graph:"), "", ansi.dim("No graph data available.")];

	const graphSection = formatCommGraphSummary(graph);

	const lifetimes = distilled.agent_lifetimes ?? [];
	const lifetimeSection =
		lifetimes.length > 0
			? (() => {
					const minT = lifetimes.reduce((m, l) => Math.min(m, l.start_t), Infinity);
					const maxT = lifetimes.reduce((m, l) => Math.max(m, l.end_t), 0);
					const agentNames = [
						...new Set(
							lifetimes.map((l) => `${l.agent_name ?? l.agent_type} (${l.agent_id.slice(0, 8)})`),
						),
					].sort();
					const labelLen = Math.min(28, Math.max(18, ...agentNames.map((n) => n.length)));
					return [
						"",
						ansi.bold("Agent Lifetimes:"),
						"",
						...lifetimes.map((l) =>
							formatAgentLifetimeBar(l, minT, maxT, 40, agentNames, labelLen),
						),
					];
				})()
			: [];

	return [...graphSection, ...lifetimeSection];
};

export const formatDecisionDetail = (d: DecisionPoint): string => {
	switch (d.type) {
		case "timing_gap":
			return `${formatDuration(d.gap_ms)} gap (${d.classification})`;
		case "tool_pivot":
			return `${d.from_tool} -> ${d.to_tool}${d.after_failure ? " (after failure)" : ""}`;
		case "phase_boundary":
			return `phase ${d.phase_index + 1}: ${d.phase_name}`;
		case "agent_spawn":
			return `spawned ${d.agent_name} (${d.agent_type})`;
		case "task_delegation":
			return `delegated to ${d.agent_name}${d.subject ? `: ${d.subject}` : ""}`;
		case "task_completion":
			return `completed by ${d.agent_name}${d.subject ? `: ${d.subject}` : ""}`;
	}
};

export const formatDecisionsTabFull = (decisions: readonly DecisionPoint[]): readonly string[] => {
	if (decisions.length === 0)
		return [ansi.bold("Decisions:"), "", ansi.dim("No decision points detected.")];

	const countByType = decisions.reduce<Readonly<Record<string, number>>>(
		(acc, d) => ({
			...acc,
			[d.type]: (acc[d.type] ?? 0) + 1,
		}),
		{},
	);

	const summaryParts = Object.entries(countByType)
		.map(([type, count]) => `${count} ${pluralize(type.replace(/_/g, " "), count)}`)
		.join(", ");

	const allDecisions = [...decisions]
		.sort((a, b) => b.t - a.t)
		.map((d) => {
			const time = new Date(d.t).toLocaleTimeString();
			return `  ${ansi.dim(time)} ${d.type.replace(/_/g, " ")}: ${formatDecisionDetail(d)}`;
		});

	return [
		ansi.bold(`Decision Points: ${summaryParts}`),
		ansi.dim("[↑↓] scroll"),
		"",
		...allDecisions,
	];
};

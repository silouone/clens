import type { BacktrackResult, DistilledSession, FileMapEntry } from "../types";
import { flattenAgents, formatSessionDateFull } from "../utils";
import { fmtDuration } from "./format-helpers";
import { bold, cyan, dim, green, red, yellow } from "./shared";

// --- Backtrack severity ---

const classifySeverity = (
	count: number,
	timePercent: number,
): { readonly label: string; readonly color: (s: string) => string } =>
	count >= 5 || timePercent > 25
		? { label: "HIGH", color: red }
		: count >= 3 || timePercent > 10
			? { label: "MEDIUM", color: yellow }
			: { label: "LOW", color: green };

const typeLabel = (type: BacktrackResult["type"]): string =>
	type === "failure_retry"
		? "failure retry"
		: type === "iteration_struggle"
			? "iteration struggle"
			: "debugging loop";

// --- High-risk file scoring ---

interface HighRiskFile {
	readonly file: string;
	readonly backtracks: number;
	readonly edits: number;
}

const computeHighRiskFiles = (
	backtracks: readonly BacktrackResult[],
	files: readonly FileMapEntry[],
): readonly HighRiskFile[] => {
	const btCounts = backtracks
		.filter((bt): bt is BacktrackResult & { file_path: string } => bt.file_path !== undefined)
		.reduce<Readonly<Record<string, number>>>(
			(acc, bt) => ({ ...acc, [bt.file_path]: (acc[bt.file_path] ?? 0) + 1 }),
			{},
		);

	return files
		.filter((f) => (btCounts[f.file_path] ?? 0) >= 2 || f.edits >= 10)
		.map((f) => ({
			file: f.file_path,
			backtracks: btCounts[f.file_path] ?? 0,
			edits: f.edits,
		}))
		.sort((a, b) => b.backtracks - a.backtracks || b.edits - a.edits)
		.slice(0, 5);
};

// --- Top tools formatting ---

const formatTopTools = (toolsByName: Readonly<Record<string, number>>): string => {
	const sorted = Object.entries(toolsByName)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);
	return sorted.map(([name, count]) => `${name} (${count})`).join(", ");
};

// --- Default summary renderer ---

export const renderReportDefault = (distilled: DistilledSession): string => {
	const { stats, backtracks, summary } = distilled;
	const sessionPrefix = distilled.session_id.slice(0, 8);
	const nameStr = distilled.session_name ? `${distilled.session_name} (${sessionPrefix})` : sessionPrefix;

	// Header line: session, date, duration, model, cost
	const startTime = distilled.start_time ?? distilled.timeline?.[0]?.t;
	const dateStr = startTime ? ` -- ${formatSessionDateFull(startTime)}` : "";
	const activeDurMs = summary?.key_metrics?.active_duration_ms;
	const durationStr = activeDurMs
		? `${fmtDuration(stats.duration_ms)} (${fmtDuration(activeDurMs)} active)`
		: fmtDuration(stats.duration_ms);
	const model = stats.model ?? stats.cost_estimate?.model;
	const modelStr = model ? ` -- ${model}` : "";
	const cost = distilled.cost_estimate ?? stats.cost_estimate;
	const costStr = cost
		? (() => {
				const prefix = cost.is_estimated ? "~" : "";
				return ` -- ${prefix}$${cost.estimated_cost_usd.toFixed(2)}`;
			})()
		: "";
	const header = bold(`Session ${cyan(nameStr)}${dateStr} -- ${durationStr}${modelStr}${costStr}`);

	// Stats line
	const filesModified = summary?.key_metrics?.files_modified ?? stats.unique_files.length;
	const failRate = (stats.failure_rate * 100).toFixed(1);
	const statsLine = `  ${stats.tool_call_count} tool calls, ${filesModified} files modified, ${failRate}% failure rate`;

	// Backtracks section
	const btSection = (() => {
		if (backtracks.length === 0) return ["", `  Backtracks: ${green("0")} -- clean session`];
		const btTimeMs = backtracks.reduce((sum, bt) => sum + (bt.end_t - bt.start_t), 0);
		const timePercent = stats.duration_ms > 0 ? (btTimeMs / stats.duration_ms) * 100 : 0;
		const severity = classifySeverity(backtracks.length, timePercent);
		const severityLine = `  Backtracks: ${backtracks.length} (severity: ${severity.color(severity.label)})`;

		const top3 = [...backtracks]
			.sort((a, b) => b.attempts - a.attempts)
			.slice(0, 3)
			.map((bt) => {
				const file = bt.file_path ?? bt.tool_name;
				return `    ${file} -- ${typeLabel(bt.type)}, ${bt.attempts} attempts`;
			});

		const moreLine = backtracks.length > 3
			? [`    ${dim(`... and ${backtracks.length - 3} more`)}`]
			: [];

		return ["", severityLine, ...top3, ...moreLine];
	})();

	// High-risk files
	const highRisk = computeHighRiskFiles(backtracks, distilled.file_map.files);
	const highRiskSection =
		highRisk.length > 0
			? [
					"",
					"  High-risk files:",
					...highRisk.map(
						(f) => `    ${f.file.padEnd(40)} ${f.backtracks} backtracks, ${f.edits} edits`,
					),
				]
			: [];

	// Top tools
	const topToolsStr = formatTopTools(stats.tools_by_name);
	const topToolsSection = topToolsStr ? ["", `  Top tools: ${topToolsStr}`] : [];

	// Multi-agent workload table
	const agentSection = (() => {
		const agents = distilled.agents;
		if (!agents || agents.length === 0) return [];

		const flatAgents = flattenAgents(agents);
		const activeAgents = flatAgents
			.filter((a) => a.tool_call_count > 0)
			.sort((a, b) => b.tool_call_count - a.tool_call_count);

		if (activeAgents.length === 0) return [];

		const agentRows = activeAgents.map((a) => {
			const name = (a.agent_name ?? a.session_id.slice(0, 8)).padEnd(24);
			const calls = String(a.tool_call_count).padStart(6);
			const dur = fmtDuration(a.duration_ms).padStart(10);
			const files = String(a.stats?.unique_files?.length ?? 0).padStart(6);
			const modelSuffix = a.model ? dim(` (${a.model})`) : "";
			return `    ${name} ${calls} ${dur} ${files}${modelSuffix}`;
		});

		return [
			"",
			bold("  Agent workload:"),
			`    ${"Name".padEnd(24)} ${"Calls".padStart(6)} ${"Duration".padStart(10)} ${"Files".padStart(6)}`,
			dim(`    ${"─".repeat(50)}`),
			...agentRows,
		];
	})();

	// Tip
	const tip = dim("  Run 'clens explore' for interactive deep dive.");

	return [header, "", statsLine, ...btSection, ...highRiskSection, ...topToolsSection, ...agentSection, "", tip].join("\n");
};

// --- Command handler ---

export const reportCommand = async (args: {
	readonly sessionId: string;
	readonly projectDir: string;
	readonly json: boolean;
	readonly subcommand?: string;
	readonly subcommandArg?: string;
	readonly detail: boolean;
	readonly full: boolean;
	readonly intent?: string;
}): Promise<void> => {
	const { readDistilled } = await import("../session/read");

	const distilled = readDistilled(args.sessionId, args.projectDir);
	if (!distilled) {
		throw new Error(
			`No distilled data for session ${args.sessionId.slice(0, 8)}. Run: clens distill ${args.sessionId.slice(0, 8)}`,
		);
	}

	// Route subcommands
	const sub = args.subcommand;

	if (!sub) {
		// Default summary
		if (args.json) {
			console.log(JSON.stringify(distilled, null, 2));
			return;
		}
		console.log(renderReportDefault(distilled));
		return;
	}

	if (sub === "backtracks") {
		const { renderBacktracksSummary, renderBacktracksDetail } = await import("./backtracks");
		if (args.json) {
			console.log(JSON.stringify(distilled.backtracks, null, 2));
			return;
		}
		if (distilled.backtracks.length === 0) {
			console.log("No backtracks detected -- clean session");
			return;
		}
		console.log(args.detail ? renderBacktracksDetail(distilled) : renderBacktracksSummary(distilled));
		return;
	}

	if (sub === "drift") {
		const { renderDriftReport } = await import("./drift");
		const { computePlanDrift, detectSpecRef } = await import("../distill/plan-drift");
		const { existsSync, readFileSync } = await import("node:fs");

		const specPath = args.subcommandArg;

		if (specPath) {
			const specFullPath = `${args.projectDir}/${specPath}`;
			if (!existsSync(specFullPath)) {
				throw new Error(`Spec file not found: ${specPath}`);
			}
			const specContent = readFileSync(specFullPath, "utf-8");
			const drift = computePlanDrift(specPath, specContent, [distilled.file_map], args.projectDir);
			if (args.json) {
				console.log(JSON.stringify(drift, null, 2));
				return;
			}
			console.log(renderDriftReport(drift));
			return;
		}

		if (distilled.plan_drift) {
			if (args.json) {
				console.log(JSON.stringify(distilled.plan_drift, null, 2));
				return;
			}
			console.log(renderDriftReport(distilled.plan_drift));
			return;
		}

		const prompts = distilled.user_messages
			.filter((m) => m.message_type === "prompt" || m.message_type === "command")
			.map((m) => m.content);
		const specRef = detectSpecRef(prompts);

		if (!specRef) {
			throw new Error(
				"No spec reference detected in session. Provide a spec path:\n  clens report --last drift specs/my-plan.md",
			);
		}

		const specFullPath = `${args.projectDir}/${specRef}`;
		if (!existsSync(specFullPath)) {
			throw new Error(`Detected spec '${specRef}' but file not found on disk.`);
		}
		const specContent = readFileSync(specFullPath, "utf-8");
		const drift = computePlanDrift(specRef, specContent, [distilled.file_map], args.projectDir);
		if (args.json) {
			console.log(JSON.stringify(drift, null, 2));
			return;
		}
		console.log(renderDriftReport(drift));
		return;
	}

	if (sub === "reasoning") {
		const { renderReasoningSummary, renderReasoningFull } = await import("./reasoning");
		if (args.json) {
			const filtered = args.intent
				? distilled.reasoning.filter((b) => b.intent_hint === args.intent)
				: distilled.reasoning;
			console.log(JSON.stringify(filtered, null, 2));
			return;
		}
		if (distilled.reasoning.length === 0) {
			console.log("No reasoning data found. Run 'clens distill --deep' to extract reasoning from transcripts.");
			return;
		}
		console.log(args.full ? renderReasoningFull(distilled, args.intent) : renderReasoningSummary(distilled));
		return;
	}

	throw new Error(
		`Unknown report subcommand: '${sub}'. Available: backtracks, drift, reasoning`,
	);
};

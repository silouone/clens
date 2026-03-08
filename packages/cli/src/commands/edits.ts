import type { DistilledSession, EditChain, EditStep, FileDiffAttribution } from "../types/distill";
import { sanitizeAgentName } from "../utils";
import { fmtDuration, fmtTime, truncate } from "./format-helpers";
import { bold, dim, green, red, yellow } from "./shared";

/**
 * Pad a string to a given width (right-padded).
 */
const padRight = (s: string, width: number): string =>
	s.length >= width ? s : `${s}${" ".repeat(width - s.length)}`;

/**
 * Pad a number (as string) to a given width (left-padded).
 */
const padLeft = (s: string, width: number): string =>
	s.length >= width ? s : `${" ".repeat(width - s.length)}${s}`;

/**
 * Derive the flag label for an edit chain.
 */
const deriveFlag = (chain: EditChain): string => {
	const firstBacktrackStep = chain.steps.find((s) => s.backtrack_type !== undefined);
	if (firstBacktrackStep?.backtrack_type) return firstBacktrackStep.backtrack_type;
	if (chain.total_failures > 0) return "has_failures";
	return "clean";
};

/**
 * Color a flag string based on its value.
 */
const colorFlag = (flag: string): string => {
	if (flag === "clean") return green(flag);
	if (flag === "has_failures") return yellow(flag);
	return red(flag);
};

/**
 * Render a summary table of edit chains from a distilled session.
 */
export const renderEditsSummary = (distilled: DistilledSession): string => {
	const chains = distilled.edit_chains?.chains ?? [];
	const sessionPrefix = distilled.session_id.slice(0, 8);
	const fileCount = chains.length;
	const totalDuration = distilled.stats.duration_ms;
	const hasAgentAttribution = chains.some((c) => c.agent_name !== undefined);
	const uniqueAgentCount = hasAgentAttribution
		? new Set(chains.map((c) => c.agent_name).filter(Boolean)).size
		: 0;

	const header = bold(
		hasAgentAttribution
			? `Session ${sessionPrefix} -- ${fileCount} files modified across ${uniqueAgentCount} agents, ${fmtDuration(totalDuration)}`
			: `Session ${sessionPrefix} -- ${fileCount} files modified, ${fmtDuration(totalDuration)}`,
	);

	// Compute column widths based on data
	const fileColWidth = Math.max(4, ...chains.map((c) => c.file_path.length));
	const agentColWidth = hasAgentAttribution
		? Math.max(
				5,
				...chains.map((c) => sanitizeAgentName(c.agent_name, c.agent_name ?? "unknown").length),
			)
		: 0;

	const colHeaders = [
		padRight("File", fileColWidth),
		...(hasAgentAttribution ? [padRight("Agent", agentColWidth)] : []),
		padLeft("Edits", 6),
		padLeft("Failed", 7),
		padLeft("Reads", 6),
		padLeft("Time", 8),
		"  Flag",
	].join("  ");

	const rows = chains.map((chain) => {
		const flag = deriveFlag(chain);
		return [
			padRight(chain.file_path, fileColWidth),
			...(hasAgentAttribution
				? [
						padRight(
							sanitizeAgentName(chain.agent_name, chain.agent_name ?? "unknown"),
							agentColWidth,
						),
					]
				: []),
			padLeft(String(chain.total_edits), 6),
			padLeft(String(chain.total_failures), 7),
			padLeft(String(chain.total_reads), 6),
			padLeft(fmtDuration(chain.effort_ms), 8),
			`  ${colorFlag(flag)}`,
		].join("  ");
	});

	const totalEdits = chains.reduce((sum, c) => sum + c.total_edits, 0);
	const totalFailures = chains.reduce((sum, c) => sum + c.total_failures, 0);
	const totalReads = chains.reduce((sum, c) => sum + c.total_reads, 0);
	const totalAbandoned = chains.reduce((sum, c) => sum + c.abandoned_edit_ids.length, 0);
	const totalSurviving = chains.reduce((sum, c) => sum + c.surviving_edit_ids.length, 0);

	const footer = [
		`${totalEdits} edits, ${totalFailures} failures, ${totalReads} recovery reads across ${fileCount} files`,
		`${totalAbandoned} failed edits, ${totalSurviving} successful edits`,
	].join("\n");

	return [header, "", dim(colHeaders), ...rows, "", footer].join("\n");
};

/**
 * Render the outcome icon for an edit step.
 */
export const outcomeIcon = (step: EditStep): string => {
	if (step.outcome === "success") return green("\u2713");
	if (step.outcome === "failure") return red("\u2717");
	return dim("\u00b7");
};

/**
 * Render line change summary for an edit step, e.g. "+12 -3 lines".
 */
export const lineChangeSummary = (step: EditStep): string | undefined => {
	if (step.old_string_lines === undefined && step.new_string_lines === undefined) return undefined;
	const oldLines = step.old_string_lines ?? 0;
	const newLines = step.new_string_lines ?? 0;
	if (oldLines === 0 && newLines === 0) return undefined;
	return `${oldLines}→${newLines} lines`;
};

/**
 * Render a single step's detail lines (indented sub-lines for thinking, old/new).
 */
export const renderStepDetails = (step: EditStep): readonly string[] => {
	const indent = "              ";

	const thinkingLine = step.thinking_preview
		? [`${indent}${dim(`thinking: "${truncate(step.thinking_preview, 120)}"`)}`]
		: [];

	const editLine =
		step.old_string_preview || step.new_string_preview
			? [
					...(step.old_string_preview
						? [`${indent}${dim(`old: "${truncate(step.old_string_preview, 120)}"`)}`]
						: []),
					...(step.new_string_preview
						? [`${indent}${dim(`new: "${truncate(step.new_string_preview, 120)}"`)}`]
						: []),
				]
			: [];

	return [...thinkingLine, ...editLine];
};

/**
 * Render a single step as one or more output lines.
 */
export const renderStep = (step: EditStep): readonly string[] => {
	const time = fmtTime(step.t);
	const icon = outcomeIcon(step);
	const toolLabel = step.tool_name;
	const statusPart =
		step.outcome === "failure" && step.error_preview
			? `FAILED: ${truncate(step.error_preview, 80)}`
			: step.outcome === "success" && step.tool_name !== "Read"
				? (lineChangeSummary(step) ?? "")
				: step.tool_name === "Read"
					? "recovery read"
					: "";

	const mainLine = `${time}  ${icon}  ${toolLabel}  ${statusPart}`;
	const subLines = renderStepDetails(step);
	return [mainLine, ...subLines];
};

/**
 * Render attributed diff for CLI output.
 */
const renderAttributedDiff = (attribution: FileDiffAttribution): string => {
	const header = bold(
		`${attribution.file_path}  ${green(`+${attribution.total_additions}`)} ${red(`-${attribution.total_deletions}`)}`,
	);

	const lines = attribution.lines.map((line) => {
		const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
		const colorFn = line.type === "add" ? green : line.type === "remove" ? red : dim;
		const content = colorFn(`${prefix} ${line.content}`);
		const agentTag = line.agent_name ? dim(` [${line.agent_name}]`) : "";
		return `${content}${agentTag}`;
	});

	return [header, "", ...lines].join("\n");
};

/**
 * Render per-file detail timeline for a given file path.
 */
export const renderEditsDetail = (distilled: DistilledSession, filePath: string): string => {
	const chains = distilled.edit_chains?.chains ?? [];
	const chain = chains.find((c) => c.file_path === filePath);

	if (!chain) {
		return red(`No edit chain found for file: ${filePath}`);
	}

	// Check for diff attribution
	const diffAttr = distilled.edit_chains?.diff_attribution?.find((d) => d.file_path === filePath);

	const diffSection = diffAttr
		? [renderAttributedDiff(diffAttr), "", dim("\u2500".repeat(60)), ""]
		: [];

	const agentLabel = chain.agent_name ? ` (${chain.agent_name})` : "";
	const header = bold(
		`${chain.file_path}${agentLabel} -- ${chain.total_edits} edits, ${chain.total_failures} failures, ${chain.total_reads} recovery reads (${fmtDuration(chain.effort_ms)})`,
	);

	const stepLines = chain.steps.flatMap(renderStep);

	const successCount = chain.surviving_edit_ids.length;
	const survivingLine =
		successCount > 0
			? `Successful: ${successCount} edit${successCount !== 1 ? "s" : ""}`
			: "Successful: (none)";

	const failCount = chain.abandoned_edit_ids.length;
	const abandonedLine =
		failCount > 0 ? `Failed: ${failCount} edit${failCount !== 1 ? "s" : ""}` : "Failed: (none)";

	return [...diffSection, header, "", ...stepLines, "", survivingLine, abandonedLine].join("\n");
};

/**
 * Edits CLI command handler.
 */
export const editsCommand = async (args: {
	readonly sessionId: string;
	readonly projectDir: string;
	readonly filePath?: string;
	readonly json: boolean;
}): Promise<void> => {
	const { readDistilled } = await import("../session/read");

	const distilled = readDistilled(args.sessionId, args.projectDir);

	if (!distilled) {
		throw new Error(
			`No distilled data found for session ${args.sessionId}. Run 'clens distill ${args.sessionId}' first.`,
		);
	}

	if (!distilled.edit_chains) {
		throw new Error(
			`No edit chains found in distilled data for session ${args.sessionId}. Re-run distill to generate edit chains.`,
		);
	}

	if (args.json) {
		if (args.filePath) {
			const chain = distilled.edit_chains.chains.find((c) => c.file_path === args.filePath) ?? null;
			const diffAttr = distilled.edit_chains.diff_attribution?.find(
				(d) => d.file_path === args.filePath,
			);
			const output = chain
				? { ...chain, ...(diffAttr ? { diff_attribution: diffAttr } : {}) }
				: null;
			console.log(JSON.stringify(output, null, 2));
		} else {
			console.log(JSON.stringify(distilled.edit_chains, null, 2));
		}
		return;
	}

	if (args.filePath) {
		console.log(renderEditsDetail(distilled, args.filePath));
	} else {
		console.log(renderEditsSummary(distilled));
	}
};

import type { DistilledSession, SessionConfig } from "../types";
import { classifySeverity, truncate } from "./format-helpers";
import { bold, cyan, dim, green } from "./shared";

// --- Config line (pure) ---

/**
 * Dense single-line summary of a session's effective config. Omits segments with
 * no data; returns undefined when nothing is known (so callers can skip the line).
 * Pure — no I/O, no ANSI — so it is unit-testable in isolation.
 */
export const formatConfigLine = (config: SessionConfig | undefined): string | undefined => {
	if (!config) return undefined;
	const segments = [
		config.permission_mode ? `perm:${config.permission_mode}` : undefined,
		config.effort ? `effort:${config.effort}` : undefined,
		config.mcp_servers.length > 0
			? `mcp:${config.mcp_servers.map((s) => s.name).join(",")}`
			: undefined,
	].filter((s): s is string => s !== undefined);
	return segments.length > 0 ? segments.join(" · ") : undefined;
};

// --- Section builders ---

const getRequestSection = (distilled: DistilledSession): string => {
	const prompt = distilled.user_messages.find((m) => m.message_type === "prompt");
	return prompt ? truncate(prompt.content.replace(/\n/g, " "), 200) : "(no user prompt captured)";
};

const getOutcomeSection = (distilled: DistilledSession): string => {
	const commitCount = distilled.git_diff.commits.length;
	const wtc = distilled.git_diff.working_tree_changes;
	const wtcSummary = wtc && wtc.length > 0
		? `${wtc.length} working tree change${wtc.length === 1 ? "" : "s"}`
		: "no working tree changes";
	const statusStr = distilled.complete ? "completed" : "incomplete";
	return commitCount > 0
		? `${commitCount} commit${commitCount === 1 ? "" : "s"}, ${wtcSummary}, ${statusStr}`
		: `${wtcSummary}, ${statusStr}`;
};

const getContextSection = (distilled: DistilledSession): string => {
	const cc = distilled.context_consumption;
	if (!cc) return "(no context data)";
	const peak = Math.round(cc.peak_context_pct);
	const compactions = cc.compaction_count;
	const velocity = cc.context_velocity_per_min.toFixed(1);
	return `${peak}% peak (${compactions} compaction${compactions === 1 ? "" : "s"}), velocity: ${velocity}%/min`;
};

const getCostSection = (distilled: DistilledSession): string => {
	const cost = distilled.cost_estimate ?? distilled.stats.cost_estimate;
	if (!cost) return "(no cost data)";
	const prefix = cost.is_estimated ? "~" : "";
	const model = cost.model;
	const tierSuffix = cost.pricing_tier ? `, ${cost.pricing_tier} tier` : "";
	return `${prefix}$${cost.estimated_cost_usd.toFixed(2)} (${model}${tierSuffix})`;
};

const getIssuesSection = (distilled: DistilledSession): readonly string[] => {
	const btCount = distilled.backtracks.length;
	const btLine = btCount === 0
		? `  Backtracks: ${green("0")} -- clean session`
		: `  Backtracks: ${btCount} (${classifySeverity(btCount).color(classifySeverity(btCount).label)})`;

	const errorLines = (distilled.summary?.top_errors ?? [])
		.slice(0, 2)
		.map((err) => {
			const msg = err.sample_message ? `: ${truncate(err.sample_message, 60)}` : "";
			return `  ${err.tool_name} x${err.count}${msg}`;
		});

	return [btLine, ...errorLines];
};

const getFilesChangedSection = (distilled: DistilledSession): readonly string[] => {
	const changed = distilled.file_map.files
		.filter((f) => f.edits > 0 || f.writes > 0)
		.slice(0, 15);

	if (changed.length === 0) return [dim("  (no files changed)")];

	return changed.map((f) => {
		const parts = [
			f.edits > 0 ? `${f.edits} edit${f.edits === 1 ? "" : "s"}` : undefined,
			f.writes > 0 ? `${f.writes} write${f.writes === 1 ? "" : "s"}` : undefined,
		].filter(Boolean).join(", ");
		return `  ${f.file_path} ${dim(`(${parts})`)}`;
	});
};

// --- JSON output ---

interface WhatJson {
	readonly request: string | null;
	readonly outcome: {
		readonly commits: number;
		readonly working_tree_changes: number;
		readonly complete: boolean;
	};
	readonly cost: {
		readonly estimated_cost_usd: number;
		readonly is_estimated: boolean;
		readonly model: string;
	} | null;
	readonly issues: {
		readonly backtrack_count: number;
		readonly top_errors: readonly {
			readonly tool_name: string;
			readonly count: number;
			readonly sample_message?: string;
		}[];
	};
	readonly context: {
		readonly peak_context_pct: number;
		readonly compaction_count: number;
		readonly context_velocity_per_min: number;
		readonly model_context_window: number;
		readonly turn_count: number;
	} | null;
	readonly files_changed: readonly string[];
	readonly config: SessionConfig | null;
}

const buildWhatJson = (distilled: DistilledSession): WhatJson => {
	const prompt = distilled.user_messages.find((m) => m.message_type === "prompt");
	const cost = distilled.cost_estimate ?? distilled.stats.cost_estimate;

	return {
		request: prompt ? prompt.content : null,
		outcome: {
			commits: distilled.git_diff.commits.length,
			working_tree_changes: distilled.git_diff.working_tree_changes?.length ?? 0,
			complete: distilled.complete,
		},
		cost: cost
			? {
					estimated_cost_usd: cost.estimated_cost_usd,
					is_estimated: cost.is_estimated,
					model: cost.model,
				}
			: null,
		issues: {
			backtrack_count: distilled.backtracks.length,
			top_errors: (distilled.summary?.top_errors ?? []).slice(0, 2).map((e) => ({
				tool_name: e.tool_name,
				count: e.count,
				...(e.sample_message ? { sample_message: e.sample_message } : {}),
			})),
		},
		context: distilled.context_consumption
			? {
					peak_context_pct: distilled.context_consumption.peak_context_pct,
					compaction_count: distilled.context_consumption.compaction_count,
					context_velocity_per_min: distilled.context_consumption.context_velocity_per_min,
					model_context_window: distilled.context_consumption.model_context_window,
					turn_count: distilled.context_consumption.turn_count,
				}
			: null,
		files_changed: distilled.file_map.files
			.filter((f) => f.edits > 0 || f.writes > 0)
			.map((f) => f.file_path)
			.slice(0, 15),
		config: distilled.session_config ?? null,
	};
};

// --- Renderers ---

const renderWhatDefault = (distilled: DistilledSession): string => {
	const issues = getIssuesSection(distilled);
	const files = getFilesChangedSection(distilled);
	const configLine = formatConfigLine(distilled.session_config);

	return [
		`${bold("Request:")} ${getRequestSection(distilled)}`,
		`${bold("Outcome:")} ${getOutcomeSection(distilled)}`,
		`${bold("Cost:")}    ${getCostSection(distilled)}`,
		`${bold("Context:")} ${getContextSection(distilled)}`,
		...(configLine ? [`${bold("Config:")}  ${configLine}`] : []),
		"",
		bold("Issues:"),
		...issues,
		"",
		bold("Files changed:"),
		...files,
	].join("\n");
};

// --- Command handler ---

export const whatCommand = async (args: {
	readonly sessionId: string;
	readonly projectDir: string;
	readonly json: boolean;
	readonly pricingTier?: import("../types").PricingTier;
}): Promise<void> => {
	const { readDistilled } = await import("../session/read");

	// If --pricing is passed, re-distill to recalculate costs at the requested tier
	const distilled = args.pricingTier
		? await (async () => {
				const { distill } = await import("../distill/index");
				return distill(args.sessionId, args.projectDir, { pricingTier: args.pricingTier });
			})()
		: readDistilled(args.sessionId, args.projectDir);

	if (!distilled) {
		throw new Error(
			`No distilled data for session ${args.sessionId.slice(0, 8)}. Run: clens distill ${args.sessionId.slice(0, 8)}`,
		);
	}

	if (args.json) {
		console.log(JSON.stringify(buildWhatJson(distilled), null, 2));
		return;
	}

	console.log(renderWhatDefault(distilled));
};

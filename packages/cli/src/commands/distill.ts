import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import type { BacktrackResult, CostEstimate, DistilledSession, GlobalSessionSummary } from "../types/distill";
import type { PricingTier } from "../types";
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

/** Format cost line: "$0.43 (claude-sonnet-4-6, api tier)" or "~$0.43 (rough estimate)" */
const formatCost = (ce: CostEstimate): string => {
	const prefix = ce.is_estimated ? "~" : "";
	const tierSuffix = ce.pricing_tier ? `, ${ce.pricing_tier} tier` : "";
	const suffix = ce.is_estimated ? " (rough estimate)" : ` (${ce.model}${tierSuffix})`;
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
		metricLine("Context:", result.context_consumption
			? `${Math.round(result.context_consumption.peak_context_pct)}% peak, ${result.context_consumption.compaction_count} compaction${result.context_consumption.compaction_count === 1 ? "" : "s"}`
			: "n/a"),
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
	readonly pricingTier?: import("../types").PricingTier;
}): Promise<void> => {
	const { distill } = await import("../distill/index");
	const result = await distill(args.sessionId, args.projectDir, {
		deep: args.deep,
		pricingTier: args.pricingTier,
	});

	// Save distilled result to disk
	const distilledDir = `${args.projectDir}/.clens/distilled`;
	mkdirSync(distilledDir, { recursive: true });
	writeFileSync(`${distilledDir}/${args.sessionId}.json`, JSON.stringify(result, null, 2));

	// Write analytics summary row (best-effort)
	try {
		const { writeAnalyticsSummary } = await import("../distill/analytics-summary");
		writeAnalyticsSummary(result, args.projectDir);
	} catch { /* best-effort — summary is a derived artifact */ }

	// Rebuild work unit index (best-effort)
	try {
		const { rebuildWorkUnitIndex } = await import("../session/work-units");
		rebuildWorkUnitIndex(args.projectDir);
	} catch { /* best-effort — index is a derived artifact */ }

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

// ── Batch drivers ────────────────────────────────────────

/** Tally of a batch distill run. */
export type BatchDistillCounts = {
	readonly distilled: number;
	readonly skipped: number;
	readonly failed: number;
};

/** Cross-repo batch tally (adds project span). */
export type GlobalDistillCounts = BatchDistillCounts & {
	readonly projectCount: number;
};

/**
 * True iff `distilledFile` exists and is at least as new as `sessionFile`.
 * Raw `.jsonl` is append-only, so a distilled artifact newer than its source
 * session is up to date and can be skipped on an incremental run.
 */
export const isDistilledFresh = (sessionFile: string, distilledFile: string): boolean => {
	if (!existsSync(distilledFile) || !existsSync(sessionFile)) return false;
	return statSync(distilledFile).mtimeMs >= statSync(sessionFile).mtimeMs;
};

const sessionFilePath = (captureDir: string, sessionId: string): string =>
	`${captureDir}/.clens/sessions/${sessionId}.jsonl`;

const distilledFilePath = (captureDir: string, sessionId: string): string =>
	`${captureDir}/.clens/distilled/${sessionId}.json`;

/**
 * Distill every session captured in a single project dir (cwd batch).
 * Skips sessions whose distilled artifact is already fresh unless `force`.
 * One bad session is counted, never fatal. Returns the run tally.
 */
export const distillAllInDir = async (args: {
	readonly projectDir: string;
	readonly deep: boolean;
	readonly pricingTier?: PricingTier;
	readonly force: boolean;
}): Promise<BatchDistillCounts> => {
	const { listSessions } = await import("../session/read");
	const sessions = listSessions(args.projectDir);
	if (sessions.length === 0) {
		console.log("No sessions found.");
		return { distilled: 0, skipped: 0, failed: 0 };
	}

	console.log(`Distilling ${sessions.length} session(s)...`);
	const counts = await sessions.reduce<Promise<BatchDistillCounts>>(
		async (accP, session, idx) => {
			const acc = await accP;
			const progress = `[${idx + 1}/${sessions.length}]`;
			const prefix = session.session_id.slice(0, 8);
			const fresh =
				!args.force &&
				isDistilledFresh(
					sessionFilePath(args.projectDir, session.session_id),
					distilledFilePath(args.projectDir, session.session_id),
				);
			if (fresh) {
				console.log(`${progress} ${prefix}… (up to date, skipped)`);
				return { ...acc, skipped: acc.skipped + 1 };
			}
			console.log(`${progress} ${prefix}...`);
			try {
				await distillCommand({
					sessionId: session.session_id,
					projectDir: args.projectDir,
					deep: args.deep,
					json: false,
					pricingTier: args.pricingTier,
				});
				return { ...acc, distilled: acc.distilled + 1 };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`  Error: ${msg}`);
				return { ...acc, failed: acc.failed + 1 };
			}
		},
		Promise.resolve({ distilled: 0, skipped: 0, failed: 0 }),
	);

	console.log(
		`\nDistilled ${counts.distilled}, skipped ${counts.skipped}, failed ${counts.failed} of ${sessions.length} session(s).`,
	);
	return counts;
};

/**
 * Distill every session across every registered project, writing each result
 * into its own (possibly nested) `.clens/distilled/`. Sessions are grouped by
 * project for readable output. Incremental by default; `force` re-distills all.
 *
 * `sessions` is injectable for testing; it defaults to `listGlobalSessions()`.
 */
export const distillAllGlobal = async (args: {
	readonly deep: boolean;
	readonly pricingTier?: PricingTier;
	readonly force: boolean;
	readonly sessions?: readonly GlobalSessionSummary[];
}): Promise<GlobalDistillCounts> => {
	const sessions =
		args.sessions ?? (await import("../session/global-read")).listGlobalSessions();
	if (sessions.length === 0) {
		throw new Error(
			"No sessions found across registered projects. Run 'clens init --global' or 'clens list --global' first.",
		);
	}

	console.log(`Distilling ${sessions.length} session(s) across registered projects...`);

	type Acc = BatchDistillCounts & { readonly lastProject?: string };
	const final = await sessions.reduce<Promise<Acc>>(
		async (accP, s, idx) => {
			const acc = await accP;
			const progress = `[${idx + 1}/${sessions.length}]`;
			const prefix = s.session_id.slice(0, 8);
			const header = acc.lastProject !== s.project_name ? [`\n── ${s.project_name} ──`] : [];
			header.forEach((h) => console.log(h));
			const base: Acc = { ...acc, lastProject: s.project_name };

			const fresh =
				!args.force &&
				isDistilledFresh(
					sessionFilePath(s.capture_dir, s.session_id),
					distilledFilePath(s.capture_dir, s.session_id),
				);
			if (fresh) {
				console.log(`${progress} ${prefix}… (up to date, skipped)`);
				return { ...base, skipped: base.skipped + 1 };
			}
			console.log(`${progress} ${prefix}...`);
			try {
				await distillCommand({
					sessionId: s.session_id,
					projectDir: s.capture_dir,
					deep: args.deep,
					json: false,
					pricingTier: args.pricingTier,
				});
				return { ...base, distilled: base.distilled + 1 };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`  Error (${prefix}): ${msg}`);
				return { ...base, failed: base.failed + 1 };
			}
		},
		Promise.resolve({ distilled: 0, skipped: 0, failed: 0 }),
	);

	const projectCount = new Set(sessions.map((s) => s.project_name)).size;
	console.log(
		`\nDistilled ${final.distilled}, skipped ${final.skipped}, failed ${final.failed} across ${projectCount} projects.`,
	);
	return {
		distilled: final.distilled,
		skipped: final.skipped,
		failed: final.failed,
		projectCount,
	};
};

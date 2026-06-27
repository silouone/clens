import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { CostBasis, CostEstimate, DistilledSession, AnalyticsSummaryRow } from "../types";

/**
 * Derive the cost provenance for a summary row from a distilled session's cost estimate.
 *
 * Prefers the explicit `cost_basis` stamped at distill time. For rows distilled before the
 * cost-truth work (no `cost_basis` tag), `is_estimated === false` historically meant
 * token-grounded — i.e. "estimated", NEVER measured `total_cost_usd` (the measured tier did
 * not exist yet). Mapping it to "measured" would inflate measured_fraction and under-report
 * the "X% estimated" badge, so legacy token-grounded rows are "estimated" and the rest
 * "heuristic". Only an explicit tag can claim "measured".
 */
const deriveCostBasis = (ce: CostEstimate | undefined): CostBasis => {
	if (!ce) return "heuristic";
	if (ce.cost_basis) return ce.cost_basis;
	return ce.is_estimated === false ? "estimated" : "heuristic";
};

/**
 * Format a timestamp as a LOCAL calendar day "YYYY-MM-DD".
 *
 * Day bucketing previously used `toISOString().slice(0,10)` which buckets by UTC
 * day — a session at 23:30 local on the 14th (in a negative-offset zone) landed
 * on the 15th, and vice versa. Analytics must bucket by the user's local day so
 * sessions appear under the date they actually worked (see B18).
 */
export const localDayKey = (ms: number): string => {
	const d = new Date(ms);
	const year = d.getFullYear();
	const month = `${d.getMonth() + 1}`.padStart(2, "0");
	const day = `${d.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
};

/** Extract an analytics summary row from a distilled session. */
const toSummaryRow = (d: DistilledSession): AnalyticsSummaryRow => {
	const stats = d.stats;
	const ce = stats.cost_estimate;
	const tu = stats.token_usage;

	// Token fallback: token_usage > cost_estimate fields > zeros
	const inputTokens = tu?.input_tokens ?? ce?.estimated_input_tokens ?? 0;
	const outputTokens = tu?.output_tokens ?? ce?.estimated_output_tokens ?? 0;
	const cacheRead = tu?.cache_read_tokens ?? ce?.cache_read_tokens ?? 0;
	const cacheCreate = tu?.cache_creation_tokens ?? ce?.cache_creation_tokens ?? 0;

	// Agent type breakdown
	const agentTypes = (d.agents ?? []).map((a) => ({
		type: a.agent_type,
		count: 1,
		cost: a.cost_estimate?.estimated_cost_usd ?? 0,
		duration_ms: a.duration_ms,
		tool_calls: a.tool_call_count,
		failure_count: a.stats?.failure_count ?? 0,
	}));

	// Reasoning by intent
	const reasoningByIntent = d.reasoning.reduce<Record<string, number>>(
		(acc, r) => ({
			...acc,
			[r.intent_hint ?? "unclassified"]: (acc[r.intent_hint ?? "unclassified"] ?? 0) + 1,
		}),
		{},
	);

	// Decision types
	const decisionTypes = d.decisions.reduce<Record<string, number>>(
		(acc, dec) => ({ ...acc, [dec.type]: (acc[dec.type] ?? 0) + 1 }),
		{},
	);

	// Edit chain stats. edit_chain_links is the total number of edits across all
	// chains; dividing by edit_chain_count yields the real mean chain length (B19).
	const chains = d.edit_chains?.chains ?? [];
	const abandonedEdits = chains.reduce((sum, c) => sum + c.abandoned_edit_ids.length, 0);
	const survivingEdits = chains.reduce((sum, c) => sum + c.surviving_edit_ids.length, 0);
	const editChainLinks = chains.reduce((sum, c) => sum + c.total_edits, 0);

	// Top errors from summary
	const topErrors = (d.summary?.top_errors ?? []).map((e) => ({
		tool: e.tool_name,
		message: e.sample_message ?? "",
		count: e.count,
	}));

	// Backtrack files
	const backtrackFiles = [...new Set(d.backtracks.flatMap((b) => (b.file_path ? [b.file_path] : [])))];

	// Backtracks by type
	const backtracksByType = d.backtracks.reduce<Record<string, number>>(
		(acc, b) => ({ ...acc, [b.type]: (acc[b.type] ?? 0) + 1 }),
		{},
	);

	// Per-tool call counts (denominator for tool failure rates; see B11) and failures
	const toolsByName = stats.tools_by_name ?? {};
	const failuresByTool = stats.failures_by_tool ?? {};

	// Date: use start_time, fallback to now — bucketed by LOCAL calendar day (B18)
	const dateStr = localDayKey(d.start_time ?? Date.now());

	// Cost-truth provenance. cost_usd is the API-equivalent value (full list price);
	// measured_cost_usd is the portion of it backed by a real measured cost (else 0).
	const costUsd = ce?.estimated_cost_usd ?? 0;
	const costBasis = deriveCostBasis(ce);
	const measuredCostUsd = costBasis === "measured" ? costUsd : 0;

	return {
		session_id: d.session_id,
		date: dateStr,
		duration_ms: stats.duration_ms,
		model: stats.model ?? ce?.model,
		cost_usd: costUsd,
		cost_basis: costBasis,
		measured_cost_usd: measuredCostUsd,
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		cache_read_tokens: cacheRead,
		cache_creation_tokens: cacheCreate,
		is_estimated: ce?.is_estimated ?? true,
		tool_call_count: stats.tool_call_count,
		failure_count: stats.failure_count,
		tools_by_name: toolsByName,
		failures_by_tool: failuresByTool,
		agent_count: d.agents?.length ?? 0,
		agent_types: agentTypes,
		backtrack_count: d.backtracks.length,
		backtracks_by_type: backtracksByType,
		backtrack_files: backtrackFiles,
		reasoning_by_intent: reasoningByIntent,
		edit_chain_count: chains.length,
		edit_chain_links: editChainLinks,
		abandoned_edits: abandonedEdits,
		surviving_edits: survivingEdits,
		drift_score: d.plan_drift?.drift_score,
		unexpected_files: d.plan_drift?.unexpected_files.length,
		decision_types: decisionTypes,
		top_errors: topErrors,
	};
};

const summaryPath = (projectDir: string): string =>
	`${projectDir}/.clens/analytics-summary.jsonl`;

/**
 * Write or replace an analytics summary row for a session.
 * Appends to analytics-summary.jsonl (or replaces if session already exists).
 */
export const writeAnalyticsSummary = (
	distilled: DistilledSession,
	projectDir: string,
): void => {
	const filePath = summaryPath(projectDir);
	const row = toSummaryRow(distilled);
	const line = JSON.stringify(row);

	const dir = `${projectDir}/.clens`;
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	if (!existsSync(filePath)) {
		writeFileSync(filePath, `${line}\n`);
		return;
	}

	// Read existing lines, replace if session exists, otherwise append
	const existing = readFileSync(filePath, "utf-8");
	const lines = existing.split("\n").filter(Boolean);
	const sessionPrefix = `"session_id":"${row.session_id}"`;
	const replaced = lines.some((l) => l.includes(sessionPrefix));

	if (replaced) {
		const updated = lines.map((l) => (l.includes(sessionPrefix) ? line : l));
		writeFileSync(filePath, `${updated.join("\n")}\n`);
	} else {
		appendFileSync(filePath, `${line}\n`);
	}
};

/**
 * Read all analytics summary rows.
 * Fast path: reads pre-computed analytics-summary.jsonl.
 * Fallback: reads all distilled/*.json files and extracts summary rows (slower, auto-generates JSONL).
 */
export const readAnalyticsSummary = (projectDir: string): readonly AnalyticsSummaryRow[] => {
	const filePath = summaryPath(projectDir);

	// Fast path: pre-computed JSONL exists
	if (existsSync(filePath)) {
		const content = readFileSync(filePath, "utf-8");
		const rows = content
			.split("\n")
			.filter(Boolean)
			.flatMap((line): readonly AnalyticsSummaryRow[] => {
				try {
					const parsed: unknown = JSON.parse(line);
					if (parsed && typeof parsed === "object" && "session_id" in parsed) {
						return [parsed as AnalyticsSummaryRow];
					}
					return [];
				} catch {
					return [];
				}
			});
		if (rows.length > 0) return rows;
	}

	// Fallback: read all distilled/*.json and build summary rows
	const distilledDir = `${projectDir}/.clens/distilled`;
	if (!existsSync(distilledDir)) return [];

	const files = readdirSync(distilledDir).filter((f) => f.endsWith(".json"));
	if (files.length === 0) return [];

	const rows: AnalyticsSummaryRow[] = [];
	for (const file of files) {
		try {
			const content = readFileSync(`${distilledDir}/${file}`, "utf-8");
			const distilled = JSON.parse(content) as DistilledSession;
			if (distilled.session_id && distilled.stats) {
				rows.push(toSummaryRow(distilled));
			}
		} catch {
			// Skip malformed files
		}
	}

	// Auto-generate the JSONL file for next time
	if (rows.length > 0) {
		const dir = `${projectDir}/.clens`;
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const lines = rows.map((r) => JSON.stringify(r)).join("\n");
		writeFileSync(filePath, `${lines}\n`);
	}

	return rows;
};

/**
 * Force-rebuild analytics-summary.jsonl from all distilled/*.json files.
 * Returns the number of sessions rebuilt.
 */
export const rebuildAnalyticsSummary = (projectDir: string): number => {
	const distilledDir = `${projectDir}/.clens/distilled`;
	if (!existsSync(distilledDir)) return 0;

	const files = readdirSync(distilledDir).filter((f) => f.endsWith(".json"));
	if (files.length === 0) return 0;

	const rows: AnalyticsSummaryRow[] = [];
	for (const file of files) {
		try {
			const content = readFileSync(`${distilledDir}/${file}`, "utf-8");
			const distilled = JSON.parse(content) as DistilledSession;
			if (distilled.session_id && distilled.stats) {
				rows.push(toSummaryRow(distilled));
			}
		} catch {
			// Skip malformed files
		}
	}

	if (rows.length > 0) {
		const dir = `${projectDir}/.clens`;
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const filePath = summaryPath(projectDir);
		const lines = rows.map((r) => JSON.stringify(r)).join("\n");
		writeFileSync(filePath, `${lines}\n`);
	}

	return rows.length;
};

export { toSummaryRow };

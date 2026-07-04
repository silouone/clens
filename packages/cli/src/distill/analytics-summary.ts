import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import type { AnalyticsSummaryRow, CostBasis, CostEstimate, DistilledSession } from "../types";

/**
 * Atomically write content to a file: write to a unique temp sibling, then
 * rename it over the target. `rename(2)` is atomic on the same filesystem, so a
 * concurrent reader observes either the old file or the new one in full — never
 * a half-written file. The temp name is keyed by pid + timestamp to avoid
 * clobbering between concurrent writers.
 */
const atomicWriteFile = (filePath: string, content: string): void => {
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmpPath, content);
	renameSync(tmpPath, filePath);
};

/** Parse a JSONL line's `session_id`, or undefined if the line is malformed. */
const lineSessionId = (line: string): string | undefined => {
	try {
		const parsed: unknown = JSON.parse(line);
		if (parsed && typeof parsed === "object" && "session_id" in parsed) {
			const id = (parsed as { session_id?: unknown }).session_id;
			return typeof id === "string" ? id : undefined;
		}
	} catch {
		// malformed line
	}
	return undefined;
};

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
	const backtrackFiles = [
		...new Set(d.backtracks.flatMap((b) => (b.file_path ? [b.file_path] : []))),
	];

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

const summaryPath = (projectDir: string): string => `${projectDir}/.clens/analytics-summary.jsonl`;

/** Parse JSONL summary content into rows, skipping malformed/non-row lines. */
const parseSummaryRows = (content: string): AnalyticsSummaryRow[] =>
	content
		.split("\n")
		.filter(Boolean)
		.flatMap((line): AnalyticsSummaryRow[] => {
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

/**
 * Load the existing summary file as a map of session_id → raw JSONL line,
 * preserving file order (a `Map` keeps insertion order; updating an existing key
 * keeps its original slot). Keyed on the parsed JSON id (not a substring scan) so
 * an id appearing inside another row's free-text field — e.g. an error message or
 * file path — cannot trigger a false match.
 */
const loadSummaryLineMap = (filePath: string): Map<string, string> => {
	const map = new Map<string, string>();
	if (!existsSync(filePath)) return map;
	for (const line of readFileSync(filePath, "utf-8").split("\n").filter(Boolean)) {
		const id = lineSessionId(line);
		if (id !== undefined) map.set(id, line);
	}
	return map;
};

/**
 * Write or replace analytics summary rows for a batch of sessions in a SINGLE
 * pass: load the existing file once, merge every row in memory (last write wins
 * per session_id, existing rows preserved), then flush once via atomic
 * temp+rename. A batch distill of N sessions thus performs O(N) total summary
 * work, not the O(N²) of re-reading and re-writing the whole file per session.
 */
export const writeAnalyticsSummaryBatch = (
	distilled: readonly DistilledSession[],
	projectDir: string,
): void => {
	if (distilled.length === 0) return;
	const filePath = summaryPath(projectDir);
	const byId = loadSummaryLineMap(filePath);
	for (const d of distilled) {
		const row = toSummaryRow(d);
		byId.set(row.session_id, JSON.stringify(row));
	}

	const dir = `${projectDir}/.clens`;
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	atomicWriteFile(filePath, `${[...byId.values()].join("\n")}\n`);
};

/**
 * Write or replace a single session's analytics summary row. Thin wrapper over
 * the batch writer (one read + one atomic write).
 */
export const writeAnalyticsSummary = (distilled: DistilledSession, projectDir: string): void =>
	writeAnalyticsSummaryBatch([distilled], projectDir);

/** True iff the distilled file is strictly newer than the summary file. */
const distilledNewerThanSummary = (distilledFilePath: string, summaryMtimeMs: number): boolean => {
	try {
		return statSync(distilledFilePath).mtimeMs > summaryMtimeMs;
	} catch {
		return false;
	}
};

/** Build a summary row from a distilled file on disk, or undefined if unreadable. */
const buildRowFromDistilled = (distilledFilePath: string): AnalyticsSummaryRow | undefined => {
	try {
		const distilled = JSON.parse(readFileSync(distilledFilePath, "utf-8")) as DistilledSession;
		if (distilled.session_id && distilled.stats) return toSummaryRow(distilled);
	} catch {
		// malformed distilled file
	}
	return undefined;
};

/**
 * Read all analytics summary rows, reconciled against `distilled/` on disk. This
 * is a PURE read: it never mutates disk.
 *
 * The cached `analytics-summary.jsonl` can silently diverge from `distilled/` —
 * rows lost to a write race or mid-batch crash, or rows left stale by a
 * re-distill (the cache once reported 317 rows against 320 distilled sessions).
 * So `distilled/` is the source of truth for BOTH which sessions count as
 * analyzed AND whether each cached row is current:
 *   • a cached row is reused only when its distilled file is no newer than the
 *     summary file (mtime check) — otherwise it is rebuilt from distilled;
 *   • a distilled file with no cached row is built fresh (recovers lost rows);
 *   • a cached row with no distilled file is dropped, so the returned count
 *     equals the distilled-on-disk count (coverage no longer under-reports).
 *
 * Reconciliation stays in memory; `rebuildAnalyticsSummary` re-materializes the
 * file explicitly so a read can never race on (or corrupt) the summary file.
 */
export const readAnalyticsSummary = (projectDir: string): readonly AnalyticsSummaryRow[] => {
	const filePath = summaryPath(projectDir);
	const distilledDir = `${projectDir}/.clens/distilled`;

	// No distilled/ dir → nothing to reconcile against; return cached rows verbatim.
	if (!existsSync(distilledDir)) {
		return existsSync(filePath) ? parseSummaryRows(readFileSync(filePath, "utf-8")) : [];
	}

	const files = readdirSync(distilledDir).filter((f) => f.endsWith(".json"));
	if (files.length === 0) return [];

	const cachedById = new Map<string, AnalyticsSummaryRow>();
	let summaryMtimeMs = 0;
	if (existsSync(filePath)) {
		summaryMtimeMs = statSync(filePath).mtimeMs;
		for (const row of parseSummaryRows(readFileSync(filePath, "utf-8"))) {
			cachedById.set(row.session_id, row);
		}
	}

	const rows: AnalyticsSummaryRow[] = [];
	for (const file of files) {
		const sessionId = file.slice(0, -".json".length);
		const distilledFilePath = `${distilledDir}/${file}`;
		const cached = cachedById.get(sessionId);
		if (cached && !distilledNewerThanSummary(distilledFilePath, summaryMtimeMs)) {
			rows.push(cached);
			continue;
		}
		// Missing or stale → rebuild from distilled, falling back to the stale
		// cached row only if the distilled file is unreadable.
		const next = buildRowFromDistilled(distilledFilePath) ?? cached;
		if (next) rows.push(next);
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
		atomicWriteFile(filePath, `${lines}\n`);
	}

	return rows.length;
};

export { toSummaryRow };

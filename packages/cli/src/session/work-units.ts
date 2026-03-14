import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { LinkEvent, WorkUnit, WorkUnitIndex } from "../types";
import { buildWorkUnitIndex, type DistilledSessionSummary } from "../distill/work-units";
import { parseDistilledSession } from "./parsers";
import { readLinks } from "./read";
import { logError } from "../utils";

// --- File path helpers ---

const workUnitIndexPath = (projectDir: string): string =>
	`${projectDir}/.clens/_work_units.json`;

// --- Subagent detection ---

/**
 * Build a set of session IDs that are subagents (spawned by other sessions).
 * Reads `_links.jsonl` and filters for spawn links.
 */
export const buildSubagentIdSet = (projectDir: string): ReadonlySet<string> => {
	const links = readLinks(projectDir);
	return new Set(
		links
			.filter((link): link is LinkEvent & { readonly type: "spawn" } => link.type === "spawn")
			.map((link) => link.agent_id),
	);
};

// --- Read ---

/**
 * Read the work unit index from `.clens/_work_units.json`.
 * Returns undefined if the file doesn't exist or is invalid.
 */
export const readWorkUnitIndex = (projectDir: string): WorkUnitIndex | undefined => {
	const filePath = workUnitIndexPath(projectDir);
	if (!existsSync(filePath)) return undefined;
	try {
		const content = readFileSync(filePath, "utf-8");
		const parsed: unknown = JSON.parse(content);
		if (
			parsed &&
			typeof parsed === "object" &&
			"version" in parsed &&
			"units" in parsed &&
			"updated_at" in parsed
		) {
			return parsed as WorkUnitIndex;
		}
		return undefined;
	} catch (err) {
		logError(projectDir, "readWorkUnitIndex", err);
		return undefined;
	}
};

// --- Write ---

/**
 * Write the work unit index to `.clens/_work_units.json`.
 */
export const writeWorkUnitIndex = (index: WorkUnitIndex, projectDir: string): void => {
	const clensDir = `${projectDir}/.clens`;
	mkdirSync(clensDir, { recursive: true });
	writeFileSync(workUnitIndexPath(projectDir), JSON.stringify(index, null, 2));
};

// --- Rebuild ---

/**
 * Read all distilled session JSON files and extract summary data
 * needed for work unit index building.
 */
const readDistilledSessions = (projectDir: string): readonly DistilledSessionSummary[] => {
	const distilledDir = `${projectDir}/.clens/distilled`;
	if (!existsSync(distilledDir)) return [];

	const files = readdirSync(distilledDir).filter((f) => f.endsWith(".json"));

	return files.flatMap((file): readonly DistilledSessionSummary[] => {
		const filePath = `${distilledDir}/${file}`;
		try {
			const content = readFileSync(filePath, "utf-8");
			const session = parseDistilledSession(content);
			if (!session) return [];

			// Read git_branch from the session JSONL first event
			const sessionId = file.replace(".json", "");
			const gitBranch = resolveGitBranch(sessionId, projectDir);

			const summary: DistilledSessionSummary = {
				session_id: session.session_id,
				session_name: session.session_name,
				start_time: session.start_time ?? 0,
				file_map: session.file_map,
				plan_drift: session.plan_drift,
				user_messages: session.user_messages,
				duration_ms: session.stats.duration_ms,
				git_branch: gitBranch,
				tool_call_count: session.stats.tool_call_count,
				summary_phases: session.summary?.phases,
			};

			// Filter trivial sessions (zero duration AND zero tool calls)
			if (summary.duration_ms === 0 && summary.tool_call_count === 0) return [];

			return [summary];
		} catch (err) {
			logError(projectDir, `readDistilledSessions:${file}`, err);
			return [];
		}
	});
};

/**
 * Resolve git_branch from the first event of a session JSONL file.
 */
const resolveGitBranch = (sessionId: string, projectDir: string): string | undefined => {
	const filePath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`;
	if (!existsSync(filePath)) return undefined;
	try {
		const content = readFileSync(filePath, "utf-8");
		const firstNewline = content.indexOf("\n");
		const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
		if (!firstLine.trim()) return undefined;
		const parsed: unknown = JSON.parse(firstLine);
		if (parsed && typeof parsed === "object" && "context" in parsed) {
			const withCtx = parsed as Record<string, unknown>;
			const ctx = withCtx.context;
			if (ctx && typeof ctx === "object" && "git_branch" in ctx) {
				const branch = (ctx as Record<string, unknown>).git_branch;
				return typeof branch === "string" ? branch : undefined;
			}
		}
		return undefined;
	} catch {
		return undefined;
	}
};

/**
 * Rebuild the work unit index from all distilled sessions.
 * Called after distill completes to keep the index up to date.
 */
export const rebuildWorkUnitIndex = (projectDir: string): WorkUnitIndex => {
	const sessions = readDistilledSessions(projectDir);
	const subagentIds = buildSubagentIdSet(projectDir);
	const index = buildWorkUnitIndex(sessions, subagentIds);
	writeWorkUnitIndex(index, projectDir);
	return index;
};

// --- Query ---

/**
 * Get related sessions for a given session ID.
 * Returns the work unit containing this session (if any) plus the session's role.
 */
export const getRelatedSessions = (
	sessionId: string,
	projectDir: string,
): { readonly work_unit?: WorkUnit; readonly role?: string } => {
	const index = readWorkUnitIndex(projectDir);
	if (!index) return {};

	const matchingUnit = index.units.find((unit) =>
		unit.sessions.some((s) => s.session_id === sessionId),
	);

	if (!matchingUnit) return {};

	const sessionEntry = matchingUnit.sessions.find((s) => s.session_id === sessionId);
	return {
		work_unit: matchingUnit,
		role: sessionEntry?.role,
	};
};

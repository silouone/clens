import { existsSync, readFileSync } from "node:fs";
import type { SessionStartContext, StoredEvent, TokenUsage } from "../types";

/**
 * Codex CLI "rollout" import (spec option A: normalize to Claude-hook-shaped
 * `StoredEvent`s so the ~20 distill extractors, the TUI, and the web dashboards
 * work on Codex runs unchanged). A rollout is JSONL where each line is
 * `{timestamp, type, payload}`; this module is the pure mapper (file read at the
 * edge, `readRollout`). See `specs/codex-rollout-import.md`.
 */

interface RolloutRecord {
	readonly timestamp?: string;
	readonly type: string;
	readonly payload: Readonly<Record<string, unknown>>;
}

const isRolloutRecord = (value: unknown): value is RolloutRecord => {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return typeof obj.type === "string" && typeof obj.payload === "object" && obj.payload !== null;
};

/** Codex tool names → the Claude tool vocabulary the extractors branch on. */
const TOOL_NAME_MAP: Readonly<Record<string, string>> = {
	exec_command: "Bash",
	exec: "Bash",
	shell: "Bash",
	apply_patch: "Edit",
};

const mapToolName = (name: string): string => TOOL_NAME_MAP[name] ?? name;

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Parse a `function_call.arguments` JSON string into an input object (tolerant). */
const parseArguments = (raw: unknown): Readonly<Record<string, unknown>> => {
	if (typeof raw !== "string") {
		return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: { raw };
	} catch {
		return { raw };
	}
};

/**
 * Map a Codex `total_token_usage` object to the cLens `TokenUsage` shape.
 *
 * Codex's `input_tokens` is INCLUSIVE of `cached_input_tokens`, but cLens follows
 * Claude semantics where `input_tokens` EXCLUDES cache and cost sums the three
 * buckets independently (distill/stats.ts). So the cached slice is subtracted out
 * of input here — otherwise it would be billed at both the input and cache-read
 * rate.
 */
const mapUsage = (info: unknown): TokenUsage | undefined => {
	if (typeof info !== "object" || info === null) return undefined;
	const total = (info as Record<string, unknown>).total_token_usage;
	if (typeof total !== "object" || total === null) return undefined;
	const t = total as Record<string, unknown>;
	const cached = asNumber(t.cached_input_tokens);
	return {
		input_tokens: Math.max(0, asNumber(t.input_tokens) - cached),
		output_tokens: asNumber(t.output_tokens),
		cache_read_tokens: cached,
		cache_creation_tokens: 0, // Codex has no cache-write analog.
	};
};

const buildContext = (
	meta: Readonly<Record<string, unknown>>,
	model: string | null,
): SessionStartContext => {
	const cwd = asString(meta.cwd) ?? "";
	const git = (meta.git ?? {}) as Record<string, unknown>;
	return {
		project_dir: cwd,
		cwd,
		git_branch: asString(git.branch) ?? null,
		git_remote: asString(git.repository_url) ?? null,
		git_commit: asString(git.commit_hash) ?? null,
		git_worktree: null,
		team_name: null,
		task_list_dir: null,
		claude_entrypoint: "codex",
		model,
		agent_type: null,
	};
};

/** A tool INVOCATION record (function_call or custom_tool_call) → a PreToolUse. */
const isToolCall = (rec: RolloutRecord): boolean =>
	rec.type === "response_item" &&
	(rec.payload.type === "function_call" || rec.payload.type === "custom_tool_call");

/** A tool OUTPUT record (function_call_output or custom_tool_call_output). */
const isToolOutput = (rec: RolloutRecord): boolean =>
	rec.type === "response_item" &&
	(rec.payload.type === "function_call_output" || rec.payload.type === "custom_tool_call_output");

const isPatchEnd = (rec: RolloutRecord): boolean =>
	rec.type === "event_msg" && rec.payload.type === "patch_apply_end";

/** A record's ISO timestamp as epoch ms, or null when absent/invalid. */
const rawMs = (rec: RolloutRecord): number | null => {
	if (!rec.timestamp) return null;
	const ms = new Date(rec.timestamp).getTime();
	return Number.isFinite(ms) ? ms : null;
};

/**
 * Resolve every record's timestamp, forward-filling gaps: a record with no (or an
 * invalid) timestamp inherits the nearest preceding resolved time, so the emitted
 * events stay monotonic. Parallel to `records` by index. The common case (every
 * record timestamped) short-circuits to O(n).
 */
const resolveTimestamps = (records: readonly RolloutRecord[]): readonly number[] => {
	const raw = records.map(rawMs);
	return raw.map(
		(ms, i) =>
			ms ??
			raw
				.slice(0, i)
				.filter((m): m is number => m !== null)
				.at(-1) ??
			0,
	);
};

/**
 * Map parsed rollout records to Claude-hook-shaped `StoredEvent[]`.
 *
 * Invariants (from the spec's hard-won gotchas):
 * - `tool_use_id` = `call_id` on BOTH Pre and Post (never the `fc_…` id) so pairs
 *   match in backtracks / edit-chains.
 * - Cumulative usage (`total_token_usage`, monotonic) is attached to exactly ONE
 *   terminal `SessionEnd`, because `extractTokenUsage` SUMS `data.usage` across
 *   events — usage on every `token_count` would multiply the total.
 * - apply_patch's PostToolUse comes from `patch_apply_end` (structured `changes`);
 *   its `custom_tool_call_output` twin is dropped to avoid a duplicate pairing.
 */
export const rolloutToStoredEvents = (rawRecords: readonly unknown[]): StoredEvent[] => {
	const records = rawRecords.filter(isRolloutRecord);
	if (records.length === 0) return [];

	const metaRec = records.find((r) => r.type === "session_meta");
	const meta = metaRec?.payload;
	const sid = (meta && asString(meta.session_id)) ?? "unknown-codex-session";

	// Look-ahead: the model slug lives in the first turn_context, not session_meta.
	const model = asString(records.find((r) => r.type === "turn_context")?.payload.model) ?? null;

	// call_id → mapped tool name (from function_call / custom_tool_call), so a
	// bare *_output record can recover its tool name.
	const toolNameByCallId = new Map(
		records.filter(isToolCall).flatMap((rec): (readonly [string, string])[] => {
			const callId = asString(rec.payload.call_id);
			const name = asString(rec.payload.name);
			return callId && name ? [[callId, mapToolName(name)]] : [];
		}),
	);
	// call_id → file path (from patch_apply_end), injected into the apply_patch
	// PreToolUse so file-map / edit-chains light up.
	const patchPathByCallId = new Map(
		records.filter(isPatchEnd).flatMap((rec): (readonly [string, string])[] => {
			const callId = asString(rec.payload.call_id);
			const changes = Array.isArray(rec.payload.changes) ? rec.payload.changes : [];
			const path = asString((changes[0] as Record<string, unknown> | undefined)?.path);
			return callId && path ? [[callId, path]] : [];
		}),
	);
	// call_ids that have a patch_apply_end, so their custom_tool_call_output twin
	// is dropped.
	const patchedCallIds = new Set(
		records.filter(isPatchEnd).flatMap((rec) => {
			const callId = asString(rec.payload.call_id);
			return callId ? [callId] : [];
		}),
	);

	// Final cumulative usage = the LAST token_count's total_token_usage.
	const lastTokenCount = records
		.filter((r) => r.type === "event_msg" && r.payload.type === "token_count")
		.at(-1);
	const usage = lastTokenCount ? mapUsage(lastTokenCount.payload.info) : undefined;

	const resolvedTs = resolveTimestamps(records);

	const ev = (
		event: StoredEvent["event"],
		t: number,
		data: Record<string, unknown>,
	): StoredEvent => ({ t, event, sid, data });

	// One record → zero or one events (in original order).
	const mapRecord = (rec: RolloutRecord, t: number): StoredEvent[] => {
		const p = rec.payload;

		if (rec.type === "event_msg" && p.type === "user_message") {
			const message = asString(p.message);
			return message !== undefined ? [ev("UserPromptSubmit", t, { prompt: message })] : [];
		}

		if (isToolCall(rec)) {
			const callId = asString(p.call_id);
			const name = asString(p.name);
			if (!callId || !name) return [];
			const baseInput =
				p.type === "function_call" ? parseArguments(p.arguments) : parseArguments(p.input);
			// apply_patch → Edit needs a file_path for file-map / edit-chains.
			const patchPath = patchPathByCallId.get(callId);
			const toolInput = patchPath ? { ...baseInput, file_path: patchPath } : baseInput;
			return [
				ev("PreToolUse", t, {
					tool_name: mapToolName(name),
					tool_input: toolInput,
					tool_use_id: callId,
				}),
			];
		}

		if (isToolOutput(rec)) {
			const callId = asString(p.call_id);
			// Drop the apply_patch output twin — patch_apply_end is its PostToolUse.
			if (!callId || patchedCallIds.has(callId)) return [];
			return [
				ev("PostToolUse", t, {
					tool_name: toolNameByCallId.get(callId) ?? "",
					tool_response: { output: p.output },
					tool_use_id: callId,
				}),
			];
		}

		if (isPatchEnd(rec)) {
			const callId = asString(p.call_id);
			if (!callId) return [];
			return [
				ev("PostToolUse", t, {
					tool_name: toolNameByCallId.get(callId) ?? "Edit",
					tool_response: { success: p.success, changes: p.changes },
					tool_use_id: callId,
				}),
			];
		}

		if (rec.type === "event_msg" && p.type === "task_complete") {
			return [
				ev("Stop", t, {
					...(asString(p.last_agent_message) !== undefined
						? { last_agent_message: p.last_agent_message }
						: {}),
					...(typeof p.duration_ms === "number" ? { duration_ms: p.duration_ms } : {}),
				}),
			];
		}

		return [];
	};

	const startEvents: StoredEvent[] = metaRec
		? [
				{
					t: resolvedTs[records.indexOf(metaRec)] ?? 0,
					event: "SessionStart",
					sid,
					context: buildContext(metaRec.payload, model),
					data: {},
				},
			]
		: [];

	const body = records.flatMap((rec, i) => mapRecord(rec, resolvedTs[i]));

	// Single terminal SessionEnd carrying the cumulative usage → status derives
	// `complete`, and the summed usage equals the session total.
	const endEvent = ev("SessionEnd", resolvedTs.at(-1) ?? 0, usage ? { usage } : {});

	return [...startEvents, ...body, endEvent];
};

/** Read a rollout JSONL file and map it to StoredEvents (I/O at the edge). */
export const readRollout = (rolloutPath: string): StoredEvent[] => {
	if (!existsSync(rolloutPath)) return [];
	const content = readFileSync(rolloutPath, "utf-8").trim();
	if (!content) return [];
	const records = content
		.split("\n")
		.filter(Boolean)
		.flatMap((line): unknown[] => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
	return rolloutToStoredEvents(records);
};

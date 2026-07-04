import {
	closeSync,
	existsSync,
	fstatSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	statSync,
} from "node:fs";
import { resolve } from "node:path";
import type {
	AgentNode,
	ColorName,
	LinkEvent,
	ProjectEntry,
	SessionStatus,
	SessionSummary,
	SpawnLink,
	StoredEvent,
} from "clens";
import {
	enrichSessionSummaries,
	readDistilled,
	readFeatureIndex,
	readLinks,
	readSessionEvents,
	readTranscript,
	setSessionMeta,
} from "clens/src/session";
import { buildConversation, buildConversationFromTranscript } from "clens/src/session/conversation";
import {
	BROADCAST_EVENTS,
	deriveSessionStatus,
	isColorName,
	SESSION_STATUSES,
} from "clens/src/types";
import { deduplicateSpawns, diffLinesToUnified } from "clens/src/utils";
import type { Context } from "hono";
import { Hono } from "hono";
import { pathsMatch } from "../../shared/paths";
import { getCachedEvents, setCachedEvents } from "../cache";
import { createLogger } from "../logger";

const log = createLogger("sessions");

// ── Query param validation ─────────────────────────────────────────

const parseIntParam = (
	value: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number => {
	if (!value) return fallback;
	const n = parseInt(value, 10);
	return Number.isNaN(n) || n < min || n > max ? -1 : n;
};

// ── Lightweight session listing (reads only first+last lines) ──────

type ParsedEvent = {
	readonly event: string;
	readonly t: number;
	readonly data: Record<string, unknown>;
	readonly context?: Record<string, unknown>;
};

const tryParseJson = (line: string): ParsedEvent | undefined => {
	try {
		const parsed = JSON.parse(line);
		return parsed && typeof parsed === "object" && "event" in parsed ? parsed : undefined;
	} catch {
		return undefined;
	}
};

// ParsedEvent.event is a plain string (lightweight listing never validates the full
// hook-event union), so read BROADCAST_EVENTS through a string-typed view for membership.
const broadcastEventNames: ReadonlySet<string> = BROADCAST_EVENTS;
const isBroadcastEvent = (event: string): boolean => broadcastEventNames.has(event);

// Exact line counts are required (estimated counts shipped wrong numbers to the
// UI — see specs/revive/bug-register.md B1). Counting scans the whole file, so
// results are cached per path and invalidated by (size, mtimeMs).
const lineCountCache = new Map<string, { size: number; mtimeMs: number; count: number }>();

/**
 * Count non-empty lines exactly, streaming the fd in chunks (no full-file string alloc).
 * Deliberate FP exception (performance hot path): this scans up to hundreds of MB of
 * session files per listing; byte-level Buffer iteration with local mutable cursors is
 * the same class of exception fp-patterns grants hashing/byte-scanning loops.
 */
const countNonEmptyLines = (fd: number, size: number): number => {
	const CHUNK = 262144;
	const buf = Buffer.alloc(Math.min(CHUNK, size));
	let count = 0;
	let lineHasContent = false;
	let offset = 0;
	while (offset < size) {
		const bytesRead = readSync(fd, buf, 0, Math.min(CHUNK, size - offset), offset);
		if (bytesRead <= 0) break;
		for (let i = 0; i < bytesRead; ) {
			const nl = buf.indexOf(0x0a, i);
			if (nl === -1 || nl >= bytesRead) {
				if (bytesRead - i > 0) lineHasContent = true;
				break;
			}
			if (lineHasContent || nl > i) count++;
			lineHasContent = false;
			i = nl + 1;
		}
		offset += bytesRead;
	}
	if (lineHasContent) count++;
	return count;
};

/**
 * Pick the last line that parses as an event. A live write can leave the final
 * JSONL line torn (non-empty but unparseable); falling back to the last PARSEABLE
 * line keeps duration/end-reason honest instead of collapsing to the first event
 * (bug web-truncated-last-line-falls-back-to-first-event-duration-zero).
 */
const lastParseableLine = (lines: readonly string[]): string | undefined =>
	lines.findLast((l) => tryParseJson(l) !== undefined);

/** Read the first and last lines plus an exact (cached) line count. */
const readFirstLastLines = (
	filePath: string,
): { first: string; last: string; lineCount: number; lastLineTorn: boolean } | undefined => {
	const fd = openSync(filePath, "r");
	try {
		const stat = fstatSync(fd);
		if (stat.size === 0) return undefined;

		const CHUNK = 16384;

		const cached = lineCountCache.get(filePath);
		const lineCount =
			cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs
				? cached.count
				: countNonEmptyLines(fd, stat.size);
		if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) {
			lineCountCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, count: lineCount });
		}
		if (lineCount === 0) return undefined;

		// For small files (fits in one chunk), read exactly
		if (stat.size <= CHUNK) {
			const buf = Buffer.alloc(stat.size);
			readSync(fd, buf, 0, stat.size, 0);
			const text = buf.toString("utf-8");
			const lines = text.split("\n").filter(Boolean);
			if (lines.length === 0) return undefined;
			// Fall back to the last PARSEABLE line so a torn trailing line (live write)
			// does not collapse the session to its first event.
			const last = lastParseableLine(lines) ?? lines[lines.length - 1];
			const lastLineTorn = tryParseJson(lines[lines.length - 1]) === undefined;
			return { first: lines[0], last, lineCount, lastLineTorn };
		}

		// Large file: read head + tail chunks for first/last lines only
		const headBuf = Buffer.alloc(CHUNK);
		readSync(fd, headBuf, 0, CHUNK, 0);
		const headStr = headBuf.toString("utf-8");
		const firstNewline = headStr.indexOf("\n");
		if (firstNewline === -1) {
			const single = headStr.trim();
			return {
				first: single,
				last: single,
				lineCount,
				lastLineTorn: tryParseJson(single) === undefined,
			};
		}
		const first = headStr.slice(0, firstNewline);

		// Read last line from tail
		const tailBuf = Buffer.alloc(CHUNK);
		readSync(fd, tailBuf, 0, CHUNK, stat.size - CHUNK);
		const tailStr = tailBuf.toString("utf-8");
		const tailLines = tailStr.split("\n").filter(Boolean);
		// Last PARSEABLE tail line — a torn final line must not become `last`.
		const last =
			lastParseableLine(tailLines) ??
			(tailLines.length > 0 ? tailLines[tailLines.length - 1] : first);
		const lastLineTorn =
			tailLines.length > 0 && tryParseJson(tailLines[tailLines.length - 1]) === undefined;

		return { first, last, lineCount, lastLineTorn };
	} finally {
		closeSync(fd);
	}
};

/**
 * Ghost-session check for the lightweight listing — matches the CLI's listSessions
 * filter (read.ts:47-54 via isGhostSession). Claude Code broadcasts ConfigChange /
 * Notification events to EVERY open session file, so a file whose only events are
 * broadcasts is a ghost that must not appear in the list.
 *
 * The CLI parses every line, but the web list deliberately avoids full parsing for
 * speed. We mirror the CLI's own optimization: a session can only be a ghost if its
 * FIRST event is a broadcast (otherwise the leading non-broadcast event already
 * proves it real). Only for those rare ghost-candidates do we read the whole file
 * to confirm every event is a broadcast — the hot path stays first/last-only.
 */
const isGhostSessionFile = (filePath: string, firstEvent: ParsedEvent): boolean => {
	if (!isBroadcastEvent(firstEvent.event)) return false;
	const content = (() => {
		try {
			return readFileSync(filePath, "utf-8");
		} catch {
			return "";
		}
	})();
	const lines = content.split("\n").filter(Boolean);
	if (lines.length === 0) return false;
	return lines.every((l) => {
		const parsed = tryParseJson(l);
		// A torn/unparseable line is not a known broadcast event — treat the session
		// as real rather than hide it.
		return parsed !== undefined && isBroadcastEvent(parsed.event);
	});
};

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

/** Recursively search agent tree for a node with the given session_id. */
const findAgentById = (agents: readonly AgentNode[], agentId: string): AgentNode | undefined =>
	agents.reduce<AgentNode | undefined>(
		(found, node) =>
			found ?? (node.session_id === agentId ? node : findAgentById(node.children ?? [], agentId)),
		undefined,
	);

/** Count all agents recursively (includes children at every depth). */
const countAgentsRecursive = (agents: readonly { children?: readonly unknown[] }[]): number =>
	agents.reduce(
		(sum, a) =>
			sum +
			1 +
			countAgentsRecursive((a.children ?? []) as readonly { children?: readonly unknown[] }[]),
		0,
	);

/** Count all agents in a distilled JSON file (recursive through children). */
/**
 * Single read of a distilled file, surfacing both the recursive agent count and the
 * idle-trimmed active span (`stats.duration_ms`, locked semantics). The trimmed span
 * powers the SessionList "ACTIVE" header chip — distinct from the per-row wall span —
 * and is reused from this one read so no extra per-session I/O is added (bug NUM-3).
 */
const readDistilledRollup = (
	distilledPath: string,
): { readonly agentCount: number; readonly activeDurationMs?: number } => {
	try {
		const content = readFileSync(distilledPath, "utf-8");
		const parsed = JSON.parse(content);
		const agents = parsed?.agents;
		const agentCount = Array.isArray(agents) ? countAgentsRecursive(agents) : 0;
		const trimmed = parsed?.stats?.duration_ms;
		const activeDurationMs = typeof trimmed === "number" && trimmed >= 0 ? trimmed : undefined;
		return { agentCount, activeDurationMs };
	} catch {
		return { agentCount: 0 };
	}
};

// Staleness metadata for the detail route (bug B5 — a distill computed over the
// first N events was being shown as the current truth while the raw session kept
// growing). We compare the exact raw line count against the events the distill
// actually covered (distilled.stats.total_events) and surface when they diverge.
type StalenessInfo = {
	readonly distilled_at: number;
	readonly raw_event_count: number;
	readonly distill_stale: boolean;
	/** Distill was priced under a different tier than the current explicit config. */
	readonly tier_stale: boolean;
};

/**
 * Current explicit pricing tier from .clens/config.json, or undefined when the
 * config is absent/auto (auto resolves per-session from transcripts, so a cheap
 * server-side comparison is only meaningful for explicit api/max).
 */
const readExplicitConfigTier = (projectDir: string): "api" | "max" | undefined => {
	try {
		const raw: unknown = JSON.parse(readFileSync(`${projectDir}/.clens/config.json`, "utf-8"));
		const pricing =
			raw && typeof raw === "object" ? (raw as { pricing?: unknown }).pricing : undefined;
		return pricing === "api" || pricing === "max" ? pricing : undefined;
	} catch {
		return undefined;
	}
};

const computeStaleness = (
	projectDir: string,
	sessionId: string,
	distilledTotalEvents: number,
	distilledTier?: string,
): StalenessInfo | undefined => {
	const rawPath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`;
	const distilledPath = `${projectDir}/.clens/distilled/${sessionId}.json`;
	try {
		const rawInfo = readFirstLastLines(rawPath);
		// A torn final line (live write left a non-empty, unparseable trailing line) is
		// not a complete event the distiller would have counted. Counting it inflated
		// raw_event_count by +1 and spuriously flipped sessions to distill_stale, so it
		// is excluded from the staleness comparison (NUM-22).
		const rawEventCount = (rawInfo?.lineCount ?? 0) - (rawInfo?.lastLineTorn ? 1 : 0);
		const distilledAt = statSync(distilledPath).mtimeMs;
		const configTier = readExplicitConfigTier(projectDir);
		return {
			distilled_at: distilledAt,
			raw_event_count: rawEventCount,
			distill_stale: rawEventCount > distilledTotalEvents,
			// Costs in this distill were computed under a different tier than the
			// user's current explicit setting (stale-tier mixing) — re-analyze to fix
			tier_stale:
				configTier !== undefined && distilledTier !== undefined && distilledTier !== configTier,
		};
	} catch (err) {
		log.warn(
			`Staleness check failed for ${sessionId.slice(0, 8)}:`,
			err instanceof Error ? err.message : String(err),
		);
		return undefined;
	}
};

/**
 * Lightweight session listing — reads only first+last lines per JSONL file.
 * No full file parsing, no enrichment. Returns metadata sufficient for the table.
 */
const listSessionsLightweight = (projectDir: string): readonly SessionSummary[] => {
	const sessionsDir = `${projectDir}/.clens/sessions`;
	const distilledDir = `${projectDir}/.clens/distilled`;

	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl");
		} catch (err) {
			log.warn(
				`Cannot read sessions dir ${sessionsDir}:`,
				err instanceof Error ? err.message : String(err),
			);
			return [];
		}
	})();

	if (files.length === 0) return [];

	// Feature usage flags (loop/goal/workflow) — cached scan, stat-only on hits
	const featureIndex = (() => {
		try {
			return readFeatureIndex(projectDir);
		} catch (err) {
			log.warn(
				`Feature index failed for ${projectDir}:`,
				err instanceof Error ? err.message : String(err),
			);
			return new Map<string, readonly ("loop" | "goal" | "workflow")[]>();
		}
	})();

	// Read links once for agent counts. Deduplicate by agent_id so resumed agents
	// count once — must match the CLI listSessions rule exactly (bug B15).
	const links = readLinks(projectDir);
	const spawns = deduplicateSpawns(links.filter(isSpawnLink));
	const spawnCountByParent = spawns.reduce((acc, s) => {
		const prev = acc.get(s.parent_session) ?? 0;
		return new Map([...acc, [s.parent_session, prev + 1]]);
	}, new Map<string, number>());
	const subagentIds = new Set(spawns.map((s) => s.agent_id));

	// Fallback: count unique msg_send recipients per session when no spawns exist
	const msgSendEvents = links.filter(
		(l): l is Extract<LinkEvent, { type: "msg_send" }> => l.type === "msg_send",
	);
	const msgRecipientsBySession = msgSendEvents.reduce((acc, msg) => {
		const sid = msg.session_id ?? msg.from;
		const existing = acc.get(sid);
		return new Map([...acc, [sid, existing ? new Set([...existing, msg.to]) : new Set([msg.to])]]);
	}, new Map<string, Set<string>>());

	const rows = files
		.flatMap((file): readonly SessionSummary[] => {
			const filePath = `${sessionsDir}/${file}`;
			const sessionId = file.replace(".jsonl", "");

			try {
				const stat = statSync(filePath);
				const result = readFirstLastLines(filePath);
				if (!result) return [];

				const firstEvent = tryParseJson(result.first);
				if (!firstEvent) return [];

				// Drop broadcast-only ghost sessions — matches CLI listSessions (bug
				// sessions-list-ghost-sessions-shown). Cheap unless first event is a broadcast.
				if (isGhostSessionFile(filePath, firstEvent)) return [];

				const lastEvent = tryParseJson(result.last) ?? firstEvent;
				// SessionEnd ⇒ complete. A trailing Stop no longer means complete (it
				// fires after every turn — bug B6). Otherwise active iff recent, else idle.
				const isSessionEnd = lastEvent.event === "SessionEnd";
				const status = deriveSessionStatus(isSessionEnd, lastEvent.t);
				// Lone-SessionEnd ghost (NUM-4): the only captured line is a SessionEnd, so
				// the session start was never recorded — a torn/partial capture with 0 real
				// content. It must never render as "DONE 0s". Tag it EMPTY so the row shows
				// as torn; it is KEPT (not dropped) to preserve list-count parity with the
				// CLI (NUM-1), which does not drop these either.
				const isEmpty = result.lineCount === 1 && isSessionEnd;
				const distilledPath = `${distilledDir}/${sessionId}.json`;
				const isDistilled = existsSync(distilledPath);

				// Agent count: distilled (recursive, authoritative) > spawn links > msg_send > 0
				const distilledRollup = isDistilled
					? readDistilledRollup(distilledPath)
					: { agentCount: 0 };
				const distilledCount = distilledRollup.agentCount;
				const spawnCount = spawnCountByParent.get(sessionId) ?? 0;
				const msgCount = msgRecipientsBySession.get(sessionId)?.size ?? 0;
				const agentCount =
					distilledCount > 0 ? distilledCount : spawnCount > 0 ? spawnCount : msgCount;

				return [
					{
						session_id: sessionId,
						start_time: firstEvent.t,
						end_time: isSessionEnd ? lastEvent.t : undefined,
						duration_ms: lastEvent.t - firstEvent.t,
						event_count: result.lineCount,
						git_branch: (firstEvent.context?.git_branch as string) || undefined,
						source: typeof firstEvent.data.source === "string" ? firstEvent.data.source : undefined,
						end_reason:
							typeof lastEvent.data.reason === "string" ? lastEvent.data.reason : undefined,
						status,
						file_size_bytes: stat.size,
						agent_count: agentCount,
						is_distilled: isDistilled,
						is_subagent: subagentIds.has(sessionId),
						...(isEmpty ? { is_empty: true } : {}),
						...(distilledRollup.activeDurationMs !== undefined
							? { active_duration_ms: distilledRollup.activeDurationMs }
							: {}),
						...((featureIndex.get(sessionId)?.length ?? 0) > 0
							? { features: featureIndex.get(sessionId) }
							: {}),
					},
				];
			} catch (err) {
				log.warn(
					`Failed to parse session file ${file}:`,
					err instanceof Error ? err.message : String(err),
				);
				return [];
			}
		})
		.sort((a, b) => b.start_time - a.start_time);

	// Merge the cLens session-meta sidecar + custom-title + computed first-prompt
	// into each row, resolving display_name/name_source/label/color by precedence
	// (R1/R5). enrichSessionSummaries reads the sidecar ONCE per call (R16) and
	// reuses the same agent-count dedup rules as the lightweight pass (bug B15), so
	// counts are unchanged; it overlays naming + color and preserves features /
	// is_subagent via spread. A malformed sidecar degrades to {} inside the CLI (R15).
	return enrichSessionSummaries(rows, projectDir);
};

/** Resolve a single session's enriched summary (display_name/label/color) by id. */
const resolveSessionRow = (projectDir: string, sessionId: string): SessionSummary | undefined =>
	listSessionsLightweight(projectDir).find((s) => s.session_id === sessionId);

// ── Short-id prefix resolution (FE-2) ──────────────────────────────

type PrefixResolution =
	| { readonly kind: "ok"; readonly id: string }
	| { readonly kind: "ambiguous"; readonly matches: readonly string[] }
	| { readonly kind: "none" };

/**
 * Resolve a possibly-truncated session id (e.g. an 8-char prefix from a list link)
 * to a full session id by matching `.jsonl` file names (FE-2). An exact file wins
 * with no scan; otherwise a UNIQUE prefix match resolves, an ambiguous prefix is
 * reported (caller → 400), and no match yields "none" (caller → 404). Full ids pass
 * straight through via the exact-file check.
 */
const resolveSessionIdPrefix = (projectDir: string, id: string): PrefixResolution => {
	const sessionsDir = `${projectDir}/.clens/sessions`;
	if (existsSync(`${sessionsDir}/${id}.jsonl`)) return { kind: "ok", id };
	const matches = (() => {
		try {
			return readdirSync(sessionsDir)
				.filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl" && f.startsWith(id))
				.map((f) => f.slice(0, -".jsonl".length));
		} catch {
			return [];
		}
	})();
	if (matches.length === 1) return { kind: "ok", id: matches[0] };
	if (matches.length > 1) return { kind: "ambiguous", matches };
	return { kind: "none" };
};

/** Deterministic 400 body fields for an ambiguous short-id prefix (FE-2). Spread into
 *  an inline `c.json(...)` so Hono's RPC type inference for the route is preserved. */
const ambiguousPrefixError = (rawId: string, count: number) => ({
	error: "Ambiguous session id prefix",
	code: "AMBIGUOUS_SESSION_ID" as const,
	detail: `${rawId} matches ${count} sessions — use a longer prefix or the full id`,
});

// ── Meta-patch body parsing / validation ──────────────────────────

type MetaPatchBody = { readonly label?: string | null; readonly color?: ColorName | null };
type MetaPatchResult =
	| { readonly ok: true; readonly patch: MetaPatchBody }
	| { readonly ok: false; readonly error: string; readonly detail: string };

/**
 * Validate the PATCH /meta body. Accepts `{ label?: string|null, color?: ColorName|null }`.
 *  - `label`: string sets, null/empty/whitespace clears (R7/R8) — clearing is delegated to setSessionMeta.
 *  - `color`: a palette ColorName sets, null/"none" clears (R13); any other value → 400 (R14).
 * Only keys actually present in the body are forwarded, so a label-only patch never
 * touches color and vice-versa.
 */
const parseMetaPatch = (raw: unknown): MetaPatchResult => {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			ok: false,
			error: "Invalid body",
			detail: "Expected a JSON object with optional label/color.",
		};
	}
	const obj = raw as Record<string, unknown>;
	const hasLabel = "label" in obj;
	const hasColor = "color" in obj;

	if (hasLabel && obj.label !== null && typeof obj.label !== "string") {
		return { ok: false, error: "Invalid label", detail: "label must be a string or null." };
	}
	if (hasColor && obj.color !== null && !isColorName(obj.color)) {
		return {
			ok: false,
			error: "Invalid color",
			detail: "color must be one of: none, red, amber, green, blue, violet, gray, or null.",
		};
	}

	return {
		ok: true,
		patch: {
			...(hasLabel ? { label: obj.label as string | null } : {}),
			...(hasColor ? { color: obj.color as ColorName | null } : {}),
		},
	};
};

/**
 * Shared handler for PATCH /api/sessions/:sessionId/meta. Validates the body,
 * persists via the CLI's atomic setSessionMeta, and returns the freshly resolved
 * session row (display_name/name_source/label/color). Session-id format is already
 * enforced by validateSessionId middleware; a non-existent session yields 404.
 */
const handleMetaPatch = async (
	c: Context,
	projectDir: string,
	sessionId: string,
): Promise<Response> => {
	const sessionPath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`;
	if (!existsSync(sessionPath)) {
		return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);
	}

	const body: unknown = await c.req.json().catch(() => undefined);
	if (body === undefined) {
		return c.json(
			{
				error: "Invalid JSON body",
				code: "INVALID_BODY",
				detail: "Request body must be valid JSON.",
			},
			400,
		);
	}

	const parsed = parseMetaPatch(body);
	if (!parsed.ok) {
		// Invalid color/label rejected before any write — state unchanged (R14).
		return c.json({ error: parsed.error, code: "INVALID_PARAM", detail: parsed.detail }, 400);
	}

	try {
		setSessionMeta(projectDir, sessionId, parsed.patch);
	} catch (err) {
		// Defensive: setSessionMeta also validates color; surface as 400, state unchanged.
		log.warn(
			`setSessionMeta failed for ${sessionId.slice(0, 8)}:`,
			err instanceof Error ? err.message : String(err),
		);
		return c.json(
			{
				error: "Invalid color",
				code: "INVALID_PARAM",
				detail: err instanceof Error ? err.message : String(err),
			},
			400,
		);
	}

	const row = resolveSessionRow(projectDir, sessionId);
	if (!row) {
		return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);
	}
	return c.json({ data: row });
};

type SortField =
	| "start_time"
	| "-start_time"
	| "duration_ms"
	| "-duration_ms"
	| "event_count"
	| "-event_count";
const VALID_SORTS: readonly string[] = [
	"start_time",
	"-start_time",
	"duration_ms",
	"-duration_ms",
	"event_count",
	"-event_count",
] as const;

// "incomplete" is kept for backward compatibility — it maps to active+idle.
const VALID_STATUSES: readonly string[] = [...SESSION_STATUSES, "incomplete"] as const;

/** Whether a session matches a (possibly legacy) status filter value. */
const matchesStatusFilter = (status: SessionStatus, filter: string): boolean =>
	filter === "incomplete" ? status !== "complete" : status === filter;

// ── Sort comparator ────────────────────────────────────────────────

const buildComparator =
	(sort: SortField) =>
	(a: SessionSummary, b: SessionSummary): number => {
		const desc = sort.startsWith("-");
		const field = (desc ? sort.slice(1) : sort) as "start_time" | "duration_ms" | "event_count";
		const av = a[field] ?? 0;
		const bv = b[field] ?? 0;
		return desc ? bv - av : av - bv;
	};

// ── Event loading with cache ───────────────────────────────────────

const loadEvents = (sessionId: string, projectDir: string): readonly StoredEvent[] | undefined => {
	const cached = getCachedEvents(sessionId);
	if (cached) {
		log.debug(`Cache hit for ${sessionId.slice(0, 8)}`);
		return cached;
	}
	try {
		const loaded = readSessionEvents(sessionId, projectDir);
		log.debug(`Loaded ${loaded.length} events for ${sessionId.slice(0, 8)}`);
		setCachedEvents(sessionId, loaded);
		return loaded;
	} catch (err) {
		log.error(
			`Failed to load events for ${sessionId.slice(0, 8)}:`,
			err instanceof Error ? err.message : String(err),
		);
		return undefined;
	}
};

// ── Sessions route factory ─────────────────────────────────────────

const createSessionsRoute = (projectDir: string) =>
	new Hono()
		// GET /api/sessions — list sessions with pagination
		.get("/", (c) => {
			log.debug("GET /api/sessions", c.req.query());
			const page = parseIntParam(c.req.query("page"), 1, 1, 1000);
			const limit = parseIntParam(c.req.query("limit"), 20, 1, 5000);
			const sort = (c.req.query("sort") ?? "-start_time") as SortField;
			const statusFilter = c.req.query("status");

			// Validate params
			if (page === -1) {
				return c.json(
					{ error: "Invalid page", code: "INVALID_PARAM", detail: "page must be 1-1000" },
					400,
				);
			}
			if (limit === -1) {
				return c.json(
					{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-5000" },
					400,
				);
			}
			if (!VALID_SORTS.includes(sort)) {
				return c.json(
					{
						error: "Invalid sort",
						code: "INVALID_PARAM",
						detail: `sort must be one of: ${VALID_SORTS.join(", ")}`,
					},
					400,
				);
			}
			if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
				return c.json(
					{
						error: "Invalid status",
						code: "INVALID_PARAM",
						detail: `status must be one of: ${VALID_STATUSES.join(", ")}`,
					},
					400,
				);
			}

			const enriched = listSessionsLightweight(projectDir);

			// Filter by status (legacy "incomplete" ⇒ active+idle)
			const filtered = statusFilter
				? enriched.filter((s) => matchesStatusFilter(s.status, statusFilter))
				: enriched;

			// Sort
			const sorted = [...filtered].sort(buildComparator(sort));

			// Paginate
			const total = sorted.length;
			const offset = (page - 1) * limit;
			const data = sorted.slice(offset, offset + limit);

			return c.json({
				data,
				pagination: {
					page,
					limit,
					total,
					has_next: offset + limit < total,
				},
			});
		})

		// GET /api/sessions/:sessionId — session detail (distilled)
		.get("/:sessionId", (c) => {
			const rawId = c.req.param("sessionId");
			// Resolve a short id prefix (e.g. list-provided 8-char id) to the full id (FE-2).
			const resolved = resolveSessionIdPrefix(projectDir, rawId);
			if (resolved.kind === "ambiguous")
				return c.json(ambiguousPrefixError(rawId, resolved.matches.length), 400);
			const sessionId = resolved.kind === "ok" ? resolved.id : rawId;
			log.info(`Session detail: ${sessionId.slice(0, 8)}`);

			const distilled = readDistilled(sessionId, projectDir);
			if (!distilled) {
				// Check if session file exists
				const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`);

				if (!exists) {
					return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);
				}

				return c.json({ status: "not_distilled" as const }, 202);
			}

			// Staleness: compare distilled coverage against the live raw file (bug B5)
			const staleness = computeStaleness(
				projectDir,
				sessionId,
				distilled.stats.total_events,
				(distilled.cost_estimate ?? distilled.stats.cost_estimate)?.pricing_tier,
			);

			return c.json({
				data: distilled,
				...(staleness ? { staleness } : {}),
			});
		})

		// PATCH /api/sessions/:sessionId/meta — set/clear user label + color (R6/R7/R10/R13/R14)
		.patch("/:sessionId/meta", async (c) => {
			const sessionId = c.req.param("sessionId");
			return handleMetaPatch(c, projectDir, sessionId);
		})

		// GET /api/sessions/:sessionId/events — paginated events
		.get("/:sessionId/events", (c) => {
			const sessionId = c.req.param("sessionId");
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000);
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000);

			if (offset === -1) {
				return c.json(
					{ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" },
					400,
				);
			}
			if (limit === -1) {
				return c.json(
					{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" },
					400,
				);
			}

			const events = loadEvents(sessionId, projectDir);

			if (!events) {
				return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);
			}

			const total = events.length;
			const data = events.slice(offset, offset + limit);

			return c.json({
				data,
				pagination: {
					offset,
					limit,
					total,
					has_next: offset + limit < total,
				},
			});
		})

		// GET /api/sessions/:sessionId/conversation — paginated conversation timeline
		.get("/:sessionId/conversation", (c) => {
			const sessionId = c.req.param("sessionId");
			log.info(`Conversation: ${sessionId.slice(0, 8)}`);
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000);
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000);

			if (offset === -1) {
				return c.json(
					{ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" },
					400,
				);
			}
			if (limit === -1) {
				return c.json(
					{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" },
					400,
				);
			}

			const distilled = readDistilled(sessionId, projectDir);
			if (!distilled) {
				const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`);
				if (!exists) {
					return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);
				}
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202);
			}

			const events = loadEvents(sessionId, projectDir);
			if (!events) {
				return c.json({ error: "Session events not found", code: "NOT_FOUND" }, 404);
			}

			const conversation = buildConversation(distilled, events);
			const total = conversation.length;
			const data = conversation.slice(offset, offset + limit);

			return c.json({
				data,
				pagination: { offset, limit, total, has_next: offset + limit < total },
			});
		})

		// GET /api/sessions/:sessionId/agents/:agentId/conversation — agent-scoped conversation
		.get("/:sessionId/agents/:agentId/conversation", (c) => {
			const sessionId = c.req.param("sessionId");
			const agentId = c.req.param("agentId");
			log.info(`Agent conversation: session=${sessionId.slice(0, 8)} agent=${agentId.slice(0, 8)}`);
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000);
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000);

			if (offset === -1) {
				return c.json(
					{ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" },
					400,
				);
			}
			if (limit === -1) {
				return c.json(
					{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" },
					400,
				);
			}

			// Parent session must be distilled
			const distilled = readDistilled(sessionId, projectDir);
			if (!distilled) {
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202);
			}

			// Verify agent exists in distilled data (search recursively through agent tree)
			const agent = findAgentById(distilled.agents ?? [], agentId);
			if (!agent) {
				return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404);
			}

			// Try loading hook events first, then fall back to transcript
			const agentEvents = loadEvents(agentId, projectDir);

			const conversation = (() => {
				if (agentEvents) {
					// Hook events available — use full conversation builder
					const agentDistilled = readDistilled(agentId, projectDir);
					return agentDistilled
						? buildConversation(agentDistilled, agentEvents)
						: buildConversation(
								{
									...distilled,
									reasoning: agent.reasoning ?? [],
									user_messages: [],
									backtracks: agent.backtracks ?? [],
									summary: distilled.summary,
								},
								agentEvents,
							);
				}

				// No hook events — fall back to Claude Code transcript
				const transcriptPath = agent.transcript_path;
				if (transcriptPath && existsSync(transcriptPath)) {
					const transcript = readTranscript(transcriptPath);
					return buildConversationFromTranscript(transcript, agent);
				}

				// No transcript either — build conversation from agent node enrichment data
				// (includes task_prompt, messages, reasoning, backtracks from link enrichment)
				return buildConversationFromTranscript([], agent);
			})();

			const total = conversation.length;
			const data = conversation.slice(offset, offset + limit);

			return c.json({
				data,
				pagination: { offset, limit, total, has_next: offset + limit < total },
			});
		})

		// GET /api/sessions/:sessionId/diff/:filePath — unified diff for a file
		.get("/:sessionId/diff/*", (c) => {
			const sessionId = c.req.param("sessionId");
			log.info(`Diff: session=${sessionId.slice(0, 8)} path=${c.req.path}`);
			// Extract file path from wildcard (everything after /diff/)
			const filePath = c.req.path.replace(/^\/api\/sessions\/[^/]+\/diff\//, "");

			if (!filePath) {
				return c.json({ error: "File path required", code: "INVALID_PARAM" }, 400);
			}

			const distilled = readDistilled(sessionId, projectDir);
			if (!distilled) {
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202);
			}

			// diff_attribution uses relative paths; filePath from URL may be relative or absolute
			const attribution = distilled.edit_chains?.diff_attribution?.find((da) =>
				pathsMatch(da.file_path, filePath),
			);

			if (!attribution) {
				return c.json({ error: "No diff found for file", code: "NOT_FOUND" }, 404);
			}

			const unified_diff = diffLinesToUnified(filePath, attribution.lines);

			return c.json({
				data: {
					file_path: filePath,
					unified_diff,
					total_additions: attribution.total_additions,
					total_deletions: attribution.total_deletions,
				},
			});
		});

// ── Global multi-project helpers ─────────────────────────────────

/**
 * In repository mode a project's `path` is the git root, but its capture
 * directory (`.clens/sessions/`) may live in a nested package — e.g.
 * `gitRoot/packages/web/.clens/sessions`. This finds every directory below
 * `projectDir` (bounded depth) that directly contains a `.clens/sessions/`
 * dir, mirroring the CLI's `findAllClensDirs` (global-read.ts). It always
 * includes `projectDir` itself when it holds the capture dir, so project-mode
 * entries (where `path` already points at the capture dir) keep working.
 *
 * Without this, repos whose only `.clens` is nested survive registry
 * resolution and appear in /api/projects but list ZERO sessions and cannot
 * resolve/distill their sessions (bug repo-mode-nested-clens-projects-dropped).
 */
const findClensCaptureDirs = (projectDir: string, maxDepth = 3): readonly string[] => {
	const scan = (dir: string, depth: number): readonly string[] => {
		if (depth > maxDepth) return [];
		const entries = (() => {
			try {
				return readdirSync(dir, { withFileTypes: true });
			} catch {
				return [];
			}
		})();
		return entries.flatMap((entry) => {
			if (!entry.isDirectory()) return [];
			if (entry.name === "node_modules" || entry.name === ".git") return [];
			const fullPath = resolve(dir, entry.name);
			if (entry.name === ".clens") {
				return existsSync(resolve(fullPath, "sessions")) ? [dir] : [];
			}
			if (entry.name.startsWith(".")) return [];
			return scan(fullPath, depth + 1);
		});
	};
	return scan(projectDir, 0);
};

/**
 * Build a map from session ID to the resolvable capture directory + project
 * metadata. The mapped entry's `path` points at the directory that directly
 * contains `.clens/sessions/<sid>.jsonl` (which may be a nested package),
 * while `id`/`name` keep the owning git-root project identity. Detail routes
 * read `${path}/.clens/...`, so `path` MUST be the capture dir, not the root.
 */
const buildSessionMap = (projects: readonly ProjectEntry[]): ReadonlyMap<string, ProjectEntry> =>
	new Map(
		projects.flatMap((project) =>
			findClensCaptureDirs(project.path).flatMap((captureDir) => {
				const sessionsDir = `${captureDir}/.clens/sessions`;
				try {
					return readdirSync(sessionsDir)
						.filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl")
						.map((f): readonly [string, ProjectEntry] => [
							f.replace(".jsonl", ""),
							{ ...project, path: captureDir },
						]);
				} catch {
					return [];
				}
			}),
		),
	);

/** Lightweight listing that tags sessions with project info. */
const listGlobalSessionsLightweight = (
	projects: readonly ProjectEntry[],
): readonly (SessionSummary & { readonly project_id: string; readonly project_name: string })[] => {
	const all = projects.flatMap((project) =>
		findClensCaptureDirs(project.path).flatMap((captureDir) =>
			listSessionsLightweight(captureDir).map((session) => ({
				...session,
				project_id: project.id,
				project_name: project.name,
			})),
		),
	);

	// A single session_id can be captured into multiple .clens dirs (git root +
	// nested package broadcasts), so the same session surfaces more than once across
	// capture dirs/projects. De-duplicate keeping the most-complete copy (max
	// event_count) as the canonical owner — every displayed field is then sourced
	// from one consistent owner, so SESSIONS/EVENTS/SIZE/ACTIVE/ANALYZED/TOTAL-TIME
	// totals match the CLI (bug NUM-1: previously no Set → 808 instead of 770).
	const byId = new Map<string, (typeof all)[number]>();
	for (const session of all) {
		const existing = byId.get(session.session_id);
		if (!existing || session.event_count > existing.event_count) {
			byId.set(session.session_id, session);
		}
	}

	return [...byId.values()].sort((a, b) => b.start_time - a.start_time);
};

// ── Global sessions route factory ───────────────────────────────

/**
 * Global sessions route — aggregates sessions from multiple projects.
 * Session detail routes resolve the owning project from the session map.
 */
const createGlobalSessionsRoute = (
	projects: readonly ProjectEntry[],
	fallbackProjectDir: string,
) => {
	const resolveProjectDir = (sessionId: string): string => {
		const project = buildSessionMap(projects).get(sessionId);
		return project?.path ?? fallbackProjectDir;
	};

	// Resolve a short id prefix to its full id + owning capture dir across all
	// projects (FE-2). Exact id wins; a unique prefix resolves; multiple → ambiguous.
	type GlobalResolution =
		| { readonly kind: "ok"; readonly id: string; readonly projectDir: string }
		| { readonly kind: "ambiguous"; readonly count: number }
		| { readonly kind: "none" };
	const resolveGlobalSession = (id: string): GlobalResolution => {
		const map = buildSessionMap(projects);
		const exact = map.get(id);
		if (exact) return { kind: "ok", id, projectDir: exact.path };
		const matches = [...map.keys()].filter((k) => k.startsWith(id));
		if (matches.length === 1) {
			const owner = map.get(matches[0]);
			return owner ? { kind: "ok", id: matches[0], projectDir: owner.path } : { kind: "none" };
		}
		if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
		return { kind: "none" };
	};

	return (
		new Hono()
			// GET /api/sessions — list sessions from all projects with pagination
			.get("/", (c) => {
				log.debug("GET /api/sessions (global)", c.req.query());
				const page = parseIntParam(c.req.query("page"), 1, 1, 1000);
				const limit = parseIntParam(c.req.query("limit"), 20, 1, 5000);
				const sort = (c.req.query("sort") ?? "-start_time") as SortField;
				const statusFilter = c.req.query("status");
				const projectFilter = c.req.query("project");

				if (page === -1)
					return c.json(
						{ error: "Invalid page", code: "INVALID_PARAM", detail: "page must be 1-1000" },
						400,
					);
				if (limit === -1)
					return c.json(
						{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-5000" },
						400,
					);
				if (!VALID_SORTS.includes(sort))
					return c.json(
						{
							error: "Invalid sort",
							code: "INVALID_PARAM",
							detail: `sort must be one of: ${VALID_SORTS.join(", ")}`,
						},
						400,
					);
				if (statusFilter && !VALID_STATUSES.includes(statusFilter))
					return c.json(
						{
							error: "Invalid status",
							code: "INVALID_PARAM",
							detail: `status must be one of: ${VALID_STATUSES.join(", ")}`,
						},
						400,
					);

				const enriched = listGlobalSessionsLightweight(projects);

				// Filter by status (legacy "incomplete" ⇒ active+idle)
				const afterStatus = statusFilter
					? enriched.filter((s) => matchesStatusFilter(s.status, statusFilter))
					: enriched;

				// Filter by project
				const afterProject = projectFilter
					? afterStatus.filter((s) => s.project_id === projectFilter)
					: afterStatus;

				// Sort
				const sorted = [...afterProject].sort(buildComparator(sort));

				// Paginate
				const total = sorted.length;
				const offset = (page - 1) * limit;
				const data = sorted.slice(offset, offset + limit);

				return c.json({
					data,
					pagination: { page, limit, total, has_next: offset + limit < total },
				});
			})

			// GET /api/sessions/:sessionId — session detail (resolves project + short id)
			.get("/:sessionId", (c) => {
				const rawId = c.req.param("sessionId");
				// Resolve a short id prefix (e.g. list-provided 8-char id) to the full id (FE-2).
				const resolved = resolveGlobalSession(rawId);
				if (resolved.kind === "ambiguous")
					return c.json(ambiguousPrefixError(rawId, resolved.count), 400);
				const sessionId = resolved.kind === "ok" ? resolved.id : rawId;
				const projectDir = resolved.kind === "ok" ? resolved.projectDir : resolveProjectDir(rawId);
				log.info(`Session detail (global): ${sessionId.slice(0, 8)} → ${projectDir}`);

				const distilled = readDistilled(sessionId, projectDir);
				if (!distilled) {
					const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`);
					if (!exists) return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);
					return c.json({ status: "not_distilled" as const }, 202);
				}

				// Staleness: compare distilled coverage against the live raw file (bug B5)
				const staleness = computeStaleness(
					projectDir,
					sessionId,
					distilled.stats.total_events,
					(distilled.cost_estimate ?? distilled.stats.cost_estimate)?.pricing_tier,
				);

				return c.json({
					data: distilled,
					...(staleness ? { staleness } : {}),
				});
			})

			// PATCH /api/sessions/:sessionId/meta — set/clear user label + color (R6/R7/R10/R13/R14)
			.patch("/:sessionId/meta", async (c) => {
				const sessionId = c.req.param("sessionId");
				const projectDir = resolveProjectDir(sessionId);
				return handleMetaPatch(c, projectDir, sessionId);
			})

			// GET /api/sessions/:sessionId/events — paginated events
			.get("/:sessionId/events", (c) => {
				const sessionId = c.req.param("sessionId");
				const projectDir = resolveProjectDir(sessionId);
				const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000);
				const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000);

				if (offset === -1)
					return c.json(
						{ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" },
						400,
					);
				if (limit === -1)
					return c.json(
						{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" },
						400,
					);

				const events = loadEvents(sessionId, projectDir);
				if (!events) return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);

				const total = events.length;
				const data = events.slice(offset, offset + limit);
				return c.json({
					data,
					pagination: { offset, limit, total, has_next: offset + limit < total },
				});
			})

			// GET /api/sessions/:sessionId/conversation
			.get("/:sessionId/conversation", (c) => {
				const sessionId = c.req.param("sessionId");
				const projectDir = resolveProjectDir(sessionId);
				log.info(`Conversation (global): ${sessionId.slice(0, 8)}`);
				const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000);
				const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000);

				if (offset === -1)
					return c.json(
						{ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" },
						400,
					);
				if (limit === -1)
					return c.json(
						{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" },
						400,
					);

				const distilled = readDistilled(sessionId, projectDir);
				if (!distilled) {
					const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`);
					if (!exists) return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404);
					return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202);
				}

				const events = loadEvents(sessionId, projectDir);
				if (!events) return c.json({ error: "Session events not found", code: "NOT_FOUND" }, 404);

				const conversation = buildConversation(distilled, events);
				const total = conversation.length;
				const data = conversation.slice(offset, offset + limit);
				return c.json({
					data,
					pagination: { offset, limit, total, has_next: offset + limit < total },
				});
			})

			// GET /api/sessions/:sessionId/agents/:agentId/conversation
			.get("/:sessionId/agents/:agentId/conversation", (c) => {
				const sessionId = c.req.param("sessionId");
				const agentId = c.req.param("agentId");
				const projectDir = resolveProjectDir(sessionId);
				log.info(
					`Agent conversation (global): session=${sessionId.slice(0, 8)} agent=${agentId.slice(0, 8)}`,
				);
				const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000);
				const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000);

				if (offset === -1)
					return c.json(
						{ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" },
						400,
					);
				if (limit === -1)
					return c.json(
						{ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" },
						400,
					);

				const distilled = readDistilled(sessionId, projectDir);
				if (!distilled)
					return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202);

				const agent = findAgentById(distilled.agents ?? [], agentId);
				if (!agent) return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404);

				const agentEvents = loadEvents(agentId, projectDir);
				const conversation = (() => {
					if (agentEvents) {
						const agentDistilled = readDistilled(agentId, projectDir);
						return agentDistilled
							? buildConversation(agentDistilled, agentEvents)
							: buildConversation(
									{
										...distilled,
										reasoning: agent.reasoning ?? [],
										user_messages: [],
										backtracks: agent.backtracks ?? [],
										summary: distilled.summary,
									},
									agentEvents,
								);
					}
					const transcriptPath = agent.transcript_path;
					if (transcriptPath && existsSync(transcriptPath)) {
						const transcript = readTranscript(transcriptPath);
						return buildConversationFromTranscript(transcript, agent);
					}
					return buildConversationFromTranscript([], agent);
				})();

				const total = conversation.length;
				const data = conversation.slice(offset, offset + limit);
				return c.json({
					data,
					pagination: { offset, limit, total, has_next: offset + limit < total },
				});
			})

			// GET /api/sessions/:sessionId/diff/*
			.get("/:sessionId/diff/*", (c) => {
				const sessionId = c.req.param("sessionId");
				const projectDir = resolveProjectDir(sessionId);
				log.info(`Diff (global): session=${sessionId.slice(0, 8)} path=${c.req.path}`);
				const filePath = c.req.path.replace(/^\/api\/sessions\/[^/]+\/diff\//, "");

				if (!filePath) return c.json({ error: "File path required", code: "INVALID_PARAM" }, 400);

				const distilled = readDistilled(sessionId, projectDir);
				if (!distilled)
					return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202);

				const attribution = distilled.edit_chains?.diff_attribution?.find((da) =>
					pathsMatch(da.file_path, filePath),
				);
				if (!attribution)
					return c.json({ error: "No diff found for file", code: "NOT_FOUND" }, 404);

				const unified_diff = diffLinesToUnified(filePath, attribution.lines);
				return c.json({
					data: {
						file_path: filePath,
						unified_diff,
						total_additions: attribution.total_additions,
						total_deletions: attribution.total_deletions,
					},
				});
			})
	);
};

export { createSessionsRoute, createGlobalSessionsRoute };

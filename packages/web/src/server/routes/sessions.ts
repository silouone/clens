import { Hono } from "hono"
import { existsSync, readdirSync, statSync, openSync, readSync, fstatSync, closeSync, readFileSync } from "node:fs"
import { readDistilled, readSessionEvents, readLinks } from "@clens/cli/src/session"
import { buildConversation } from "@clens/cli/src/session/conversation"
import { diffLinesToUnified } from "@clens/cli/src/utils"
import type { SessionSummary, StoredEvent, LinkEvent, SpawnLink } from "@clens/cli"
import { getCachedEvents, setCachedEvents } from "../cache"

// ── Query param validation ─────────────────────────────────────────

const parseIntParam = (value: string | undefined, fallback: number, min: number, max: number): number => {
	if (!value) return fallback
	const n = parseInt(value, 10)
	return Number.isNaN(n) || n < min || n > max ? -1 : n
}

// ── Lightweight session listing (reads only first+last lines) ──────

type ParsedEvent = {
	readonly event: string
	readonly t: number
	readonly data: Record<string, unknown>
	readonly context?: Record<string, unknown>
}

const tryParseJson = (line: string): ParsedEvent | undefined => {
	try {
		const parsed = JSON.parse(line)
		return parsed && typeof parsed === "object" && "event" in parsed ? parsed : undefined
	} catch {
		return undefined
	}
}

/** Read only the first and last lines of a file without loading the entire content. */
const readFirstLastLines = (filePath: string): { first: string; last: string; lineCount: number } | undefined => {
	const fd = openSync(filePath, "r")
	try {
		const stat = fstatSync(fd)
		if (stat.size === 0) return undefined

		// Read first line (up to 8KB should be enough)
		const headBuf = Buffer.alloc(Math.min(8192, stat.size))
		readSync(fd, headBuf, 0, headBuf.length, 0)
		const headStr = headBuf.toString("utf-8")
		const firstNewline = headStr.indexOf("\n")
		if (firstNewline === -1) return { first: headStr.trim(), last: headStr.trim(), lineCount: 1 }
		const first = headStr.slice(0, firstNewline)

		// Count newlines by scanning whole file (fast — no JSON parsing)
		const fullBuf = Buffer.alloc(stat.size)
		readSync(fd, fullBuf, 0, stat.size, 0)
		const fullStr = fullBuf.toString("utf-8")
		const lines = fullStr.split("\n").filter(Boolean)
		const lineCount = lines.length
		const last = lines[lines.length - 1]

		return { first, last, lineCount }
	} finally {
		closeSync(fd)
	}
}

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn"

/**
 * Lightweight session listing — reads only first+last lines per JSONL file.
 * No full file parsing, no enrichment. Returns metadata sufficient for the table.
 */
const listSessionsLightweight = (projectDir: string): readonly SessionSummary[] => {
	const sessionsDir = `${projectDir}/.clens/sessions`
	const distilledDir = `${projectDir}/.clens/distilled`

	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl")
		} catch {
			return []
		}
	})()

	if (files.length === 0) return []

	// Read links once for agent counts
	const links = readLinks(projectDir)
	const spawns = links.filter(isSpawnLink)
	const spawnCountByParent = new Map<string, number>()
	spawns.forEach((s) => {
		spawnCountByParent.set(s.parent_session, (spawnCountByParent.get(s.parent_session) ?? 0) + 1)
	})

	return files
		.flatMap((file): readonly SessionSummary[] => {
			const filePath = `${sessionsDir}/${file}`
			const sessionId = file.replace(".jsonl", "")

			try {
				const stat = statSync(filePath)
				const result = readFirstLastLines(filePath)
				if (!result) return []

				const firstEvent = tryParseJson(result.first)
				if (!firstEvent) return []

				const lastEvent = tryParseJson(result.last) ?? firstEvent
				const isComplete = lastEvent.event === "SessionEnd" || lastEvent.event === "Stop"
				const distilledPath = `${distilledDir}/${sessionId}.json`

				return [{
					session_id: sessionId,
					start_time: firstEvent.t,
					end_time: isComplete ? lastEvent.t : undefined,
					duration_ms: lastEvent.t - firstEvent.t,
					event_count: result.lineCount,
					git_branch: (firstEvent.context?.git_branch as string) || undefined,
					source: typeof firstEvent.data.source === "string" ? firstEvent.data.source : undefined,
					end_reason: typeof lastEvent.data.reason === "string" ? lastEvent.data.reason : undefined,
					status: isComplete ? "complete" : "incomplete",
					file_size_bytes: stat.size,
					agent_count: spawnCountByParent.get(sessionId) ?? 0,
					is_distilled: existsSync(distilledPath),
				}]
			} catch {
				return []
			}
		})
		.sort((a, b) => b.start_time - a.start_time)
}

type SortField = "start_time" | "-start_time" | "duration_ms" | "-duration_ms" | "event_count" | "-event_count"
const VALID_SORTS: readonly string[] = ["start_time", "-start_time", "duration_ms", "-duration_ms", "event_count", "-event_count"] as const

const VALID_STATUSES: readonly string[] = ["complete", "incomplete"] as const

// ── Sort comparator ────────────────────────────────────────────────

const buildComparator = (sort: SortField) => (a: SessionSummary, b: SessionSummary): number => {
	const desc = sort.startsWith("-")
	const field = (desc ? sort.slice(1) : sort) as "start_time" | "duration_ms" | "event_count"
	const av = a[field] ?? 0
	const bv = b[field] ?? 0
	return desc ? bv - av : av - bv
}

// ── Event loading with cache ───────────────────────────────────────

const loadEvents = (sessionId: string, projectDir: string): readonly StoredEvent[] | undefined => {
	const cached = getCachedEvents(sessionId)
	if (cached) return cached
	try {
		const loaded = readSessionEvents(sessionId, projectDir)
		setCachedEvents(sessionId, loaded)
		return loaded
	} catch {
		return undefined
	}
}

// ── Sessions route factory ─────────────────────────────────────────

const createSessionsRoute = (projectDir: string) =>
	new Hono()
		// GET /api/sessions — list sessions with pagination
		.get("/", (c) => {
			const page = parseIntParam(c.req.query("page"), 1, 1, 1000)
			const limit = parseIntParam(c.req.query("limit"), 20, 1, 100)
			const sort = (c.req.query("sort") ?? "-start_time") as SortField
			const statusFilter = c.req.query("status")

			// Validate params
			if (page === -1) {
				return c.json({ error: "Invalid page", code: "INVALID_PARAM", detail: "page must be 1-1000" }, 400)
			}
			if (limit === -1) {
				return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-100" }, 400)
			}
			if (!VALID_SORTS.includes(sort)) {
				return c.json({ error: "Invalid sort", code: "INVALID_PARAM", detail: `sort must be one of: ${VALID_SORTS.join(", ")}` }, 400)
			}
			if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
				return c.json({ error: "Invalid status", code: "INVALID_PARAM", detail: "status must be 'complete' or 'incomplete'" }, 400)
			}

			const enriched = listSessionsLightweight(projectDir)

			// Filter by status
			const filtered = statusFilter
				? enriched.filter((s) => s.status === statusFilter)
				: enriched

			// Sort
			const sorted = [...filtered].sort(buildComparator(sort))

			// Paginate
			const total = sorted.length
			const offset = (page - 1) * limit
			const data = sorted.slice(offset, offset + limit)

			return c.json({
				data,
				pagination: {
					page,
					limit,
					total,
					has_next: offset + limit < total,
				},
			})
		})

		// GET /api/sessions/:sessionId — session detail (distilled)
		.get("/:sessionId", (c) => {
			const sessionId = c.req.param("sessionId")

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) {
				// Check if session file exists
				const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`)

				if (!exists) {
					return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404)
				}

				return c.json({ status: "not_distilled" as const }, 202)
			}

			return c.json({ data: distilled })
		})

		// GET /api/sessions/:sessionId/events — paginated events
		.get("/:sessionId/events", (c) => {
			const sessionId = c.req.param("sessionId")
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000)
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000)

			if (offset === -1) {
				return c.json({ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" }, 400)
			}
			if (limit === -1) {
				return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" }, 400)
			}

			const events = loadEvents(sessionId, projectDir)

			if (!events) {
				return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404)
			}

			const total = events.length
			const data = events.slice(offset, offset + limit)

			return c.json({
				data,
				pagination: {
					offset,
					limit,
					total,
					has_next: offset + limit < total,
				},
			})
		})

		// GET /api/sessions/:sessionId/conversation — paginated conversation timeline
		.get("/:sessionId/conversation", (c) => {
			const sessionId = c.req.param("sessionId")
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000)
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000)

			if (offset === -1) {
				return c.json({ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" }, 400)
			}
			if (limit === -1) {
				return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" }, 400)
			}

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) {
				const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`)
				if (!exists) {
					return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404)
				}
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202)
			}

			const events = loadEvents(sessionId, projectDir)
			if (!events) {
				return c.json({ error: "Session events not found", code: "NOT_FOUND" }, 404)
			}

			const conversation = buildConversation(distilled, events)
			const total = conversation.length
			const data = conversation.slice(offset, offset + limit)

			return c.json({
				data,
				pagination: { offset, limit, total, has_next: offset + limit < total },
			})
		})

		// GET /api/sessions/:sessionId/agents/:agentId/conversation — agent-scoped conversation
		.get("/:sessionId/agents/:agentId/conversation", (c) => {
			const sessionId = c.req.param("sessionId")
			const agentId = c.req.param("agentId")
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000)
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000)

			if (offset === -1) {
				return c.json({ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" }, 400)
			}
			if (limit === -1) {
				return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" }, 400)
			}

			// Parent session must be distilled
			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) {
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202)
			}

			// Verify agent exists in distilled data
			const agent = distilled.agents?.find((a) => a.session_id === agentId)
			if (!agent) {
				return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404)
			}

			// Load agent's events
			const agentEvents = loadEvents(agentId, projectDir)
			if (!agentEvents) {
				return c.json({ error: "Agent events not found", code: "NOT_FOUND" }, 404)
			}

			// Build conversation from agent's distill data if available, else minimal from events
			const agentDistilled = readDistilled(agentId, projectDir)
			const conversation = agentDistilled
				? buildConversation(agentDistilled, agentEvents)
				: buildConversation(
					{ ...distilled, reasoning: [], user_messages: [], backtracks: [], summary: distilled.summary },
					agentEvents,
				)

			const total = conversation.length
			const data = conversation.slice(offset, offset + limit)

			return c.json({
				data,
				pagination: { offset, limit, total, has_next: offset + limit < total },
			})
		})

		// GET /api/sessions/:sessionId/diff/:filePath — unified diff for a file
		.get("/:sessionId/diff/*", (c) => {
			const sessionId = c.req.param("sessionId")
			// Extract file path from wildcard (everything after /diff/)
			const filePath = c.req.path.replace(/^\/api\/sessions\/[^/]+\/diff\//, "")

			if (!filePath) {
				return c.json({ error: "File path required", code: "INVALID_PARAM" }, 400)
			}

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) {
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202)
			}

			const attribution = distilled.edit_chains?.diff_attribution?.find(
				(da) => da.file_path === filePath,
			)

			if (!attribution) {
				return c.json({ error: "No diff found for file", code: "NOT_FOUND" }, 404)
			}

			const unified_diff = diffLinesToUnified(filePath, attribution.lines)

			return c.json({
				data: {
					file_path: filePath,
					unified_diff,
					total_additions: attribution.total_additions,
					total_deletions: attribution.total_deletions,
				},
			})
		})

export { createSessionsRoute }

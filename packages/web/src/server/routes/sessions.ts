import { Hono } from "hono"
import { listSessions, enrichSessionSummaries, readDistilled, readSessionEvents } from "@clens/cli/src/session/read"
import { buildConversation } from "@clens/cli/src/session/conversation"
import { diffLinesToUnified } from "@clens/cli/src/utils"
import type { SessionSummary, StoredEvent } from "@clens/cli/src/types"
import { getCachedEvents, setCachedEvents } from "../cache"

// ── Query param validation ─────────────────────────────────────────

const parseIntParam = (value: string | undefined, fallback: number, min: number, max: number): number => {
	if (!value) return fallback
	const n = parseInt(value, 10)
	return Number.isNaN(n) || n < min || n > max ? -1 : n
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

			const raw = listSessions(projectDir)
			const enriched = enrichSessionSummaries(raw, projectDir)

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
				// Check if session exists at all
				const sessions = listSessions(projectDir)
				const exists = sessions.some((s) => s.session_id === sessionId)

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
				const sessions = listSessions(projectDir)
				const exists = sessions.some((s) => s.session_id === sessionId)
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

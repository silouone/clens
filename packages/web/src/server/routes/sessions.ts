import { Hono } from "hono"
import { existsSync, readdirSync, statSync, openSync, readSync, fstatSync, closeSync, readFileSync } from "node:fs"
import { readDistilled, readSessionEvents, readLinks, readTranscript } from "@clens/cli/src/session"
import { buildConversation, buildConversationFromTranscript } from "@clens/cli/src/session/conversation"
import { diffLinesToUnified } from "@clens/cli/src/utils"
import type { AgentNode, SessionSummary, StoredEvent, LinkEvent, SpawnLink } from "@clens/cli"
import { getCachedEvents, setCachedEvents } from "../cache"
import { createLogger } from "../logger"
import { pathsMatch } from "../../shared/paths"

const log = createLogger("sessions")

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

		const CHUNK = 16384

		// For small files (fits in one chunk), read exactly
		if (stat.size <= CHUNK) {
			const buf = Buffer.alloc(stat.size)
			readSync(fd, buf, 0, stat.size, 0)
			const text = buf.toString("utf-8")
			const lines = text.split("\n").filter(Boolean)
			if (lines.length === 0) return undefined
			return { first: lines[0], last: lines[lines.length - 1], lineCount: lines.length }
		}

		// Large file: read head + tail chunks only
		const headBuf = Buffer.alloc(CHUNK)
		readSync(fd, headBuf, 0, CHUNK, 0)
		const headStr = headBuf.toString("utf-8")
		const firstNewline = headStr.indexOf("\n")
		if (firstNewline === -1) return { first: headStr.trim(), last: headStr.trim(), lineCount: 1 }
		const first = headStr.slice(0, firstNewline)

		// Read last line from tail
		const tailBuf = Buffer.alloc(CHUNK)
		readSync(fd, tailBuf, 0, CHUNK, stat.size - CHUNK)
		const tailStr = tailBuf.toString("utf-8")
		const tailLines = tailStr.split("\n").filter(Boolean)
		const last = tailLines.length > 0 ? tailLines[tailLines.length - 1] : first

		// Count newlines in head chunk to estimate average line length
		const headLines = headStr.split("\n").filter(Boolean)
		const avgLineLen = headLines.length > 0 ? CHUNK / headLines.length : first.length + 1
		const lineCount = Math.max(1, Math.round(stat.size / avgLineLen))

		return { first, last, lineCount }
	} finally {
		closeSync(fd)
	}
}

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn"

/** Recursively search agent tree for a node with the given session_id. */
const findAgentById = (agents: readonly AgentNode[], agentId: string): AgentNode | undefined =>
	agents.reduce<AgentNode | undefined>(
		(found, node) => found ?? (node.session_id === agentId ? node : findAgentById(node.children ?? [], agentId)),
		undefined,
	)

/** Count all agents recursively (includes children at every depth). */
const countAgentsRecursive = (agents: readonly { children?: readonly unknown[] }[]): number =>
	agents.reduce((sum, a) => sum + 1 + countAgentsRecursive((a.children ?? []) as readonly { children?: readonly unknown[] }[]), 0)

/** Count all agents in a distilled JSON file (recursive through children). */
const countDistilledAgents = (distilledPath: string): number => {
	try {
		const content = readFileSync(distilledPath, "utf-8")
		const parsed = JSON.parse(content)
		const agents = parsed?.agents
		return Array.isArray(agents) ? countAgentsRecursive(agents) : 0
	} catch {
		return 0
	}
}

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
		} catch (err) {
			log.warn(`Cannot read sessions dir ${sessionsDir}:`, err instanceof Error ? err.message : String(err))
			return []
		}
	})()

	if (files.length === 0) return []

	// Read links once for agent counts
	const links = readLinks(projectDir)
	const spawns = links.filter(isSpawnLink)
	const spawnCountByParent = spawns.reduce(
		(acc, s) => {
			const prev = acc.get(s.parent_session) ?? 0
			return new Map([...acc, [s.parent_session, prev + 1]])
		},
		new Map<string, number>(),
	)

	// Fallback: count unique msg_send recipients per session when no spawns exist
	const msgSendEvents = links.filter((l): l is Extract<LinkEvent, { type: "msg_send" }> => l.type === "msg_send")
	const msgRecipientsBySession = msgSendEvents.reduce(
		(acc, msg) => {
			const sid = msg.session_id ?? msg.from
			const existing = acc.get(sid)
			return new Map([...acc, [sid, existing ? new Set([...existing, msg.to]) : new Set([msg.to])]])
		},
		new Map<string, Set<string>>(),
	)

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
				const isDistilled = existsSync(distilledPath)

				// Agent count: distilled (recursive, authoritative) > spawn links > msg_send > 0
				const distilledCount = isDistilled ? countDistilledAgents(distilledPath) : 0
				const spawnCount = spawnCountByParent.get(sessionId) ?? 0
				const msgCount = msgRecipientsBySession.get(sessionId)?.size ?? 0
				const agentCount = distilledCount > 0
					? distilledCount
					: spawnCount > 0
						? spawnCount
						: msgCount

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
					agent_count: agentCount,
					is_distilled: isDistilled,
				}]
			} catch (err) {
				log.warn(`Failed to parse session file ${file}:`, err instanceof Error ? err.message : String(err))
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
	if (cached) {
		log.debug(`Cache hit for ${sessionId.slice(0, 8)}`)
		return cached
	}
	try {
		const loaded = readSessionEvents(sessionId, projectDir)
		log.debug(`Loaded ${loaded.length} events for ${sessionId.slice(0, 8)}`)
		setCachedEvents(sessionId, loaded)
		return loaded
	} catch (err) {
		log.error(`Failed to load events for ${sessionId.slice(0, 8)}:`, err instanceof Error ? err.message : String(err))
		return undefined
	}
}

// ── Sessions route factory ─────────────────────────────────────────

const createSessionsRoute = (projectDir: string) =>
	new Hono()
		// GET /api/sessions — list sessions with pagination
		.get("/", (c) => {
			log.debug("GET /api/sessions", c.req.query())
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
			log.info(`Session detail: ${sessionId.slice(0, 8)}`)

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
			log.info(`Conversation: ${sessionId.slice(0, 8)}`)
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
			log.info(`Agent conversation: session=${sessionId.slice(0, 8)} agent=${agentId.slice(0, 8)}`)
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

			// Verify agent exists in distilled data (search recursively through agent tree)
			const agent = findAgentById(distilled.agents ?? [], agentId)
			if (!agent) {
				return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404)
			}

			// Try loading hook events first, then fall back to transcript
			const agentEvents = loadEvents(agentId, projectDir)

			const conversation = (() => {
				if (agentEvents) {
					// Hook events available — use full conversation builder
					const agentDistilled = readDistilled(agentId, projectDir)
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
						)
				}

				// No hook events — fall back to Claude Code transcript
				const transcriptPath = agent.transcript_path
				if (transcriptPath && existsSync(transcriptPath)) {
					const transcript = readTranscript(transcriptPath)
					return buildConversationFromTranscript(transcript, agent)
				}

				// No transcript either — build conversation from agent node enrichment data
				// (includes task_prompt, messages, reasoning, backtracks from link enrichment)
				return buildConversationFromTranscript([], agent)
			})()

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
			log.info(`Diff: session=${sessionId.slice(0, 8)} path=${c.req.path}`)
			// Extract file path from wildcard (everything after /diff/)
			const filePath = c.req.path.replace(/^\/api\/sessions\/[^/]+\/diff\//, "")

			if (!filePath) {
				return c.json({ error: "File path required", code: "INVALID_PARAM" }, 400)
			}

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) {
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202)
			}

			// diff_attribution uses relative paths; filePath from URL may be relative or absolute
			const attribution = distilled.edit_chains?.diff_attribution?.find(
				(da) => pathsMatch(da.file_path, filePath),
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

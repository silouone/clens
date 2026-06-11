import { Hono } from "hono"
import { existsSync, readdirSync, statSync, openSync, readSync, fstatSync, closeSync, readFileSync } from "node:fs"
import { readDistilled, readSessionEvents, readLinks, readTranscript, getRelatedSessions, readFeatureIndex } from "@clens/cli/src/session"
import { buildConversation, buildConversationFromTranscript } from "@clens/cli/src/session/conversation"
import { diffLinesToUnified } from "@clens/cli/src/utils"
import type { AgentNode, SessionSummary, StoredEvent, LinkEvent, SpawnLink, ProjectEntry } from "@clens/cli"
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

// Exact line counts are required (estimated counts shipped wrong numbers to the
// UI — see specs/revive/bug-register.md B1). Counting scans the whole file, so
// results are cached per path and invalidated by (size, mtimeMs).
const lineCountCache = new Map<string, { size: number; mtimeMs: number; count: number }>()

/** Count non-empty lines exactly, streaming the fd in chunks (no full-file string alloc). */
const countNonEmptyLines = (fd: number, size: number): number => {
	const CHUNK = 262144
	const buf = Buffer.alloc(Math.min(CHUNK, size))
	let count = 0
	let lineHasContent = false
	let offset = 0
	while (offset < size) {
		const bytesRead = readSync(fd, buf, 0, Math.min(CHUNK, size - offset), offset)
		if (bytesRead <= 0) break
		for (let i = 0; i < bytesRead; ) {
			const nl = buf.indexOf(0x0a, i)
			if (nl === -1 || nl >= bytesRead) {
				if (bytesRead - i > 0) lineHasContent = true
				break
			}
			if (lineHasContent || nl > i) count++
			lineHasContent = false
			i = nl + 1
		}
		offset += bytesRead
	}
	if (lineHasContent) count++
	return count
}

/** Read the first and last lines plus an exact (cached) line count. */
const readFirstLastLines = (filePath: string): { first: string; last: string; lineCount: number } | undefined => {
	const fd = openSync(filePath, "r")
	try {
		const stat = fstatSync(fd)
		if (stat.size === 0) return undefined

		const CHUNK = 16384

		const cached = lineCountCache.get(filePath)
		const lineCount =
			cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs
				? cached.count
				: countNonEmptyLines(fd, stat.size)
		if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) {
			lineCountCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, count: lineCount })
		}
		if (lineCount === 0) return undefined

		// For small files (fits in one chunk), read exactly
		if (stat.size <= CHUNK) {
			const buf = Buffer.alloc(stat.size)
			readSync(fd, buf, 0, stat.size, 0)
			const text = buf.toString("utf-8")
			const lines = text.split("\n").filter(Boolean)
			if (lines.length === 0) return undefined
			return { first: lines[0], last: lines[lines.length - 1], lineCount }
		}

		// Large file: read head + tail chunks for first/last lines only
		const headBuf = Buffer.alloc(CHUNK)
		readSync(fd, headBuf, 0, CHUNK, 0)
		const headStr = headBuf.toString("utf-8")
		const firstNewline = headStr.indexOf("\n")
		if (firstNewline === -1) return { first: headStr.trim(), last: headStr.trim(), lineCount }
		const first = headStr.slice(0, firstNewline)

		// Read last line from tail
		const tailBuf = Buffer.alloc(CHUNK)
		readSync(fd, tailBuf, 0, CHUNK, stat.size - CHUNK)
		const tailStr = tailBuf.toString("utf-8")
		const tailLines = tailStr.split("\n").filter(Boolean)
		const last = tailLines.length > 0 ? tailLines[tailLines.length - 1] : first

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

	// Feature usage flags (loop/goal/workflow) — cached scan, stat-only on hits
	const featureIndex = (() => {
		try {
			return readFeatureIndex(projectDir)
		} catch (err) {
			log.warn(`Feature index failed for ${projectDir}:`, err instanceof Error ? err.message : String(err))
			return new Map<string, readonly ("loop" | "goal" | "workflow")[]>()
		}
	})()

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
	const subagentIds = new Set(spawns.map(s => s.agent_id))

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
					is_subagent: subagentIds.has(sessionId),
					...((featureIndex.get(sessionId)?.length ?? 0) > 0 ? { features: featureIndex.get(sessionId) } : {}),
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
			const limit = parseIntParam(c.req.query("limit"), 20, 1, 5000)
			const sort = (c.req.query("sort") ?? "-start_time") as SortField
			const statusFilter = c.req.query("status")

			// Validate params
			if (page === -1) {
				return c.json({ error: "Invalid page", code: "INVALID_PARAM", detail: "page must be 1-1000" }, 400)
			}
			if (limit === -1) {
				return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-5000" }, 400)
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

			// Enrich with related sessions from work unit index
			const related = getRelatedSessions(sessionId, projectDir)
			const relatedSessions = related.work_unit
				? {
					work_unit_id: related.work_unit.id,
					spec_path: related.work_unit.spec_path,
					sessions: related.work_unit.sessions.map((s) => ({
						session_id: s.session_id,
						session_name: s.session_name,
						phase: s.phase,
						role: s.role,
						start_time: s.start_time,
					})),
				}
				: undefined

			return c.json({
				data: distilled,
				...(relatedSessions ? { related_sessions: relatedSessions } : {}),
			})
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

// ── Global multi-project helpers ─────────────────────────────────

/** Build a map from session ID to project entry by scanning all projects. */
const buildSessionMap = (projects: readonly ProjectEntry[]): ReadonlyMap<string, ProjectEntry> =>
	new Map(
		projects.flatMap((project) => {
			const sessionsDir = `${project.path}/.clens/sessions`
			try {
				return readdirSync(sessionsDir)
					.filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl")
					.map((f): readonly [string, ProjectEntry] => [f.replace(".jsonl", ""), project])
			} catch {
				return []
			}
		}),
	)

/** Lightweight listing that tags sessions with project info. */
const listGlobalSessionsLightweight = (
	projects: readonly ProjectEntry[],
): readonly (SessionSummary & { readonly project_id: string; readonly project_name: string })[] =>
	projects
		.flatMap((project) =>
			listSessionsLightweight(project.path).map((session) => ({
				...session,
				project_id: project.id,
				project_name: project.name,
			})),
		)
		.sort((a, b) => b.start_time - a.start_time)

// ── Global sessions route factory ───────────────────────────────

/**
 * Global sessions route — aggregates sessions from multiple projects.
 * Session detail routes resolve the owning project from the session map.
 */
const createGlobalSessionsRoute = (projects: readonly ProjectEntry[], fallbackProjectDir: string) => {
	const resolveProjectDir = (sessionId: string): string => {
		const project = buildSessionMap(projects).get(sessionId)
		return project?.path ?? fallbackProjectDir
	}

	return new Hono()
		// GET /api/sessions — list sessions from all projects with pagination
		.get("/", (c) => {

			log.debug("GET /api/sessions (global)", c.req.query())
			const page = parseIntParam(c.req.query("page"), 1, 1, 1000)
			const limit = parseIntParam(c.req.query("limit"), 20, 1, 5000)
			const sort = (c.req.query("sort") ?? "-start_time") as SortField
			const statusFilter = c.req.query("status")
			const projectFilter = c.req.query("project")

			if (page === -1) return c.json({ error: "Invalid page", code: "INVALID_PARAM", detail: "page must be 1-1000" }, 400)
			if (limit === -1) return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-5000" }, 400)
			if (!VALID_SORTS.includes(sort)) return c.json({ error: "Invalid sort", code: "INVALID_PARAM", detail: `sort must be one of: ${VALID_SORTS.join(", ")}` }, 400)
			if (statusFilter && !VALID_STATUSES.includes(statusFilter)) return c.json({ error: "Invalid status", code: "INVALID_PARAM", detail: "status must be 'complete' or 'incomplete'" }, 400)

			const enriched = listGlobalSessionsLightweight(projects)

			// Filter by status
			const afterStatus = statusFilter ? enriched.filter((s) => s.status === statusFilter) : enriched

			// Filter by project
			const afterProject = projectFilter ? afterStatus.filter((s) => s.project_id === projectFilter) : afterStatus

			// Sort
			const sorted = [...afterProject].sort(buildComparator(sort))

			// Paginate
			const total = sorted.length
			const offset = (page - 1) * limit
			const data = sorted.slice(offset, offset + limit)

			return c.json({
				data,
				pagination: { page, limit, total, has_next: offset + limit < total },
			})
		})

		// GET /api/sessions/:sessionId — session detail (resolves project)
		.get("/:sessionId", (c) => {
			const sessionId = c.req.param("sessionId")
			const projectDir = resolveProjectDir(sessionId)
			log.info(`Session detail (global): ${sessionId.slice(0, 8)} → ${projectDir}`)

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) {
				const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`)
				if (!exists) return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404)
				return c.json({ status: "not_distilled" as const }, 202)
			}

			const related = getRelatedSessions(sessionId, projectDir)
			const relatedSessions = related.work_unit
				? {
					work_unit_id: related.work_unit.id,
					spec_path: related.work_unit.spec_path,
					sessions: related.work_unit.sessions.map((s) => ({
						session_id: s.session_id,
						session_name: s.session_name,
						phase: s.phase,
						role: s.role,
						start_time: s.start_time,
					})),
				}
				: undefined

			return c.json({
				data: distilled,
				...(relatedSessions ? { related_sessions: relatedSessions } : {}),
			})
		})

		// GET /api/sessions/:sessionId/events — paginated events
		.get("/:sessionId/events", (c) => {
			const sessionId = c.req.param("sessionId")
			const projectDir = resolveProjectDir(sessionId)
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000)
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000)

			if (offset === -1) return c.json({ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" }, 400)
			if (limit === -1) return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" }, 400)

			const events = loadEvents(sessionId, projectDir)
			if (!events) return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404)

			const total = events.length
			const data = events.slice(offset, offset + limit)
			return c.json({ data, pagination: { offset, limit, total, has_next: offset + limit < total } })
		})

		// GET /api/sessions/:sessionId/conversation
		.get("/:sessionId/conversation", (c) => {
			const sessionId = c.req.param("sessionId")
			const projectDir = resolveProjectDir(sessionId)
			log.info(`Conversation (global): ${sessionId.slice(0, 8)}`)
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000)
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000)

			if (offset === -1) return c.json({ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" }, 400)
			if (limit === -1) return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" }, 400)

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) {
				const exists = existsSync(`${projectDir}/.clens/sessions/${sessionId}.jsonl`)
				if (!exists) return c.json({ error: "Session not found", code: "NOT_FOUND" }, 404)
				return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202)
			}

			const events = loadEvents(sessionId, projectDir)
			if (!events) return c.json({ error: "Session events not found", code: "NOT_FOUND" }, 404)

			const conversation = buildConversation(distilled, events)
			const total = conversation.length
			const data = conversation.slice(offset, offset + limit)
			return c.json({ data, pagination: { offset, limit, total, has_next: offset + limit < total } })
		})

		// GET /api/sessions/:sessionId/agents/:agentId/conversation
		.get("/:sessionId/agents/:agentId/conversation", (c) => {
			const sessionId = c.req.param("sessionId")
			const agentId = c.req.param("agentId")
			const projectDir = resolveProjectDir(sessionId)
			log.info(`Agent conversation (global): session=${sessionId.slice(0, 8)} agent=${agentId.slice(0, 8)}`)
			const offset = parseIntParam(c.req.query("offset"), 0, 0, 1_000_000)
			const limit = parseIntParam(c.req.query("limit"), 100, 1, 1000)

			if (offset === -1) return c.json({ error: "Invalid offset", code: "INVALID_PARAM", detail: "offset must be 0-1000000" }, 400)
			if (limit === -1) return c.json({ error: "Invalid limit", code: "INVALID_PARAM", detail: "limit must be 1-1000" }, 400)

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202)

			const agent = findAgentById(distilled.agents ?? [], agentId)
			if (!agent) return c.json({ error: "Agent not found", code: "NOT_FOUND" }, 404)

			const agentEvents = loadEvents(agentId, projectDir)
			const conversation = (() => {
				if (agentEvents) {
					const agentDistilled = readDistilled(agentId, projectDir)
					return agentDistilled
						? buildConversation(agentDistilled, agentEvents)
						: buildConversation({ ...distilled, reasoning: agent.reasoning ?? [], user_messages: [], backtracks: agent.backtracks ?? [], summary: distilled.summary }, agentEvents)
				}
				const transcriptPath = agent.transcript_path
				if (transcriptPath && existsSync(transcriptPath)) {
					const transcript = readTranscript(transcriptPath)
					return buildConversationFromTranscript(transcript, agent)
				}
				return buildConversationFromTranscript([], agent)
			})()

			const total = conversation.length
			const data = conversation.slice(offset, offset + limit)
			return c.json({ data, pagination: { offset, limit, total, has_next: offset + limit < total } })
		})

		// GET /api/sessions/:sessionId/diff/*
		.get("/:sessionId/diff/*", (c) => {
			const sessionId = c.req.param("sessionId")
			const projectDir = resolveProjectDir(sessionId)
			log.info(`Diff (global): session=${sessionId.slice(0, 8)} path=${c.req.path}`)
			const filePath = c.req.path.replace(/^\/api\/sessions\/[^/]+\/diff\//, "")

			if (!filePath) return c.json({ error: "File path required", code: "INVALID_PARAM" }, 400)

			const distilled = readDistilled(sessionId, projectDir)
			if (!distilled) return c.json({ error: "Session not distilled", code: "NOT_DISTILLED" }, 202)

			const attribution = distilled.edit_chains?.diff_attribution?.find((da) => pathsMatch(da.file_path, filePath))
			if (!attribution) return c.json({ error: "No diff found for file", code: "NOT_FOUND" }, 404)

			const unified_diff = diffLinesToUnified(filePath, attribution.lines)
			return c.json({ data: { file_path: filePath, unified_diff, total_additions: attribution.total_additions, total_deletions: attribution.total_deletions } })
		})
}

export { createSessionsRoute, createGlobalSessionsRoute }

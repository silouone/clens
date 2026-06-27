import { Hono } from "hono"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { distill } from "clens/src/distill"
import { writeAnalyticsSummary } from "clens/src/distill/analytics-summary"
import type { ProjectEntry } from "clens"
import { broadcastSSE } from "./events"
import { invalidateAnalyticsCache } from "./analytics"
import { createLogger } from "../logger"

const log = createLogger("commands")

// ── Session directory resolution ─────────────────────────────────

/**
 * Find every directory below `projectDir` (bounded depth) that directly holds
 * a `.clens/sessions/` dir, mirroring the CLI's `findAllClensDirs`. In
 * repository mode a project's `path` is the git root while the capture dir may
 * be nested (e.g. `gitRoot/packages/web/.clens/sessions`); without scanning,
 * distill cannot resolve such sessions (bug repo-mode-nested-clens-projects-dropped).
 */
const findClensCaptureDirs = (projectDir: string, maxDepth = 3): readonly string[] => {
	const scan = (dir: string, depth: number): readonly string[] => {
		if (depth > maxDepth) return []
		const entries = (() => {
			try {
				return readdirSync(dir, { withFileTypes: true })
			} catch {
				return []
			}
		})()
		return entries.flatMap((entry) => {
			if (!entry.isDirectory()) return []
			if (entry.name === "node_modules" || entry.name === ".git") return []
			const fullPath = resolve(dir, entry.name)
			if (entry.name === ".clens") {
				return existsSync(resolve(fullPath, "sessions")) ? [dir] : []
			}
			if (entry.name.startsWith(".")) return []
			return scan(fullPath, depth + 1)
		})
	}
	return scan(projectDir, 0)
}

/**
 * Find the capture directory that owns a session, checking all registered
 * projects and any nested `.clens/sessions/` dirs within them. Returns the
 * directory that directly contains `.clens/sessions/<sid>.jsonl` so that
 * downstream `${dir}/.clens/...` reads resolve correctly.
 */
const resolveSessionDir = (
	sessionId: string,
	fallbackDir: string,
	projects: readonly ProjectEntry[],
): string => {
	const match = projects
		.flatMap((project) => findClensCaptureDirs(project.path))
		.find((captureDir) => existsSync(`${captureDir}/.clens/sessions/${sessionId}.jsonl`))
	return match ?? fallbackDir
}

// ── Commands route factory ─────────────────────────────────────────

const createCommandsRoute = (projectDir: string, projects: readonly ProjectEntry[] = []) =>
	new Hono()
		// POST /api/sessions/:sessionId/distill — trigger async distill
		.post("/:sessionId/distill", async (c) => {
			const sessionId = c.req.param("sessionId")
			log.info(`Distill requested: ${sessionId.slice(0, 8)}`)

			// Resolve owning project (global mode: check all projects)
			const ownerDir = projects.length > 0
				? resolveSessionDir(sessionId, projectDir, projects)
				: projectDir

			// Validate session file exists
			const sessionPath = `${ownerDir}/.clens/sessions/${sessionId}.jsonl`
			if (!existsSync(sessionPath)) {
				log.warn(`Distill: session not found ${sessionId.slice(0, 8)}`)
				return c.json(
					{ error: "Session not found", code: "NOT_FOUND" },
					404,
				)
			}

			// Fire-and-forget: start deep distill, persist result, and broadcast when done
			distill(sessionId, ownerDir, { deep: true })
				.then((result) => {
					const distilledDir = `${ownerDir}/.clens/distilled`
					mkdirSync(distilledDir, { recursive: true })
					writeFileSync(
						`${distilledDir}/${sessionId}.json`,
						JSON.stringify(result, null, 2),
					)
					log.info(`Distill complete: ${sessionId.slice(0, 8)}`)
					// Refresh the analytics summary row like the CLI distill does, then
					// invalidate the analytics cache so the dashboard reflects the new row
					// immediately (bug web-distill-skips-analytics-summary).
					try {
						writeAnalyticsSummary(result, ownerDir)
						invalidateAnalyticsCache()
					} catch (err) {
						log.warn(`Analytics summary update failed: ${sessionId.slice(0, 8)}`, err instanceof Error ? err.message : String(err))
					}
					broadcastSSE({
						type: "distill_complete",
						data: { session_id: sessionId },
					})
				})
				.catch((err) => {
					log.error(`Distill failed: ${sessionId.slice(0, 8)}`, err instanceof Error ? err.message : String(err))
					broadcastSSE({
						type: "distill_complete",
						data: { session_id: sessionId, error: true },
					})
				})

			return c.json({ status: "started" as const })
		})

export { createCommandsRoute }

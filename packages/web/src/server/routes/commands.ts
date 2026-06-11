import { Hono } from "hono"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { distill } from "@clens/cli/src/distill"
import { rebuildWorkUnitIndex } from "@clens/cli/src/session/work-units"
import type { ProjectEntry } from "@clens/cli"
import { broadcastSSE } from "./events"
import { createLogger } from "../logger"

const log = createLogger("commands")

// ── Session directory resolution ─────────────────────────────────

/** Find the project directory that owns a session, checking all registered projects. */
const resolveSessionDir = (
	sessionId: string,
	fallbackDir: string,
	projects: readonly ProjectEntry[],
): string => {
	for (const project of projects) {
		if (existsSync(`${project.path}/.clens/sessions/${sessionId}.jsonl`)) {
			return project.path
		}
	}
	return fallbackDir
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
					try { rebuildWorkUnitIndex(ownerDir) } catch { /* best-effort */ }
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

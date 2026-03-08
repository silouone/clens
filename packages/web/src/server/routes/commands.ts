import { Hono } from "hono"
import { existsSync } from "node:fs"
import { distill } from "@clens/cli/src/distill"
import { broadcastSSE } from "./events"

// ── Commands route factory ─────────────────────────────────────────

const createCommandsRoute = (projectDir: string) =>
	new Hono()
		// POST /api/sessions/:sessionId/distill — trigger async distill
		.post("/:sessionId/distill", async (c) => {
			const sessionId = c.req.param("sessionId")

			// Validate session file exists
			const sessionPath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`
			if (!existsSync(sessionPath)) {
				return c.json(
					{ error: "Session not found", code: "NOT_FOUND" },
					404,
				)
			}

			// Fire-and-forget: start distill and broadcast when done
			distill(sessionId, projectDir)
				.then(() => {
					broadcastSSE({
						type: "distill_complete",
						data: { session_id: sessionId },
					})
				})
				.catch(() => {
					broadcastSSE({
						type: "distill_complete",
						data: { session_id: sessionId, error: true },
					})
				})

			return c.json({ status: "started" as const })
		})

export { createCommandsRoute }

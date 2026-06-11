import { Hono } from "hono"
import { readWorkUnitIndex } from "@clens/cli/src/session/work-units"
import { readDistilled } from "@clens/cli/src/session"
import type { DistilledSession, ProjectEntry, WorkUnit } from "@clens/cli"
import { createLogger } from "../logger"

/** A single work unit entry from the index. */
type WorkUnitEntry = WorkUnit

const log = createLogger("work-units")

// ── Lightweight session summary from first/last lines ───────────────

/** Build a minimal session summary from distilled data or raw file existence. */
const buildSessionSummary = (
	sessionId: string,
	distilled: DistilledSession | undefined,
): { readonly session_id: string; readonly session_name?: string; readonly is_distilled: boolean; readonly duration_ms: number } => ({
	session_id: sessionId,
	session_name: distilled?.session_name ?? undefined,
	is_distilled: distilled !== undefined,
	// Wall span: work-unit date ranges treat start_time + duration_ms as the
	// session end, so the idle-trimmed value put ends hours early (bug B14)
	duration_ms: distilled?.stats.wall_duration_ms ?? distilled?.stats.duration_ms ?? 0,
})

// ── Work Units route factory ────────────────────────────────────────

const createWorkUnitsRoute = (projectDir: string) =>
	new Hono()
		// GET /api/work-units — list all work units
		.get("/", (c) => {
			const index = readWorkUnitIndex(projectDir)
			if (!index) return c.json({ data: [] })
			return c.json({ data: index.units })
		})
		// GET /api/work-units/:id — single work unit detail
		.get("/:id", (c) => {
			const id = c.req.param("id")
			const index = readWorkUnitIndex(projectDir)
			const unit = index?.units.find((u) => u.id === id)
			if (!unit) return c.json({ error: "Work unit not found", code: "NOT_FOUND" }, 404)
			return c.json({ data: unit })
		})
		// GET /api/work-units/:id/detail — enriched work unit with session distilled data
		.get("/:id/detail", (c) => {
			const id = c.req.param("id")
			log.info(`Work unit detail: ${id.slice(0, 12)}`)

			const index = readWorkUnitIndex(projectDir)
			const unit = index?.units.find((u) => u.id === id)
			if (!unit) return c.json({ error: "Work unit not found", code: "NOT_FOUND" }, 404)

			const sessions = unit.sessions.map((s) => {
				const distilled = readDistilled(s.session_id, projectDir)
				return {
					session_id: s.session_id,
					session_name: s.session_name,
					phase: s.phase,
					role: s.role,
					start_time: s.start_time,
					distilled: distilled ?? null,
					summary: buildSessionSummary(s.session_id, distilled ?? undefined),
				}
			})

			return c.json({
				data: {
					unit,
					sessions,
				},
			})
		})

// ── Global multi-project work units route ───────────────────────

const createGlobalWorkUnitsRoute = (projects: readonly ProjectEntry[], _fallbackProjectDir: string) =>
	new Hono()
		// GET /api/work-units — list all work units from all projects
		.get("/", (c) => {
			const allUnits = projects.flatMap((project) => {
				const index = readWorkUnitIndex(project.path)
				if (!index) return []
				return index.units.map((unit) => ({
					...unit,
					project_id: project.id,
					project_name: project.name,
				}))
			})
			return c.json({ data: allUnits })
		})
		// GET /api/work-units/:id — single work unit (searches all projects)
		.get("/:id", (c) => {
			const id = c.req.param("id")
			const found = projects.reduce<{ readonly unit: WorkUnitEntry; readonly project: ProjectEntry } | undefined>(
				(acc, project) => {
					if (acc) return acc
					const index = readWorkUnitIndex(project.path)
					const unit = index?.units.find((u) => u.id === id)
					return unit ? { unit, project } : undefined
				},
				undefined,
			)
			if (!found) return c.json({ error: "Work unit not found", code: "NOT_FOUND" }, 404)
			return c.json({ data: { ...found.unit, project_id: found.project.id, project_name: found.project.name } })
		})
		// GET /api/work-units/:id/detail — enriched work unit with session distilled data
		.get("/:id/detail", (c) => {
			const id = c.req.param("id")
			log.info(`Work unit detail (global): ${id.slice(0, 12)}`)

			const found = projects.reduce<{ readonly unit: WorkUnitEntry; readonly project: ProjectEntry } | undefined>(
				(acc, project) => {
					if (acc) return acc
					const index = readWorkUnitIndex(project.path)
					const unit = index?.units.find((u) => u.id === id)
					return unit ? { unit, project } : undefined
				},
				undefined,
			)

			if (!found) return c.json({ error: "Work unit not found", code: "NOT_FOUND" }, 404)

			const sessions = found.unit.sessions.map((s) => {
				const distilled = readDistilled(s.session_id, found.project.path)
				return {
					session_id: s.session_id,
					session_name: s.session_name,
					phase: s.phase,
					role: s.role,
					start_time: s.start_time,
					distilled: distilled ?? null,
					summary: buildSessionSummary(s.session_id, distilled ?? undefined),
				}
			})

			return c.json({
				data: {
					unit: { ...found.unit, project_id: found.project.id, project_name: found.project.name },
					sessions,
				},
			})
		})

export { createWorkUnitsRoute, createGlobalWorkUnitsRoute }

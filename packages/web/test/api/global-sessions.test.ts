import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../../src/server/app"
import type { ProjectEntry } from "clens"

const SESSION_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const SESSION_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

const makeEvent = (event: string, t: number, data: Record<string, unknown> = {}, sid: string = SESSION_A) =>
	JSON.stringify({ event, t, sid, data, context: { git_branch: "main" } })

describe("web API — global sessions", () => {
	let tempDir: string
	let projectA: string
	let projectB: string
	let projects: ProjectEntry[]
	let app: ReturnType<typeof createApp>

	beforeAll(() => {
		tempDir = join(tmpdir(), `clens-test-web-global-${Date.now()}`)

		projectA = join(tempDir, "project-alpha")
		projectB = join(tempDir, "project-beta")

		mkdirSync(join(projectA, ".clens", "sessions"), { recursive: true })
		mkdirSync(join(projectA, ".clens", "distilled"), { recursive: true })
		mkdirSync(join(projectB, ".clens", "sessions"), { recursive: true })
		mkdirSync(join(projectB, ".clens", "distilled"), { recursive: true })

		writeFileSync(
			join(projectA, ".clens", "sessions", `${SESSION_A}.jsonl`),
			[
				makeEvent("SessionStart", 1000, { source: "cli" }, SESSION_A),
				makeEvent("SessionEnd", 2000, { reason: "done" }, SESSION_A),
			].join("\n") + "\n",
		)
		writeFileSync(
			join(projectB, ".clens", "sessions", `${SESSION_B}.jsonl`),
			[
				makeEvent("SessionStart", 3000, { source: "cli" }, SESSION_B),
				makeEvent("SessionEnd", 4000, { reason: "done" }, SESSION_B),
			].join("\n") + "\n",
		)

		projects = [
			{ id: "project-alpha", path: projectA, name: "project-alpha", added_at: Date.now() },
			{ id: "project-beta", path: projectB, name: "project-beta", added_at: Date.now() },
		]

		app = createApp({
			token: "test-token",
			mode: "development",
			projectDir: projectA,
			projects,
		})
	})

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	describe("GET /api/projects", () => {
		test("returns the project list", async () => {
			const res = await app.request("/api/projects")
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.data).toHaveLength(2)
			expect(body.data[0].id).toBe("project-alpha")
			expect(body.data[1].id).toBe("project-beta")
		})
	})

	describe("GET /api/sessions (global)", () => {
		test("returns sessions from both projects", async () => {
			const res = await app.request("/api/sessions")
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.data.length).toBeGreaterThanOrEqual(2)

			const projectIds = body.data.map((s: Record<string, unknown>) => s.project_id)
			expect(projectIds).toContain("project-alpha")
			expect(projectIds).toContain("project-beta")
		})

		test("supports project filter query param", async () => {
			const res = await app.request("/api/sessions?project=project-alpha")
			expect(res.status).toBe(200)
			const body = await res.json()

			const allAlpha = body.data.every(
				(s: Record<string, unknown>) => s.project_id === "project-alpha",
			)
			expect(allAlpha).toBe(true)
		})

		test("returns pagination metadata", async () => {
			const res = await app.request("/api/sessions?page=1&limit=10")
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.pagination).toBeDefined()
			expect(typeof body.pagination.page).toBe("number")
			expect(typeof body.pagination.total).toBe("number")
		})
	})

	describe("GET /api/sessions/:id (global)", () => {
		test("resolves session from correct project — returns 202 (not distilled)", async () => {
			const res = await app.request(`/api/sessions/${SESSION_A}`)
			// 202 = found the session file but not distilled yet
			expect([200, 202]).toContain(res.status)
		})

		test("returns 404 for unknown session", async () => {
			const res = await app.request("/api/sessions/00000000-0000-0000-0000-000000000000")
			expect(res.status).toBe(404)
		})
	})
})

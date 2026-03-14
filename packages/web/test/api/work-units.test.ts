import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { createApp } from "../../src/server/app"

const TEST_DIR = "/tmp/clens-work-units-api-test"
const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const SESSION_ID_2 = "11111111-2222-3333-4444-555555555555"

const makeEvent = (event: string, t: number, data: Record<string, unknown> = {}) =>
	JSON.stringify({ event, t, data, context: { git_branch: "feature/test" } })

describe("Work Units API", () => {
	let app: ReturnType<typeof createApp>

	beforeAll(() => {
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true })
		mkdirSync(`${TEST_DIR}/.clens/distilled`, { recursive: true })

		// Write minimal session files
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/${SESSION_ID}.jsonl`,
			[makeEvent("SessionStart", 1000, { source: "cli" }), makeEvent("Stop", 3000, { reason: "done" })].join("\n") + "\n",
		)
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/${SESSION_ID_2}.jsonl`,
			[makeEvent("SessionStart", 5000, { source: "cli" }), makeEvent("Stop", 8000, { reason: "done" })].join("\n") + "\n",
		)

		// Write _links.jsonl with spawn events so subagent detection works
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/_links.jsonl`,
			JSON.stringify({ type: "spawn", parent_session: SESSION_ID, agent_id: "subagent-1", agent_type: "Explore", t: 1500 }) + "\n",
		)

		app = createApp({
			token: "test-token",
			mode: "development",
			projectDir: TEST_DIR,
		})
	})

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true })
	})

	test("GET /api/work-units returns empty array when no index exists", async () => {
		const res = await app.request("/api/work-units")
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data).toEqual([])
	})

	test("GET /api/work-units returns units when index exists", async () => {
		const index = {
			version: 1,
			updated_at: Date.now(),
			units: [{
				id: "test-unit-1",
				link_type: "spec",
				spec_path: "specs/plan.md",
				sessions: [
					{ session_id: SESSION_ID, phase: "plan", role: "creator", start_time: 1000, duration_ms: 2000 },
					{ session_id: SESSION_ID_2, phase: "build", role: "consumer", start_time: 5000, duration_ms: 3000 },
				],
				lifecycle: "plan-build",
				total_duration_ms: 5000,
				date_range: { start: 1000, end: 8000 },
			}],
		}
		writeFileSync(`${TEST_DIR}/.clens/_work_units.json`, JSON.stringify(index))

		const res = await app.request("/api/work-units")
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data).toHaveLength(1)
		expect(body.data[0].id).toBe("test-unit-1")
		expect(body.data[0].spec_path).toBe("specs/plan.md")
	})

	test("GET /api/work-units/:id returns 404 for unknown ID", async () => {
		const res = await app.request("/api/work-units/nonexistent")
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body.code).toBe("NOT_FOUND")
	})

	test("GET /api/work-units/:id returns unit when found", async () => {
		const res = await app.request("/api/work-units/test-unit-1")
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.id).toBe("test-unit-1")
		expect(body.data.sessions).toHaveLength(2)
	})

	test("GET /api/sessions includes is_subagent field", async () => {
		const res = await app.request("/api/sessions")
		expect(res.status).toBe(200)
		const body = await res.json()
		// Parent session should not be subagent
		const parent = body.data.find((s: Record<string, unknown>) => s.session_id === SESSION_ID)
		expect(parent?.is_subagent).toBe(false)
		// Session 2 is also not a subagent (not in spawns)
		const session2 = body.data.find((s: Record<string, unknown>) => s.session_id === SESSION_ID_2)
		expect(session2?.is_subagent).toBe(false)
	})

	test("GET /api/sessions/:sessionId includes related_sessions", async () => {
		// Write distilled data for SESSION_ID
		writeFileSync(
			`${TEST_DIR}/.clens/distilled/${SESSION_ID}.json`,
			JSON.stringify({
				session_id: SESSION_ID,
				stats: { total_events: 2, duration_ms: 2000, events_by_type: {}, tools_by_name: {}, tool_call_count: 0, failure_count: 0, failure_rate: 0, unique_files: [] },
				backtracks: [],
				decisions: [],
				file_map: { files: [] },
				git_diff: { commits: [], hunks: [] },
				reasoning: [],
				user_messages: [],
				complete: true,
			}),
		)

		const res = await app.request(`/api/sessions/${SESSION_ID}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data).toBeDefined()
		expect(body.related_sessions).toBeDefined()
		expect(body.related_sessions.work_unit_id).toBe("test-unit-1")
		expect(body.related_sessions.spec_path).toBe("specs/plan.md")
		expect(body.related_sessions.sessions).toHaveLength(2)
	})
})

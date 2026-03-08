import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { createApp } from "../../src/server/app"

const TEST_TOKEN = "test-token-api"
const TEST_DIR = "/tmp/clens-api-test"
const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const DISTILLED_SESSION_ID = "11111111-2222-3333-4444-555555555555"
const AGENT_ID = "22222222-3333-4444-5555-666666666666"

const makeEvent = (event: string, t: number, data: Record<string, unknown> = {}, sid: string = SESSION_ID) =>
	JSON.stringify({ event, t, sid, data, context: {} })

describe("Session API endpoints", () => {
	let app: ReturnType<typeof createApp>

	beforeAll(() => {
		// Create test fixture
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true })
		mkdirSync(`${TEST_DIR}/.clens/distilled`, { recursive: true })

		// Write a test session JSONL
		const events = [
			makeEvent("SessionStart", 1000, { source: "cli" }),
			makeEvent("ToolUse", 1500, { tool: "Read" }),
			makeEvent("ToolResult", 2000, { tool: "Read" }),
			makeEvent("Stop", 3000, { reason: "user" }),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${SESSION_ID}.jsonl`, events.join("\n") + "\n")

		// Write a second session with distilled data + tool events for conversation
		const distilledEvents = [
			makeEvent("SessionStart", 5000, { source: "cli" }, DISTILLED_SESSION_ID),
			makeEvent("PreToolUse", 5200, { tool_name: "Read", tool_use_id: "tu_001", tool_input: { file_path: "src/app.ts" } }, DISTILLED_SESSION_ID),
			makeEvent("PostToolUse", 5300, { tool_name: "Read", tool_use_id: "tu_001" }, DISTILLED_SESSION_ID),
			makeEvent("PreToolUse", 5500, { tool_name: "Edit", tool_use_id: "tu_002", tool_input: { file_path: "src/app.ts" } }, DISTILLED_SESSION_ID),
			makeEvent("PostToolUse", 5600, { tool_name: "Edit", tool_use_id: "tu_002" }, DISTILLED_SESSION_ID),
			makeEvent("Stop", 6000, { reason: "done" }, DISTILLED_SESSION_ID),
		]
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/${DISTILLED_SESSION_ID}.jsonl`,
			distilledEvents.join("\n") + "\n",
		)
		writeFileSync(
			`${TEST_DIR}/.clens/distilled/${DISTILLED_SESSION_ID}.json`,
			JSON.stringify({
				session_id: DISTILLED_SESSION_ID,
				stats: { total_events: 6, duration_ms: 1000, events_by_type: {}, tools_by_name: {}, tool_call_count: 2, failure_count: 0, failure_rate: 0, unique_files: ["src/app.ts"] },
				backtracks: [],
				decisions: [],
				file_map: { files: [{ path: "src/app.ts", operations: ["edit"] }] },
				git_diff: { commits: [], hunks: [] },
				edit_chains: {
					chains: [],
					diff_attribution: [
						{
							file_path: "src/app.ts",
							lines: [
								{ type: "context", content: "const x = 1" },
								{ type: "remove", content: "const y = 2" },
								{ type: "add", content: "const y = 3" },
							],
							total_additions: 1,
							total_deletions: 1,
						},
					],
				},
				reasoning: [{ t: 5100, thinking: "I need to read the file first", intent_hint: "planning" }],
				user_messages: [{ t: 5000, content: "Fix the bug in app.ts", message_type: "prompt", is_tool_result: false }],
				agents: [{ session_id: AGENT_ID, agent_type: "builder", agent_name: "worker-1" }],
				summary: { phases: [{ name: "build", start_t: 5000, end_t: 6000 }] },
				complete: true,
			}),
		)

		// Write agent session events
		const agentEvents = [
			makeEvent("SessionStart", 5100, { source: "spawn" }, AGENT_ID),
			makeEvent("PreToolUse", 5200, { tool_name: "Write", tool_use_id: "tu_a01", tool_input: { file_path: "src/utils.ts" } }, AGENT_ID),
			makeEvent("PostToolUse", 5300, { tool_name: "Write", tool_use_id: "tu_a01" }, AGENT_ID),
			makeEvent("Stop", 5500, { reason: "done" }, AGENT_ID),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${AGENT_ID}.jsonl`, agentEvents.join("\n") + "\n")

		app = createApp({ token: TEST_TOKEN, mode: "development", projectDir: TEST_DIR })
	})

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true })
	})

	const authHeaders = { Authorization: `Bearer ${TEST_TOKEN}` }

	const req = (path: string, init?: RequestInit) =>
		app.request(path, { headers: authHeaders, ...init })

	// ── GET /api/sessions ──────────────────────────────────────────

	test("GET /api/sessions returns paginated list", async () => {
		const res = await req("/api/sessions")
		expect(res.status).toBe(200)

		const body = await res.json()
		expect(body.data).toBeDefined()
		expect(body.pagination).toBeDefined()
		expect(body.pagination.page).toBe(1)
		expect(body.pagination.limit).toBe(20)
		expect(body.data.length).toBeGreaterThanOrEqual(1)
	})

	test("GET /api/sessions validates bad page param", async () => {
		const res = await req("/api/sessions?page=-1")
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.code).toBe("INVALID_PARAM")
	})

	test("GET /api/sessions filters by status", async () => {
		const res = await req("/api/sessions?status=complete")
		expect(res.status).toBe(200)
		const body = await res.json()
		body.data.forEach((s: { status: string }) => expect(s.status).toBe("complete"))
	})

	test("GET /api/sessions rejects invalid status", async () => {
		const res = await req("/api/sessions?status=invalid")
		expect(res.status).toBe(400)
	})

	test("GET /api/sessions rejects invalid sort", async () => {
		const res = await req("/api/sessions?sort=bad_field")
		expect(res.status).toBe(400)
	})

	test("GET /api/sessions rejects invalid limit", async () => {
		const res = await req("/api/sessions?limit=0")
		expect(res.status).toBe(400)
	})

	test("GET /api/sessions pagination has_next is correct", async () => {
		const res = await req("/api/sessions?limit=1&page=1")
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.pagination.limit).toBe(1)
		// We have 2 sessions, so page 1 with limit 1 should have has_next=true
		expect(body.pagination.has_next).toBe(true)
	})

	// ── GET /api/sessions/:id ──────────────────────────────────────

	test("GET /api/sessions/:id returns distilled data", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data).toBeDefined()
		expect(body.data.session_id).toBe(DISTILLED_SESSION_ID)
		expect(body.data.stats).toBeDefined()
		expect(body.data.complete).toBe(true)
	})

	test("GET /api/sessions/:id returns 202 when not distilled", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}`)
		expect(res.status).toBe(202)
		const body = await res.json()
		expect(body.status).toBe("not_distilled")
	})

	test("GET /api/sessions/:id returns 404 for unknown session", async () => {
		const res = await req("/api/sessions/00000000-0000-0000-0000-000000000000")
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body.code).toBe("NOT_FOUND")
	})

	test("GET /api/sessions/:id rejects non-UUID session ID", async () => {
		const res = await req("/api/sessions/not-a-uuid")
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.code).toBe("INVALID_SESSION_ID")
	})

	// ── GET /api/sessions/:id/events ───────────────────────────────

	test("GET /api/sessions/:id/events returns paginated events", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}/events`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBe(4)
		expect(body.pagination.total).toBe(4)
		expect(body.pagination.has_next).toBe(false)
	})

	test("GET /api/sessions/:id/events supports pagination", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}/events?offset=1&limit=2`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBe(2)
		expect(body.data[0].event).toBe("ToolUse")
		expect(body.pagination.has_next).toBe(true)
	})

	test("GET /api/sessions/:id/events returns 404 for unknown session", async () => {
		const res = await req("/api/sessions/00000000-0000-0000-0000-000000000000/events")
		expect(res.status).toBe(404)
	})

	test("GET /api/sessions/:id/events rejects invalid offset", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}/events?offset=-5`)
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.code).toBe("INVALID_PARAM")
	})

	test("GET /api/sessions/:id/events rejects invalid limit", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}/events?limit=0`)
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.code).toBe("INVALID_PARAM")
	})

	// ── POST /api/commands/sessions/:id/distill ────────────────────

	test("POST /api/commands/sessions/:id/distill returns started", async () => {
		const res = await req(`/api/commands/sessions/${SESSION_ID}/distill`, { method: "POST" })
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toBe("started")
	})

	test("POST /api/commands/sessions/:id/distill returns 404 for unknown", async () => {
		const res = await req("/api/commands/sessions/00000000-0000-0000-0000-000000000000/distill", { method: "POST" })
		expect(res.status).toBe(404)
	})

	test("POST /api/commands/sessions/:id/distill rejects non-UUID session ID", async () => {
		const res = await req("/api/commands/sessions/not-a-uuid/distill", { method: "POST" })
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.code).toBe("INVALID_SESSION_ID")
	})

	// ── Auth (production mode enforces tokens) ───────────────────

	test("auth skipped in development mode", async () => {
		// dev app is the default `app` — no token needed
		const res = await app.request("/api/sessions")
		expect(res.status).toBe(200)
	})

	test("production mode returns 401 without token", async () => {
		const prodApp = createApp({ token: TEST_TOKEN, mode: "production", projectDir: TEST_DIR })
		const res = await prodApp.request("/api/sessions")
		expect(res.status).toBe(401)
	})

	test("production mode accepts token via query param", async () => {
		const prodApp = createApp({ token: TEST_TOKEN, mode: "production", projectDir: TEST_DIR })
		const res = await prodApp.request(`/api/sessions?token=${TEST_TOKEN}`)
		expect(res.status).toBe(200)
	})

	test("production mode returns 401 with invalid token", async () => {
		const prodApp = createApp({ token: TEST_TOKEN, mode: "production", projectDir: TEST_DIR })
		const res = await prodApp.request("/api/sessions", {
			headers: { Authorization: "Bearer wrong-token" },
		})
		expect(res.status).toBe(401)
		const body = await res.json()
		expect(body.code).toBe("AUTH_REQUIRED")
	})

	test("production mode returns 401 with malformed Authorization header", async () => {
		const prodApp = createApp({ token: TEST_TOKEN, mode: "production", projectDir: TEST_DIR })
		const res = await prodApp.request("/api/sessions", {
			headers: { Authorization: "Basic abc123" },
		})
		expect(res.status).toBe(401)
	})

	// ── CORS ──────────────────────────────────────────────────────

	test("CORS headers present for allowed origin in dev mode", async () => {
		const res = await app.request("/api/sessions", {
			headers: {
				...authHeaders,
				Origin: "http://localhost:5173",
			},
		})
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173")
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET")
	})

	test("CORS headers absent for disallowed origin in dev mode", async () => {
		const res = await app.request("/api/sessions", {
			headers: {
				...authHeaders,
				Origin: "http://evil.com",
			},
		})
		expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
	})

	test("OPTIONS preflight returns 204 for allowed origin", async () => {
		const res = await app.request("/api/sessions", {
			method: "OPTIONS",
			headers: { Origin: "http://localhost:5173" },
		})
		expect(res.status).toBe(204)
	})

	test("OPTIONS preflight returns 403 for disallowed origin", async () => {
		const res = await app.request("/api/sessions", {
			method: "OPTIONS",
			headers: { Origin: "http://evil.com" },
		})
		expect(res.status).toBe(403)
	})

	// ── Health (unauthenticated) ──────────────────────────────────

	test("GET /health is accessible without auth", async () => {
		const res = await app.request("/health")
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toBe("ok")
	})

	// ── GET /api/sessions/:id/conversation ─────────────────────────

	test("GET /api/sessions/:id/conversation returns conversation entries", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/conversation`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBeGreaterThan(0)
		expect(body.pagination).toBeDefined()
		expect(body.pagination.total).toBeGreaterThan(0)
		// Verify entries have type field
		body.data.forEach((entry: { type: string }) => {
			expect(["user_prompt", "thinking", "tool_call", "tool_result", "backtrack", "phase_boundary"]).toContain(entry.type)
		})
	})

	test("GET /api/sessions/:id/conversation supports pagination", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/conversation?offset=0&limit=2`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBeLessThanOrEqual(2)
		expect(body.pagination.limit).toBe(2)
	})

	test("GET /api/sessions/:id/conversation returns 202 when not distilled", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}/conversation`)
		expect(res.status).toBe(202)
		const body = await res.json()
		expect(body.code).toBe("NOT_DISTILLED")
	})

	test("GET /api/sessions/:id/conversation returns 404 for unknown session", async () => {
		const res = await req("/api/sessions/00000000-0000-0000-0000-000000000000/conversation")
		expect(res.status).toBe(404)
	})

	test("GET /api/sessions/:id/conversation rejects invalid offset", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/conversation?offset=-1`)
		expect(res.status).toBe(400)
	})

	// ── GET /api/sessions/:id/agents/:agentId/conversation ─────────

	test("GET agent conversation returns entries from agent events", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/agents/${AGENT_ID}/conversation`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBeGreaterThan(0)
		expect(body.pagination.total).toBeGreaterThan(0)
	})

	test("GET agent conversation returns 404 for unknown agent", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/agents/99999999-0000-0000-0000-000000000000/conversation`)
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body.code).toBe("NOT_FOUND")
	})

	test("GET agent conversation returns 202 when parent not distilled", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}/agents/${AGENT_ID}/conversation`)
		expect(res.status).toBe(202)
	})

	// ── GET /api/sessions/:id/diff/:filePath ───────────────────────

	test("GET /api/sessions/:id/diff/:filePath returns unified diff", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/diff/src/app.ts`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.file_path).toBe("src/app.ts")
		expect(body.data.unified_diff).toContain("--- a/src/app.ts")
		expect(body.data.unified_diff).toContain("+++ b/src/app.ts")
		expect(body.data.unified_diff).toContain("-const y = 2")
		expect(body.data.unified_diff).toContain("+const y = 3")
		expect(body.data.total_additions).toBe(1)
		expect(body.data.total_deletions).toBe(1)
	})

	test("GET /api/sessions/:id/diff/:filePath returns 404 for unknown file", async () => {
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/diff/src/nonexistent.ts`)
		expect(res.status).toBe(404)
	})

	test("GET /api/sessions/:id/diff/:filePath returns 202 when not distilled", async () => {
		const res = await req(`/api/sessions/${SESSION_ID}/diff/src/app.ts`)
		expect(res.status).toBe(202)
	})

	test("GET /api/sessions/:id/diff handles nested paths", async () => {
		// The wildcard route should capture nested paths like src/deep/nested/file.ts
		const res = await req(`/api/sessions/${DISTILLED_SESSION_ID}/diff/src/deep/nested/file.ts`)
		expect(res.status).toBe(404) // File doesn't exist in fixture, but path parsing should work
		const body = await res.json()
		expect(body.code).toBe("NOT_FOUND")
	})
})

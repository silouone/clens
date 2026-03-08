import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { startServer } from "../../src/server/index"
import type { ServerHandle } from "../../src/server/index"

const TEST_DIR = "/tmp/clens-integration-test"
const SESSION_ID = "aabbccdd-1122-3344-5566-778899aabbcc"

const makeEvent = (event: string, t: number, data: Record<string, unknown> = {}) =>
	JSON.stringify({ event, t, sid: SESSION_ID, data, context: { git_branch: "main" } })

describe("Integration: Full server lifecycle", () => {
	let handle: ServerHandle

	beforeAll(() => {
		// Create test fixture with sessions and distilled data
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true })
		mkdirSync(`${TEST_DIR}/.clens/distilled`, { recursive: true })

		const events = [
			makeEvent("SessionStart", 1000, { source: "cli" }),
			makeEvent("PreToolUse", 1200, { tool_name: "Read", tool_use_id: "tu_001", tool_input: { file_path: "src/app.ts" } }),
			makeEvent("PostToolUse", 1400, { tool_name: "Read", tool_use_id: "tu_001" }),
			makeEvent("PreToolUse", 1600, { tool_name: "Edit", tool_use_id: "tu_002", tool_input: { file_path: "src/app.ts" } }),
			makeEvent("PostToolUse", 1800, { tool_name: "Edit", tool_use_id: "tu_002" }),
			makeEvent("Stop", 2000, { reason: "user" }),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${SESSION_ID}.jsonl`, events.join("\n") + "\n")

		writeFileSync(
			`${TEST_DIR}/.clens/distilled/${SESSION_ID}.json`,
			JSON.stringify({
				session_id: SESSION_ID,
				stats: { total_events: 6, duration_ms: 1000, events_by_type: {}, tools_by_name: {}, tool_call_count: 2, failure_count: 0, failure_rate: 0, unique_files: ["src/app.ts"] },
				backtracks: [],
				decisions: [],
				file_map: { files: [{ file_path: "src/app.ts", reads: 1, edits: 1, writes: 0, errors: 0, tool_use_ids: ["tu_001", "tu_002"] }] },
				git_diff: { commits: [], hunks: [] },
				edit_chains: {
					chains: [],
					diff_attribution: [{
						file_path: "src/app.ts",
						lines: [{ type: "context", content: "const x = 1" }, { type: "remove", content: "old" }, { type: "add", content: "new" }],
						total_additions: 1,
						total_deletions: 1,
					}],
				},
				reasoning: [{ t: 1100, thinking: "Need to read the file", intent_hint: "planning" }],
				user_messages: [{ t: 1000, content: "Fix the bug", message_type: "prompt", is_tool_result: false }],
				summary: { phases: [{ name: "build", start_t: 1000, end_t: 2000 }] },
				complete: true,
			}),
		)

		handle = startServer({ projectDir: TEST_DIR, port: 0 })
	})

	afterAll(() => {
		handle.stop()
		rmSync(TEST_DIR, { recursive: true, force: true })
	})

	const authFetch = (path: string, init?: RequestInit) =>
		fetch(`${handle.url}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${handle.token}`,
				...(init?.headers ?? {}),
			},
		})

	// ── Server startup ─────────────────────────────────────────────

	test("server starts on dynamic port", () => {
		expect(handle.port).toBeGreaterThan(0)
		expect(handle.url).toContain("127.0.0.1")
		expect(handle.token.length).toBe(64) // 32 bytes hex
	})

	// ── Health ─────────────────────────────────────────────────────

	test("GET /health is accessible without auth", async () => {
		const res = await fetch(`${handle.url}/health`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toBe("ok")
		expect(typeof body.ts).toBe("number")
	})

	// ── Auth (dev mode skips enforcement) ──────────────────────────

	test("dev mode allows unauthenticated requests", async () => {
		const res = await fetch(`${handle.url}/api/sessions`)
		expect(res.status).toBe(200)
	})

	test("API accepts Bearer token (still works even in dev)", async () => {
		const res = await authFetch("/api/sessions")
		expect(res.status).toBe(200)
	})

	// ── Session list with real files ───────────────────────────────

	test("GET /api/sessions returns real session data", async () => {
		const res = await authFetch("/api/sessions")
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBeGreaterThanOrEqual(1)
		expect(body.pagination.total).toBeGreaterThanOrEqual(1)

		const session = body.data.find((s: { session_id: string }) => s.session_id === SESSION_ID)
		expect(session).toBeDefined()
		expect(session.status).toBe("complete")
		expect(session.event_count).toBe(6)
	})

	// ── Session detail with distilled data ─────────────────────────

	test("GET /api/sessions/:id returns distilled data", async () => {
		const res = await authFetch(`/api/sessions/${SESSION_ID}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.session_id).toBe(SESSION_ID)
		expect(body.data.stats.tool_call_count).toBe(2)
		expect(body.data.complete).toBe(true)
	})

	// ── Events with real session data ──────────────────────────────

	test("GET /api/sessions/:id/events returns all events", async () => {
		const res = await authFetch(`/api/sessions/${SESSION_ID}/events`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBe(6)
		expect(body.data[0].event).toBe("SessionStart")
		expect(body.data[5].event).toBe("Stop")
		expect(body.pagination.total).toBe(6)
	})

	test("GET /api/sessions/:id/events pagination works end-to-end", async () => {
		const res = await authFetch(`/api/sessions/${SESSION_ID}/events?offset=2&limit=2`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBe(2)
		expect(body.data[0].event).toBe("PostToolUse")
		expect(body.pagination.has_next).toBe(true)
	})

	// ── Conversation endpoint ──────────────────────────────────────

	test("GET /api/sessions/:id/conversation returns conversation timeline", async () => {
		const res = await authFetch(`/api/sessions/${SESSION_ID}/conversation`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.length).toBeGreaterThan(0)

		const types = new Set(body.data.map((e: { type: string }) => e.type))
		expect(types.has("user_prompt") || types.has("tool_call") || types.has("thinking")).toBe(true)
	})

	// ── Diff endpoint ──────────────────────────────────────────────

	test("GET /api/sessions/:id/diff/:filePath returns unified diff", async () => {
		const res = await authFetch(`/api/sessions/${SESSION_ID}/diff/src/app.ts`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.data.file_path).toBe("src/app.ts")
		expect(body.data.unified_diff).toContain("--- a/src/app.ts")
		expect(body.data.unified_diff).toContain("+++ b/src/app.ts")
	})

	// ── Session ID validation ──────────────────────────────────────

	test("rejects non-UUID session IDs end-to-end", async () => {
		const res = await authFetch("/api/sessions/not-valid")
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.code).toBe("INVALID_SESSION_ID")
	})

	// ── 404 for non-existent sessions ──────────────────────────────

	test("returns 404 for non-existent session", async () => {
		const res = await authFetch("/api/sessions/00000000-0000-0000-0000-000000000000")
		expect(res.status).toBe(404)
	})

	// ── SSE stream ─────────────────────────────────────────────────

	test("SSE stream delivers events end-to-end", async () => {
		const controller = new AbortController()

		const res = await authFetch("/api/events/stream", {
			signal: controller.signal,
		})
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toContain("text/event-stream")

		const reader = res.body!.getReader()
		const decoder = new TextDecoder()
		const { value } = await reader.read()
		const text = decoder.decode(value)

		// Should receive "connected" event
		expect(text).toContain("event: connected")

		controller.abort()
		reader.releaseLock()
	})

	// ── Distill trigger ────────────────────────────────────────────

	test("POST distill trigger returns started", async () => {
		const res = await authFetch(`/api/commands/sessions/${SESSION_ID}/distill`, {
			method: "POST",
		})
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.status).toBe("started")
	})
})

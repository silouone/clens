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
		// Last event is a Stop at an ancient timestamp — under bug B6 this is NOT
		// "complete" (only SessionEnd is) and is well past the active window → idle.
		expect(session.status).toBe("idle")
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

	// ── Staleness metadata (bug B5) ────────────────────────────────

	test("GET /api/sessions/:id includes non-stale staleness when distill covers all events", async () => {
		const res = await authFetch(`/api/sessions/${SESSION_ID}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.staleness).toBeDefined()
		// Raw file has 6 events; the distill covered total_events=6 → not stale.
		expect(body.staleness.raw_event_count).toBe(6)
		expect(body.staleness.distill_stale).toBe(false)
		expect(typeof body.staleness.distilled_at).toBe("number")
		expect(body.staleness.distilled_at).toBeGreaterThan(0)
	})

	test("GET /api/sessions/:id reports distill_stale when raw file outgrew the distill (bug B5)", async () => {
		// A distinct session whose distill only covered the first 2 of 4 events.
		const staleId = "ffeeddcc-9988-7766-5544-332211ffeedd"
		const staleEvents = [
			makeEvent("SessionStart", 1000, { source: "cli" }),
			makeEvent("PreToolUse", 1200, { tool_name: "Read", tool_use_id: "s1" }),
			makeEvent("PreToolUse", 1400, { tool_name: "Edit", tool_use_id: "s2" }),
			makeEvent("PreToolUse", 1600, { tool_name: "Bash", tool_use_id: "s3" }),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${staleId}.jsonl`, staleEvents.join("\n") + "\n")
		writeFileSync(
			`${TEST_DIR}/.clens/distilled/${staleId}.json`,
			JSON.stringify({
				session_id: staleId,
				stats: { total_events: 2, duration_ms: 200, events_by_type: {}, tools_by_name: {}, tool_call_count: 1, failure_count: 0, failure_rate: 0, unique_files: [] },
				backtracks: [],
				decisions: [],
				file_map: { files: [] },
				git_diff: { commits: [], hunks: [] },
				reasoning: [],
				user_messages: [],
				complete: false,
			}),
		)

		const res = await authFetch(`/api/sessions/${staleId}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.staleness).toBeDefined()
		expect(body.staleness.raw_event_count).toBe(4)
		expect(body.staleness.distill_stale).toBe(true)
	})

	test("GET /api/sessions/:id excludes a torn final line from staleness so it does not flip distill_stale (NUM-22)", async () => {
		// A live write left a non-empty, unparseable trailing line. It must not be
		// counted as a real event: the distill covered all 4 complete events, so the
		// session stays current instead of spuriously flipping to distill_stale.
		const tornId = "ccbbaadd-9988-7766-5544-332211ccbbaa"
		const tornEvents = [
			makeEvent("SessionStart", 1000, { source: "cli" }),
			makeEvent("PreToolUse", 1200, { tool_name: "Read", tool_use_id: "t1" }),
			makeEvent("PreToolUse", 1400, { tool_name: "Edit", tool_use_id: "t2" }),
			makeEvent("PreToolUse", 1600, { tool_name: "Bash", tool_use_id: "t3" }),
		]
		// 4 well-formed events + one torn (partial JSON) trailing line, no final newline.
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/${tornId}.jsonl`,
			tornEvents.join("\n") + "\n" + '{"event":"PreToolUse","t":1800,',
		)
		writeFileSync(
			`${TEST_DIR}/.clens/distilled/${tornId}.json`,
			JSON.stringify({
				session_id: tornId,
				stats: { total_events: 4, duration_ms: 600, events_by_type: {}, tools_by_name: {}, tool_call_count: 3, failure_count: 0, failure_rate: 0, unique_files: [] },
				backtracks: [],
				decisions: [],
				file_map: { files: [] },
				git_diff: { commits: [], hunks: [] },
				reasoning: [],
				user_messages: [],
				complete: false,
			}),
		)

		const res = await authFetch(`/api/sessions/${tornId}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.staleness).toBeDefined()
		// Torn trailing line excluded → 4, not 5; matches the distill's coverage.
		expect(body.staleness.raw_event_count).toBe(4)
		expect(body.staleness.distill_stale).toBe(false)
	})

	test("GET /api/sessions/:id reports tier_stale when the distill was priced under a different explicit tier", async () => {
		const tierId = "aabbccdd-1122-3344-5566-77889900aabb"
		const tierEvents = [
			makeEvent("SessionStart", 1000, { source: "cli" }),
			makeEvent("SessionEnd", 2000, {}),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${tierId}.jsonl`, tierEvents.join("\n") + "\n")
		writeFileSync(
			`${TEST_DIR}/.clens/distilled/${tierId}.json`,
			JSON.stringify({
				session_id: tierId,
				stats: {
					total_events: 2, duration_ms: 1000, events_by_type: {}, tools_by_name: {},
					tool_call_count: 0, failure_count: 0, failure_rate: 0, unique_files: [],
					cost_estimate: { model: "claude-fable-5", estimated_input_tokens: 1, estimated_output_tokens: 1, estimated_cost_usd: 0.01, is_estimated: false, pricing_tier: "api" },
				},
				backtracks: [], decisions: [], file_map: { files: [] },
				git_diff: { commits: [], hunks: [] }, reasoning: [], user_messages: [],
				complete: true,
			}),
		)
		// Explicit config tier differs from the tier the distill was priced under
		writeFileSync(`${TEST_DIR}/.clens/config.json`, JSON.stringify({ capture: true, pricing: "max" }))

		const res = await authFetch(`/api/sessions/${tierId}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.staleness).toBeDefined()
		expect(body.staleness.tier_stale).toBe(true)
		// Event coverage itself is current — only the tier is stale
		expect(body.staleness.distill_stale).toBe(false)

		rmSync(`${TEST_DIR}/.clens/config.json`, { force: true })
	})

	test("GET /api/sessions/:id does NOT report tier_stale when the distill's tier matches the explicit config tier", async () => {
		// Boundary companion to the mismatch case: when the tier a distill is read
		// under equals the user's current explicit setting, costs are current and
		// tier_stale must stay false (no spurious re-analyze prompt). readDistilled
		// re-prices estimated (non-measured) costs to the "api" tier for display, so
		// the comparison tier here is "api" — pin that equality stays non-stale.
		const matchId = "bbccddee-2233-4455-6677-8899aabbccdd"
		const matchEvents = [
			makeEvent("SessionStart", 1000, { source: "cli" }),
			makeEvent("SessionEnd", 2000, {}),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${matchId}.jsonl`, matchEvents.join("\n") + "\n")
		writeFileSync(
			`${TEST_DIR}/.clens/distilled/${matchId}.json`,
			JSON.stringify({
				session_id: matchId,
				stats: {
					total_events: 2, duration_ms: 1000, events_by_type: {}, tools_by_name: {},
					tool_call_count: 0, failure_count: 0, failure_rate: 0, unique_files: [],
					cost_estimate: { model: "claude-fable-5", estimated_input_tokens: 1, estimated_output_tokens: 1, estimated_cost_usd: 0.01, is_estimated: false, pricing_tier: "api" },
				},
				backtracks: [], decisions: [], file_map: { files: [] },
				git_diff: { commits: [], hunks: [] }, reasoning: [], user_messages: [],
				complete: true,
			}),
		)
		// Explicit config tier equals the (re-priced) tier the distill is read under
		writeFileSync(`${TEST_DIR}/.clens/config.json`, JSON.stringify({ capture: true, pricing: "api" }))

		const res = await authFetch(`/api/sessions/${matchId}`)
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.staleness).toBeDefined()
		expect(body.staleness.tier_stale).toBe(false)
		expect(body.staleness.distill_stale).toBe(false)

		rmSync(`${TEST_DIR}/.clens/config.json`, { force: true })
	})

	// ── Live status thresholds (bug B6) ────────────────────────────

	test("a session whose last event is recent lists as active (bug B6)", async () => {
		const liveId = "11112222-3333-4444-5555-666677778888"
		const now = Date.now()
		const liveEvents = [
			JSON.stringify({ event: "SessionStart", t: now - 120_000, sid: liveId, data: { source: "cli" }, context: { git_branch: "main" } }),
			JSON.stringify({ event: "PreToolUse", t: now - 30_000, sid: liveId, data: { tool_name: "Read" }, context: { git_branch: "main" } }),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${liveId}.jsonl`, liveEvents.join("\n") + "\n")

		const res = await authFetch("/api/sessions")
		expect(res.status).toBe(200)
		const body = await res.json()
		const session = body.data.find((s: { session_id: string }) => s.session_id === liveId)
		expect(session).toBeDefined()
		expect(session.status).toBe("active")
		expect(session.end_time).toBeUndefined()
	})

	test("status filter 'incomplete' returns active + idle but not complete (backward compat)", async () => {
		const res = await authFetch("/api/sessions?status=incomplete&limit=5000")
		expect(res.status).toBe(200)
		const body = await res.json()
		const statuses = new Set(body.data.map((s: { status: string }) => s.status))
		expect(statuses.has("complete")).toBe(false)
	})

	// ── agent_count parity (bug B15) ───────────────────────────────

	test("agent_count from deduplicated spawn links matches the CLI rule (bug B15)", async () => {
		const parentId = "aaaa1111-bbbb-2222-cccc-3333dddd4444"
		const parentEvents = [
			JSON.stringify({ event: "SessionStart", t: 1000, sid: parentId, data: { source: "cli" }, context: { git_branch: "main" } }),
			JSON.stringify({ event: "SessionEnd", t: 9000, sid: parentId, data: {}, context: { git_branch: "main" } }),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/${parentId}.jsonl`, parentEvents.join("\n") + "\n")
		// child-a spawned twice (resume) + child-b once → 2 distinct agents.
		const links = [
			JSON.stringify({ t: 2000, type: "spawn", parent_session: parentId, agent_id: "child-a", agent_type: "builder" }),
			JSON.stringify({ t: 2500, type: "spawn", parent_session: parentId, agent_id: "child-a", agent_type: "builder" }),
			JSON.stringify({ t: 3000, type: "spawn", parent_session: parentId, agent_id: "child-b", agent_type: "builder" }),
		]
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, links.join("\n") + "\n")

		const res = await authFetch("/api/sessions?limit=5000")
		expect(res.status).toBe(200)
		const body = await res.json()
		const session = body.data.find((s: { session_id: string }) => s.session_id === parentId)
		expect(session).toBeDefined()
		expect(session.agent_count).toBe(2)
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

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../../src/server/app";

// Integration coverage for PATCH /api/sessions/:id/meta (session-naming-flags
// phase 2): set/clear label, set/clear color, and invalid-color rejection. Also
// asserts the listing merges the sidecar so display_name resolves by precedence.

const TEST_TOKEN = "test-token-meta";
const TEST_DIR = "/tmp/clens-api-meta-test";
const SESSION_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const SIDECAR = `${TEST_DIR}/.clens/session-meta.json`;

const makeEvent = (
	event: string,
	t: number,
	data: Record<string, unknown> = {},
	sid: string = SESSION_ID,
) => JSON.stringify({ event, t, sid, data, context: {} });

const authHeaders = { Authorization: `Bearer ${TEST_TOKEN}` };

describe("PATCH /api/sessions/:id/meta", () => {
	let app: ReturnType<typeof createApp>;

	beforeEach(() => {
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
		// A session whose first user prompt drives the computed display name (R2/R3).
		const events = [
			makeEvent("SessionStart", 1000, { source: "cli" }),
			makeEvent("UserPromptSubmit", 1100, {
				prompt: "/prime explore the auth module and fix the bug",
			}),
			makeEvent("Stop", 2000, { reason: "done" }),
		];
		writeFileSync(`${TEST_DIR}/.clens/sessions/${SESSION_ID}.jsonl`, events.join("\n") + "\n");
		app = createApp({ token: TEST_TOKEN, mode: "development", projectDir: TEST_DIR });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	const req = (path: string, init?: RequestInit) =>
		app.request(path, { headers: authHeaders, ...init });

	const patchMeta = (id: string, body: unknown) =>
		req(`/api/sessions/${id}/meta`, {
			method: "PATCH",
			headers: { ...authHeaders, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

	const readSidecar = (): Record<string, { label?: string; color?: string }> =>
		existsSync(SIDECAR) ? JSON.parse(readFileSync(SIDECAR, "utf-8")) : {};

	// ── Computed name (no sidecar) — listing resolves by precedence ──

	test("listing resolves a computed display_name from the first prompt", async () => {
		const res = await req("/api/sessions");
		expect(res.status).toBe(200);
		const body = await res.json();
		const row = body.data.find((s: { session_id: string }) => s.session_id === SESSION_ID);
		expect(row).toBeDefined();
		// Slash command text is kept (R3); harness noise stripped; truncated ≤60.
		expect(row.display_name).toContain("/prime");
		expect(row.name_source).toBe("computed");
		expect(row.label).toBeUndefined();
		expect(row.color).toBeUndefined();
	});

	// ── Set label ──

	test("sets a label and returns the resolved row (R6)", async () => {
		const res = await patchMeta(SESSION_ID, { label: "My Auth Session" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.session_id).toBe(SESSION_ID);
		expect(body.data.label).toBe("My Auth Session");
		expect(body.data.display_name).toBe("My Auth Session");
		expect(body.data.name_source).toBe("label");
		// Persisted to the sidecar.
		expect(readSidecar()[SESSION_ID]?.label).toBe("My Auth Session");
	});

	// ── Clear label (null + whitespace) ──

	test("clears a label with null, reverting to the computed name (R7)", async () => {
		await patchMeta(SESSION_ID, { label: "Temp" });
		const res = await patchMeta(SESSION_ID, { label: null });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.label).toBeUndefined();
		expect(body.data.name_source).toBe("computed");
		expect(readSidecar()[SESSION_ID]).toBeUndefined();
	});

	test("treats a whitespace-only label as a clear (R8)", async () => {
		await patchMeta(SESSION_ID, { label: "Temp" });
		const res = await patchMeta(SESSION_ID, { label: "   " });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.label).toBeUndefined();
		expect(body.data.name_source).toBe("computed");
	});

	// ── Set / clear color ──

	test("sets a color flag and returns it (R10)", async () => {
		const res = await patchMeta(SESSION_ID, { color: "amber" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.color).toBe("amber");
		expect(readSidecar()[SESSION_ID]?.color).toBe("amber");
	});

	test("clears a color with 'none', removing the flag (R13)", async () => {
		await patchMeta(SESSION_ID, { color: "green" });
		const res = await patchMeta(SESSION_ID, { color: "none" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.color).toBeUndefined();
		expect(readSidecar()[SESSION_ID]?.color).toBeUndefined();
	});

	test("clears a color with null (R13)", async () => {
		await patchMeta(SESSION_ID, { color: "blue" });
		const res = await patchMeta(SESSION_ID, { color: null });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.color).toBeUndefined();
	});

	// ── label + color in one patch ──

	test("sets label and color together", async () => {
		const res = await patchMeta(SESSION_ID, { label: "Pinned", color: "violet" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.label).toBe("Pinned");
		expect(body.data.color).toBe("violet");
		expect(body.data.display_name).toBe("Pinned");
	});

	// ── Invalid color rejected, state unchanged (R14) ──

	test("rejects an out-of-palette color with 400 and leaves state unchanged (R14)", async () => {
		// Seed a known good state first.
		await patchMeta(SESSION_ID, { label: "Keep", color: "red" });
		const res = await patchMeta(SESSION_ID, { color: "rainbow" });
		expect(res.status).toBe(400);
		// Prior metadata untouched.
		const after = readSidecar()[SESSION_ID];
		expect(after?.label).toBe("Keep");
		expect(after?.color).toBe("red");
	});

	test("rejects a non-string label with 400", async () => {
		const res = await patchMeta(SESSION_ID, { label: 42 });
		expect(res.status).toBe(400);
	});

	// ── Validation reuse: bad session id → existing 400 from middleware ──

	test("rejects a malformed session id with 400 (validateSessionId)", async () => {
		const res = await patchMeta("not-a-uuid", { label: "x" });
		expect(res.status).toBe(400);
	});

	// ── Unknown (well-formed) session id → 404 ──

	test("returns 404 for a well-formed but unknown session id", async () => {
		const res = await patchMeta("00000000-0000-0000-0000-000000000000", { label: "x" });
		expect(res.status).toBe(404);
	});
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../../src/server/app";

// Regression test for bug B1 (specs/revive/bug-register.md): event_count was
// ESTIMATED from the first 16KB for larger files and shipped to the UI as
// exact (e.g. 714 real events reported as 2120). Counts must be exact for any
// file size, and the cache must invalidate when the file grows.

const TEST_TOKEN = "test-token-count";
const TEST_DIR = "/tmp/clens-event-count-test";
const BIG_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const NOEOL_ID = "bbbbbbbb-1111-2222-3333-444444444444";

// Long padding makes early lines short relative to later ones, which is the
// exact shape that skewed the old head-sample estimator.
const makeEvent = (event: string, t: number, sid: string, pad = 0) =>
	JSON.stringify({ event, t, sid, data: { note: "x".repeat(pad) } });

const BIG_LINES = 137;

describe("exact event counts (B1 regression)", () => {
	let app: ReturnType<typeof createApp>;

	beforeAll(() => {
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });

		const lines = [
			makeEvent("SessionStart", 1000, BIG_ID),
			...Array.from({ length: BIG_LINES - 2 }, (_, i) =>
				makeEvent("PreToolUse", 1000 + i, BIG_ID, 400 + (i % 7) * 350),
			),
			makeEvent("SessionEnd", 99_000, BIG_ID),
		];
		const content = `${lines.join("\n")}\n`;
		expect(content.length).toBeGreaterThan(16_384); // must exceed the head-chunk size
		writeFileSync(`${TEST_DIR}/.clens/sessions/${BIG_ID}.jsonl`, content);

		// Small file whose final line has no trailing newline
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/${NOEOL_ID}.jsonl`,
			[makeEvent("SessionStart", 1, NOEOL_ID), makeEvent("Stop", 2, NOEOL_ID)].join("\n"),
		);

		app = createApp({ token: TEST_TOKEN, mode: "development", projectDir: TEST_DIR });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	const req = (path: string) =>
		app.request(path, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });

	const findSession = async (id: string) => {
		const res = await req("/api/sessions?limit=100");
		expect(res.status).toBe(200);
		const body = await res.json();
		return body.data.find((s: { session_id: string }) => s.session_id === id);
	};

	test("event_count is exact for files larger than the head chunk", async () => {
		const session = await findSession(BIG_ID);
		expect(session).toBeDefined();
		expect(session.event_count).toBe(BIG_LINES);
	});

	test("event_count matches the /events pagination total", async () => {
		const session = await findSession(BIG_ID);
		const res = await req(`/api/sessions/${BIG_ID}/events?offset=0&limit=1000`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(session.event_count).toBe(body.pagination.total);
	});

	test("count cache invalidates when the file grows (live session)", async () => {
		const before = await findSession(BIG_ID);
		expect(before.event_count).toBe(BIG_LINES);
		appendFileSync(
			`${TEST_DIR}/.clens/sessions/${BIG_ID}.jsonl`,
			`${makeEvent("UserPromptSubmit", 100_000, BIG_ID)}\n`,
		);
		const after = await findSession(BIG_ID);
		expect(after.event_count).toBe(BIG_LINES + 1);
	});

	test("unterminated final line is still counted", async () => {
		const session = await findSession(NOEOL_ID);
		expect(session).toBeDefined();
		expect(session.event_count).toBe(2);
	});
});

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { distill } from "../src/distill";
import { listSessions } from "../src/session";
import type { StoredEvent } from "../src/types";

// Regression tests for the duration-semantics bugs (specs/revive/bug-register.md):
//  B3 — active duration double-subtracted idle gaps (>5min pause → "Active 0s")
//  B2 — list duration_ms must be the wall-clock span, matching the web API
//  B9 — cost_estimate must be mirrored at the top level of the distilled JSON

const TEST_DIR = `/tmp/clens-test-duration-semantics-${Date.now()}`;
const SESSION_ID = "session-pause";

const PAUSE_MS = 40 * 60 * 1000; // one 40-minute pause (> 5min threshold)

// Timeline: 4 min of work (events ≤ 2min apart, below the 5-min idle
// threshold), a 40-min pause, then 4 more minutes of work.
const MINUTE = 60_000;
const T0 = 1_000_000;
const WORK_1_END = T0 + 4 * MINUTE;
const WORK_2_START = WORK_1_END + PAUSE_MS;
const T_END = WORK_2_START + 4 * MINUTE;
const WALL_MS = T_END - T0;

const makeEvents = (): readonly StoredEvent[] => [
	{ t: T0, event: "SessionStart", sid: SESSION_ID, data: {} },
	{
		t: T0 + 2 * MINUTE,
		event: "PreToolUse",
		sid: SESSION_ID,
		data: { tool_name: "Read", tool_use_id: "t1", tool_input: { file_path: "/src/a.ts" } },
	},
	{
		t: T0 + 3 * MINUTE,
		event: "PostToolUse",
		sid: SESSION_ID,
		data: { tool_name: "Read", tool_use_id: "t1" },
	},
	{ t: WORK_1_END, event: "Stop", sid: SESSION_ID, data: {} },
	// -- 40 minute pause --
	{ t: WORK_2_START, event: "UserPromptSubmit", sid: SESSION_ID, data: { prompt: "continue" } },
	{
		t: WORK_2_START + 2 * MINUTE,
		event: "PreToolUse",
		sid: SESSION_ID,
		data: {
			tool_name: "Edit",
			tool_use_id: "t2",
			tool_input: { file_path: "/src/a.ts" },
			usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
			model: "claude-opus-4-6",
		},
	},
	{
		t: WORK_2_START + 3 * MINUTE,
		event: "PostToolUse",
		sid: SESSION_ID,
		data: { tool_name: "Edit", tool_use_id: "t2" },
	},
	{ t: T_END, event: "SessionEnd", sid: SESSION_ID, data: {} },
];

describe("duration semantics (B2/B3/B9 regressions)", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/${SESSION_ID}.jsonl`,
			makeEvents()
				.map((e) => JSON.stringify(e))
				.join("\n") + "\n",
		);
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("stats carry both wall and idle-trimmed durations", async () => {
		const result = await distill(SESSION_ID, TEST_DIR);
		expect(result.stats.wall_duration_ms).toBe(WALL_MS);
		expect(result.stats.duration_ms).toBe(WALL_MS - PAUSE_MS);
	});

	test("active duration is not zeroed by a long pause (B3)", async () => {
		const result = await distill(SESSION_ID, TEST_DIR);
		const active = result.summary?.key_metrics.active_duration_ms;
		expect(active).toBeDefined();
		// Active = wall - pause gap; before the fix the pause was subtracted from
		// the already-trimmed duration, clamping active to 0.
		expect(active).toBeGreaterThan(0);
		expect(active).toBe(WALL_MS - PAUSE_MS);
	});

	test("CLI list duration_ms is the wall-clock span (B2)", () => {
		const sessions = listSessions(TEST_DIR);
		const row = sessions.find((s) => s.session_id === SESSION_ID);
		expect(row).toBeDefined();
		expect(row?.duration_ms).toBe(WALL_MS);
	});

	test("cost_estimate is mirrored at the top level of the distilled JSON (B9)", async () => {
		const result = await distill(SESSION_ID, TEST_DIR);
		expect(result.stats.cost_estimate).toBeDefined();
		expect(result.cost_estimate).toBeDefined();
		expect(result.cost_estimate?.estimated_cost_usd).toBe(
			result.stats.cost_estimate?.estimated_cost_usd ?? Number.NaN,
		);
	});
});

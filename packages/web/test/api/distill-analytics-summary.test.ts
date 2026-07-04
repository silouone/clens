import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../../src/server/app";

// Regression for bug web-distill-skips-analytics-summary:
// The POST /distill route wrote distilled/{id}.json but never refreshed the
// analytics summary row, so the dashboard's analytics never reflected sessions
// distilled from the web UI (only the CLI distill wrote the summary). The route
// must now call writeAnalyticsSummary like the CLI does.

const TEST_DIR = "/tmp/clens-distill-analytics-test";
const SESSION_ID = "abababab-cdcd-efef-0101-232345456767";

const makeEvent = (event: string, t: number, data: Record<string, unknown> = {}) =>
	JSON.stringify({ event, t, sid: SESSION_ID, data, context: {} });

const SUMMARY_PATH = `${TEST_DIR}/.clens/analytics-summary.jsonl`;

/** Poll until a predicate holds or a timeout elapses (fire-and-forget distill). */
const waitFor = async (pred: () => boolean, timeoutMs = 5000, stepMs = 50): Promise<boolean> => {
	const deadline = Date.now() + timeoutMs;
	const tick = async (): Promise<boolean> => {
		if (pred()) return true;
		if (Date.now() > deadline) return false;
		await new Promise((r) => setTimeout(r, stepMs));
		return tick();
	};
	return tick();
};

describe("POST distill refreshes the analytics summary (web-distill-skips-analytics-summary)", () => {
	let app: ReturnType<typeof createApp>;

	beforeAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
		mkdirSync(`${TEST_DIR}/.clens/distilled`, { recursive: true });

		writeFileSync(
			`${TEST_DIR}/.clens/sessions/${SESSION_ID}.jsonl`,
			[
				makeEvent("SessionStart", 1000, { source: "cli" }),
				makeEvent("PreToolUse", 1500, {
					tool_name: "Read",
					tool_use_id: "tu_1",
					tool_input: { file_path: "src/x.ts" },
				}),
				makeEvent("PostToolUse", 1600, { tool_name: "Read", tool_use_id: "tu_1" }),
				makeEvent("Stop", 2000, { reason: "done" }),
			].join("\n") + "\n",
		);

		app = createApp({ token: "test-token", mode: "development", projectDir: TEST_DIR });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("writes an analytics-summary.jsonl row for the distilled session", async () => {
		// No summary before distill.
		expect(existsSync(SUMMARY_PATH)).toBe(false);

		const res = await app.request(`/api/commands/sessions/${SESSION_ID}/distill`, {
			method: "POST",
			headers: { Authorization: "Bearer test-token" },
		});
		expect(res.status).toBe(200);
		expect((await res.json()).status).toBe("started");

		// Fire-and-forget — wait for the summary file to appear with our session row.
		const ok = await waitFor(() => {
			if (!existsSync(SUMMARY_PATH)) return false;
			return readFileSync(SUMMARY_PATH, "utf-8").includes(`"session_id":"${SESSION_ID}"`);
		});
		expect(ok).toBe(true);

		// The row is a valid analytics summary row carrying this session's id.
		const rows = readFileSync(SUMMARY_PATH, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as { session_id: string });
		expect(rows.some((r) => r.session_id === SESSION_ID)).toBe(true);
	});
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../../src/server/app";

// End-to-end coverage for analytics-truth-and-brush (tasks 1.4/1.7):
//  - UsageTotals carries value_usd / paid_usd / roi / measured_cost_usd / measured_fraction
//  - plan is read from project config server-side (AC4/AC5/AC6)
//  - from/to query params scope the current window (and previous = preceding span) (AC7)
//  - cache_hit_rate is null (n/a) when no fresh input was captured (AC9)

const TEST_DIR = "/tmp/clens-analytics-truth-test";
const SESSIONS_DIR = `${TEST_DIR}/.clens/sessions`;
const DISTILLED_DIR = `${TEST_DIR}/.clens/distilled`;

const localDay = (ms: number): string => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
};

const noonDaysAgo = (daysAgo: number): number => {
	const now = new Date();
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - daysAgo,
		12,
		0,
		0,
		0,
	).getTime();
};

type DistillOpts = {
	readonly startMs: number;
	readonly costUsd: number;
	readonly inputTokens?: number;
	readonly cacheReadTokens?: number;
};

const writeSession = (id: string, opts: DistillOpts): void => {
	writeFileSync(
		`${SESSIONS_DIR}/${id}.jsonl`,
		[
			JSON.stringify({
				event: "SessionStart",
				t: opts.startMs,
				sid: id,
				data: { source: "cli" },
				context: {},
			}),
			JSON.stringify({
				event: "Stop",
				t: opts.startMs + 1000,
				sid: id,
				data: { reason: "done" },
				context: {},
			}),
		].join("\n") + "\n",
	);
	writeFileSync(
		`${DISTILLED_DIR}/${id}.json`,
		JSON.stringify({
			session_id: id,
			start_time: opts.startMs,
			stats: {
				total_events: 2,
				duration_ms: 1000,
				events_by_type: {},
				tools_by_name: {},
				tool_call_count: 0,
				failure_count: 0,
				failure_rate: 0,
				unique_files: [],
				token_usage: {
					input_tokens: opts.inputTokens ?? 0,
					output_tokens: 0,
					cache_read_tokens: opts.cacheReadTokens ?? 0,
					cache_creation_tokens: 0,
				},
				cost_estimate: {
					model: "claude-fable-5",
					estimated_input_tokens: opts.inputTokens ?? 0,
					estimated_output_tokens: 0,
					estimated_cost_usd: opts.costUsd,
					is_estimated: false,
				},
			},
			backtracks: [],
			decisions: [],
			file_map: { files: [] },
			git_diff: { commits: [], hunks: [] },
			edit_chains: { chains: [] },
			reasoning: [],
			user_messages: [],
			complete: true,
		}),
	);
};

const CUR_A = "aaaaaaaa-1111-1111-1111-111111111111";
const CUR_B = "bbbbbbbb-1111-1111-1111-111111111111";
const PREV = "cccccccc-1111-1111-1111-111111111111";

describe("analytics truth — paid/value/roi + window + cache guard", () => {
	let app: ReturnType<typeof createApp>;

	beforeAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(SESSIONS_DIR, { recursive: true });
		mkdirSync(DISTILLED_DIR, { recursive: true });
		mkdirSync(`${TEST_DIR}/.clens`, { recursive: true });

		// Project is on Max 20× ($200/mo).
		writeFileSync(
			`${TEST_DIR}/.clens/config.json`,
			JSON.stringify({ capture: true, plan: "max20x" }),
		);

		// Two sessions in the current custom window, one in the previous span.
		writeSession(CUR_A, {
			startMs: noonDaysAgo(2),
			costUsd: 100,
			inputTokens: 1000,
			cacheReadTokens: 3000,
		});
		writeSession(CUR_B, {
			startMs: noonDaysAgo(1),
			costUsd: 50,
			inputTokens: 0,
			cacheReadTokens: 5000,
		});
		writeSession(PREV, {
			startMs: noonDaysAgo(9),
			costUsd: 999,
			inputTokens: 10,
			cacheReadTokens: 10,
		});

		app = createApp({ token: "test", mode: "development", projectDir: TEST_DIR });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	const getUsage = async (query: string) => {
		const res = await app.request(`/api/analytics/usage?${query}`);
		expect(res.status).toBe(200);
		return (await res.json()).data;
	};

	test("AC4: totals expose value_usd / paid_usd / roi / measured_fraction", async () => {
		const data = await getUsage("range=30d");
		expect(typeof data.totals.value_usd).toBe("number");
		expect(typeof data.totals.paid_usd).toBe("number");
		expect(typeof data.totals.roi).toBe("number");
		expect(typeof data.totals.measured_cost_usd).toBe("number");
		expect(typeof data.totals.measured_fraction).toBe("number");
		// Back-compat: cost_usd retained and equal to value_usd.
		expect(data.totals.cost_usd).toBeCloseTo(data.totals.value_usd);
	});

	test("AC7: custom from/to scopes current to [from..to] and previous to the preceding equal span", async () => {
		// 2-day current window covering the two recent sessions; the day-(-9) session is
		// outside both the current and the immediately-preceding 2-day span.
		const from = localDay(noonDaysAgo(2));
		const to = localDay(noonDaysAgo(1));
		const data = await getUsage(`range=30d&from=${from}&to=${to}`);
		expect(data.totals.sessions).toBe(2);
		expect(data.totals.value_usd).toBeCloseTo(150); // 100 + 50
		// previous span = [from-2 .. from-1] → no sessions there
		expect(data.previous_totals.sessions).toBe(0);
		// population.total re-scopes to the custom window too.
		expect(data.population.total).toBe(2);
	});

	test("AC5/AC4: paid_usd for max20x scales with the window day-span; roi = value / paid", async () => {
		const from = localDay(noonDaysAgo(2));
		const to = localDay(noonDaysAgo(1));
		const data = await getUsage(`range=30d&from=${from}&to=${to}`);
		// 2-day inclusive window → paid = 200 * (2/30) ≈ 13.33
		expect(data.totals.paid_usd).toBeCloseTo(200 * (2 / 30));
		expect(data.totals.roi).toBeCloseTo(150 / (200 * (2 / 30)));
	});

	test("AC9: aggregate cache_hit_rate is a real share, not a 100% artifact", async () => {
		const from = localDay(noonDaysAgo(2));
		const to = localDay(noonDaysAgo(1));
		const data = await getUsage(`range=30d&from=${from}&to=${to}`);
		// Combined input = 1000, cache_read = 8000 → 8000 / 9000 ≈ 0.888 (not 1.0).
		expect(data.totals.cache_hit_rate).toBeCloseTo(8000 / 9000);
		expect(data.totals.cache_hit_rate).toBeLessThan(1);
	});

	test("AC9: a day whose only session has zero fresh input reports cache_hit_rate = null (n/a)", async () => {
		// Single-day window over CUR_B: input 0, cache_read 5000 → must be null, not 1.0.
		const day = localDay(noonDaysAgo(1));
		const data = await getUsage(`range=30d&from=${day}&to=${day}`);
		expect(data.totals.sessions).toBe(1);
		expect(data.totals.cache_hit_rate).toBeNull();
	});
});

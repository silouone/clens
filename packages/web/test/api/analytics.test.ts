import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createApp } from "../../src/server/app";

// Regression tests for the analytics pipeline (specs/revive/bug-register.md):
//  - B10: usage/insights responses expose population {analyzed,total}; deltas vs an
//         empty previous window are suppressed; sessions_with_cost drives cost display.
//  - B11: tool_errors carry real per-tool calls + failure_rate (not a permanent 0).
//  - B18: day bucketing is LOCAL; the current window is exactly N days vs N previous.
//  - B19: avg_edit_chain_length is the real mean chain length (links per chain).

const TEST_DIR = "/tmp/clens-analytics-api-test";
const SESSIONS_DIR = `${TEST_DIR}/.clens/sessions`;
const DISTILLED_DIR = `${TEST_DIR}/.clens/distilled`;

// Local-day key for a timestamp, mirroring the server's bucketing (B18).
const localDay = (ms: number): string => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
};

// A timestamp at local noon `daysAgo` days before today — safely inside one local day.
const noonDaysAgo = (daysAgo: number): number => {
	const now = new Date();
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12, 0, 0, 0);
	return d.getTime();
};

const writeRawSession = (id: string, startMs: number): void => {
	const lines = [
		JSON.stringify({
			event: "SessionStart",
			t: startMs,
			sid: id,
			data: { source: "cli" },
			context: {},
		}),
		JSON.stringify({
			event: "Stop",
			t: startMs + 1000,
			sid: id,
			data: { reason: "done" },
			context: {},
		}),
	];
	writeFileSync(`${SESSIONS_DIR}/${id}.jsonl`, `${lines.join("\n")}\n`);
};

type DistillOpts = {
	readonly startMs: number;
	readonly costUsd?: number;
	readonly toolsByName?: Record<string, number>;
	readonly failuresByTool?: Record<string, number>;
	readonly chainEdits?: readonly number[];
};

const writeDistilled = (id: string, opts: DistillOpts): void => {
	const chains = (opts.chainEdits ?? []).map((n) => ({
		file_path: "src/x.ts",
		steps: [],
		total_edits: n,
		total_failures: 0,
		total_reads: 0,
		effort_ms: 0,
		has_backtrack: false,
		surviving_edit_ids: [],
		abandoned_edit_ids: [],
	}));
	const toolCount = Object.values(opts.toolsByName ?? {}).reduce((s, n) => s + n, 0);
	const failCount = Object.values(opts.failuresByTool ?? {}).reduce((s, n) => s + n, 0);
	writeFileSync(
		`${DISTILLED_DIR}/${id}.json`,
		JSON.stringify({
			session_id: id,
			start_time: opts.startMs,
			stats: {
				total_events: 10,
				duration_ms: 5000,
				events_by_type: {},
				tools_by_name: opts.toolsByName ?? {},
				tool_call_count: toolCount,
				failure_count: failCount,
				failure_rate: toolCount > 0 ? failCount / toolCount : 0,
				unique_files: [],
				failures_by_tool: opts.failuresByTool ?? {},
				cost_estimate:
					opts.costUsd !== undefined
						? {
								model: "claude-fable-5",
								estimated_input_tokens: 100,
								estimated_output_tokens: 50,
								estimated_cost_usd: opts.costUsd,
								is_estimated: false,
							}
						: undefined,
			},
			backtracks: [],
			decisions: [],
			file_map: { files: [] },
			git_diff: { commits: [], hunks: [] },
			edit_chains: { chains },
			reasoning: [],
			user_messages: [],
			complete: true,
		}),
	);
};

const RAW_ONLY_ID = "00000000-0000-0000-0000-00000000raw1";
const COST_ID = "11111111-1111-1111-1111-111111111111";
const TOOLS_ID = "22222222-2222-2222-2222-222222222222";

describe("analytics API", () => {
	let app: ReturnType<typeof createApp>;

	beforeAll(() => {
		mkdirSync(SESSIONS_DIR, { recursive: true });
		mkdirSync(DISTILLED_DIR, { recursive: true });

		// Distilled session in the current 7d window with cost + tools + chains.
		const tStart = noonDaysAgo(1);
		writeRawSession(COST_ID, tStart);
		writeDistilled(COST_ID, {
			startMs: tStart,
			costUsd: 4.2,
			toolsByName: { Bash: 10, Read: 6, Edit: 4 },
			failuresByTool: { Bash: 2, Read: 1 },
			chainEdits: [18, 5, 2, 1], // mean = 26/4 = 6.5
		});

		// A second distilled session in the current window (no cost) — tools accumulate.
		const tStart2 = noonDaysAgo(2);
		writeRawSession(TOOLS_ID, tStart2);
		writeDistilled(TOOLS_ID, {
			startMs: tStart2,
			toolsByName: { Bash: 5 },
			failuresByTool: { Bash: 1 },
			chainEdits: [3, 1], // mean for this session = 2, combined mean = (26+4)/(4+2)=5
		});

		// A RAW-only session in the current window (not distilled) — must count toward
		// population.total but NOT toward analyzed metrics (B10).
		writeRawSession(RAW_ONLY_ID, noonDaysAgo(3));

		app = createApp({ token: "test", mode: "development", projectDir: TEST_DIR });
	});

	afterAll(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	const getJson = async (path: string) => {
		const res = await app.request(path);
		expect(res.status).toBe(200);
		const body = await res.json();
		return body.data;
	};

	test("B10: usage response exposes population (analyzed < total when raw-only sessions exist)", async () => {
		const data = await getJson("/api/analytics/usage?range=7d");
		expect(data.population).toBeDefined();
		// 2 distilled in window, 3 raw sessions in window.
		expect(data.population.analyzed).toBe(2);
		expect(data.population.total).toBe(3);
		expect(data.population.analyzed).toBeLessThan(data.population.total);
	});

	test("B10: insights response exposes population too", async () => {
		const data = await getJson("/api/analytics/insights?range=7d");
		expect(data.population).toBeDefined();
		expect(data.population.analyzed).toBe(2);
		expect(data.population.total).toBe(3);
	});

	test("B10: sessions_with_cost reflects only priced sessions", async () => {
		const data = await getJson("/api/analytics/usage?range=7d");
		expect(data.totals.sessions).toBe(2);
		expect(data.totals.sessions_with_cost).toBe(1);
		expect(data.totals.cost_usd).toBeCloseTo(4.2);
	});

	test("B10: previous window is empty here, so the previous totals carry no sessions", async () => {
		const data = await getJson("/api/analytics/usage?range=7d");
		// No sessions in the prior 7-day window — the UI uses this to suppress deltas.
		expect(data.previous_totals.sessions).toBe(0);
	});

	test("B11: tool_errors carry real calls and failure_rate", async () => {
		const data = await getJson("/api/analytics/insights?range=7d");
		const bash = data.tool_errors.find((t: { tool_name: string }) => t.tool_name === "Bash");
		expect(bash).toBeDefined();
		// Bash called 10 + 5 = 15 times, failed 2 + 1 = 3 times → rate 0.2.
		expect(bash.total_calls).toBe(15);
		expect(bash.total_failures).toBe(3);
		expect(bash.failure_rate).toBeCloseTo(0.2);
		expect(bash.failure_rate).toBeGreaterThan(0);
	});

	test("B19: avg_edit_chain_length is the real mean (links per chain), not chains per session", async () => {
		const data = await getJson("/api/analytics/insights?range=7d");
		// Combined: 6 chains, 30 total edits → mean 5.0. The old code returned
		// chains/session (≈3), which is what we must NOT see.
		const totalAvg = data.daily.reduce(
			(acc: number, d: { avg_edit_chain_length: number }) => Math.max(acc, d.avg_edit_chain_length),
			0,
		);
		// Per-day means: day(-1) = 6.5, day(-2) = 2.0. The larger must be 6.5, never a
		// chain-count artifact like 4.
		expect(totalAvg).toBeCloseTo(6.5);
	});

	test("B18: 7d window is exactly 7 local days (boundary session at day -6 is in, day -7 is out)", async () => {
		// Fresh dir to control the window precisely.
		const dir = "/tmp/clens-analytics-window-test";
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(`${dir}/.clens/sessions`, { recursive: true });
		mkdirSync(`${dir}/.clens/distilled`, { recursive: true });

		const localApp = createApp({ token: "test", mode: "development", projectDir: dir });

		const writeBoth = (id: string, daysAgo: number) => {
			const ms = noonDaysAgo(daysAgo);
			writeFileSync(
				`${dir}/.clens/sessions/${id}.jsonl`,
				`${[
					JSON.stringify({
						event: "SessionStart",
						t: ms,
						sid: id,
						data: { source: "cli" },
						context: {},
					}),
					JSON.stringify({
						event: "Stop",
						t: ms + 1000,
						sid: id,
						data: { reason: "done" },
						context: {},
					}),
				].join("\n")}\n`,
			);
			writeFileSync(
				`${dir}/.clens/distilled/${id}.json`,
				JSON.stringify({
					session_id: id,
					start_time: ms,
					stats: {
						total_events: 1,
						duration_ms: 1,
						events_by_type: {},
						tools_by_name: {},
						tool_call_count: 0,
						failure_count: 0,
						failure_rate: 0,
						unique_files: [],
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

		writeBoth("aaaaaaaa-0000-0000-0000-00000000in06", 6); // last day inside a 7-day window
		writeBoth("bbbbbbbb-0000-0000-0000-00000000out7", 7); // first day of the previous window
		writeBoth("cccccccc-0000-0000-0000-00000000in00", 0); // today

		const res = await localApp.request("/api/analytics/usage?range=7d");
		const body = await res.json();
		const data = body.data;

		const dates = data.daily.map((d: { date: string }) => d.date);
		expect(dates).toContain(localDay(noonDaysAgo(6)));
		expect(dates).toContain(localDay(noonDaysAgo(0)));
		expect(dates).not.toContain(localDay(noonDaysAgo(7)));
		// Current window holds exactly the day0 + day6 sessions = 2.
		expect(data.totals.sessions).toBe(2);
		// The day -7 session lands in the previous window, not the current one.
		expect(data.previous_totals.sessions).toBe(1);

		rmSync(dir, { recursive: true, force: true });
	});
});

// ── Global analytics: unknown project filter must not fall back to wrong data ──
//
// Bug global-analytics-unknown-project-falls-back-to-wrong-data: effectiveDirsFor
// returned [fallbackDir] when a ?project= id matched no registered project, serving
// the unfiltered/wrong project's analytics instead of an empty result.

describe("global analytics — unknown project filter", () => {
	const ROOT = "/tmp/clens-analytics-global-test";
	const PROJ_A = `${ROOT}/project-alpha`;
	const PROJ_B = `${ROOT}/project-beta`;
	const A_ID = "aaaa1111-1111-1111-1111-111111111111";

	let app: ReturnType<typeof createApp>;

	beforeAll(() => {
		rmSync(ROOT, { recursive: true, force: true });
		for (const dir of [PROJ_A, PROJ_B]) {
			mkdirSync(`${dir}/.clens/sessions`, { recursive: true });
			mkdirSync(`${dir}/.clens/distilled`, { recursive: true });
		}

		const ts = noonDaysAgo(1);
		// One priced, distilled session ONLY in project-alpha.
		writeFileSync(
			`${PROJ_A}/.clens/sessions/${A_ID}.jsonl`,
			`${[
				JSON.stringify({
					event: "SessionStart",
					t: ts,
					sid: A_ID,
					data: { source: "cli" },
					context: {},
				}),
				JSON.stringify({
					event: "Stop",
					t: ts + 1000,
					sid: A_ID,
					data: { reason: "done" },
					context: {},
				}),
			].join("\n")}\n`,
		);
		writeFileSync(
			`${PROJ_A}/.clens/distilled/${A_ID}.json`,
			JSON.stringify({
				session_id: A_ID,
				start_time: ts,
				stats: {
					total_events: 2,
					duration_ms: 1000,
					events_by_type: {},
					tools_by_name: {},
					tool_call_count: 0,
					failure_count: 0,
					failure_rate: 0,
					unique_files: [],
					cost_estimate: {
						model: "claude-fable-5",
						estimated_input_tokens: 100,
						estimated_output_tokens: 50,
						estimated_cost_usd: 9.99,
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

		const projects = [
			{ id: "project-alpha", path: PROJ_A, name: "project-alpha", added_at: Date.now() },
			{ id: "project-beta", path: PROJ_B, name: "project-beta", added_at: Date.now() },
		];
		app = createApp({ token: "test", mode: "development", projectDir: PROJ_A, projects });
	});

	afterAll(() => {
		rmSync(ROOT, { recursive: true, force: true });
	});

	test("known project filter returns that project's data", async () => {
		const res = await app.request("/api/analytics/usage?range=7d&project=project-alpha");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.totals.sessions).toBe(1);
		expect(data.totals.cost_usd).toBeCloseTo(9.99);
	});

	test("unknown project filter returns EMPTY analytics, not fallback data", async () => {
		const res = await app.request("/api/analytics/usage?range=7d&project=does-not-exist");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		// No registered project matched → no rows. Must NOT leak project-alpha's data.
		expect(data.totals.sessions).toBe(0);
		expect(data.totals.cost_usd).toBe(0);
	});

	test("unknown project filter on insights is also empty", async () => {
		const res = await app.request("/api/analytics/insights?range=7d&project=nope");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.population.total).toBe(0);
	});
});

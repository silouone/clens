import { describe, expect, test } from "bun:test";
import type { AnalyticsSummaryRow } from "clens";
import {
	cacheHitRate,
	computeDerivedTotals,
	parseCustomWindow,
	splitByCustomWindow,
	windowDaySpan,
} from "../../src/server/routes/analytics";
import { PLAN_MONTHLY_USD } from "../../src/shared/types";

// Unit coverage for the analytics-truth-and-brush math (tasks 1.4/1.7):
//  - paid/roi/measured_fraction derivation (AC4, AC5)
//  - custom-window current/previous split (AC7)
//  - cache-hit n/a guard (AC9)

// ── Row factory ────────────────────────────────────────────────────
//
// A summary row carrying just the fields the math under test reads. `cost_basis`
// is appended onto the row object (the field is owned + written by the distill
// layer, F1); the server reader tolerates it being absent on legacy rows.

type RowOpts = {
	readonly date?: string;
	readonly cost_usd?: number;
	readonly cost_basis?: "measured" | "estimated" | "heuristic";
	readonly input_tokens?: number;
	readonly cache_read_tokens?: number;
};

const makeRow = (opts: RowOpts = {}): AnalyticsSummaryRow => {
	const base = {
		session_id: `s-${opts.date ?? "x"}-${opts.cost_usd ?? 0}-${Math.random()}`,
		date: opts.date ?? "2026-06-15",
		duration_ms: 1000,
		cost_usd: opts.cost_usd ?? 0,
		input_tokens: opts.input_tokens ?? 0,
		output_tokens: 0,
		cache_read_tokens: opts.cache_read_tokens ?? 0,
		cache_creation_tokens: 0,
		is_estimated: opts.cost_basis !== "measured",
		tool_call_count: 0,
		failure_count: 0,
		failures_by_tool: {},
		agent_count: 0,
		agent_types: [],
		backtrack_count: 0,
		backtracks_by_type: {},
		backtrack_files: [],
		reasoning_by_intent: {},
		edit_chain_count: 0,
		abandoned_edits: 0,
		surviving_edits: 0,
		decision_types: {},
		top_errors: [],
	};
	// cost_basis is read structurally by the route (F1 owns the field on the type).
	return (opts.cost_basis ? { ...base, cost_basis: opts.cost_basis } : base) as AnalyticsSummaryRow;
};

// ── Derived totals: paid / roi / measured_fraction ─────────────────

describe("computeDerivedTotals (AC4/AC5)", () => {
	test("paid scales with window day-span at the plan's monthly rate (max20x)", () => {
		// Max 20× = $200/mo. A 30-day window pays exactly one month.
		const d = computeDerivedTotals(3092, 0, "max20x", 30);
		expect(d.paid_usd).toBeCloseTo(200);
		expect(d.value_usd).toBe(3092);
		expect(d.roi).toBeCloseTo(3092 / 200); // ≈ 15.46×
	});

	test("paid pro-rates a 90-day window (3 months)", () => {
		const d = computeDerivedTotals(600, 0, "max20x", 90);
		expect(d.paid_usd).toBeCloseTo(200 * (90 / 30)); // $600
		expect(d.roi).toBeCloseTo(1); // value == paid here
	});

	test("pro plan uses $20/mo", () => {
		const d = computeDerivedTotals(100, 0, "pro", 30);
		expect(d.paid_usd).toBeCloseTo(PLAN_MONTHLY_USD.pro);
		expect(d.roi).toBeCloseTo(5);
	});

	test("api plan: paid == value and roi == 1 (AC5)", () => {
		const d = computeDerivedTotals(412, 0, "api", 7);
		expect(d.paid_usd).toBe(412);
		expect(d.roi).toBe(1);
	});

	test("non-api plan with zero paid (0-day window) → roi 0, not NaN/Infinity", () => {
		const d = computeDerivedTotals(500, 0, "max20x", 0);
		expect(d.paid_usd).toBe(0);
		expect(d.roi).toBe(0);
	});

	test("measured_fraction = measured / value, 0 when value is 0", () => {
		expect(computeDerivedTotals(1000, 510, "max20x", 30).measured_fraction).toBeCloseTo(0.51);
		expect(computeDerivedTotals(0, 0, "max20x", 30).measured_fraction).toBe(0);
	});

	test("measured_cost_usd is passed through verbatim", () => {
		expect(computeDerivedTotals(1000, 510, "max20x", 30).measured_cost_usd).toBe(510);
	});
});

// ── Cache-hit n/a guard ────────────────────────────────────────────

describe("cacheHitRate (AC9)", () => {
	test("returns null when there is no fresh input (would falsely read 100%)", () => {
		// input == 0 but heavy cache reads: the old formula gave cache/(0+cache) = 1.0.
		expect(cacheHitRate(0, 50_000)).toBeNull();
	});

	test("returns null when both input and cache are zero", () => {
		expect(cacheHitRate(0, 0)).toBeNull();
	});

	test("computes the real share when fresh input exists", () => {
		// cache_read / (input + cache_read) = 75 / 100 = 0.75
		expect(cacheHitRate(25, 75)).toBeCloseTo(0.75);
	});

	test("never reads 100% purely because input ≈ 0 — a tiny input yields ~1 honestly", () => {
		const r = cacheHitRate(1, 999);
		expect(r).not.toBeNull();
		expect(r).toBeLessThan(1);
	});
});

// ── Custom window parsing + day span ───────────────────────────────

describe("parseCustomWindow", () => {
	test("returns a normalized window for valid from/to", () => {
		expect(parseCustomWindow("2026-06-01", "2026-06-07")).toEqual({
			from: "2026-06-01",
			to: "2026-06-07",
		});
	});

	test("orders a reversed (right-to-left drag) selection", () => {
		expect(parseCustomWindow("2026-06-07", "2026-06-01")).toEqual({
			from: "2026-06-01",
			to: "2026-06-07",
		});
	});

	test("rejects missing or malformed dates", () => {
		expect(parseCustomWindow(undefined, "2026-06-07")).toBeUndefined();
		expect(parseCustomWindow("2026-06-01", undefined)).toBeUndefined();
		expect(parseCustomWindow("not-a-date", "2026-06-07")).toBeUndefined();
		expect(parseCustomWindow("2026-6-1", "2026-06-07")).toBeUndefined();
	});
});

describe("windowDaySpan", () => {
	test("is inclusive: a single day spans 1, a week spans 7", () => {
		expect(windowDaySpan({ from: "2026-06-15", to: "2026-06-15" })).toBe(1);
		expect(windowDaySpan({ from: "2026-06-01", to: "2026-06-07" })).toBe(7);
	});

	test("spans across a month boundary correctly", () => {
		// May 30, 31, Jun 1, 2, 3 = 5 days
		expect(windowDaySpan({ from: "2026-05-30", to: "2026-06-03" })).toBe(5);
	});
});

// ── Custom-window current/previous split ───────────────────────────

describe("splitByCustomWindow (AC7)", () => {
	const rows: readonly AnalyticsSummaryRow[] = [
		makeRow({ date: "2026-05-25", cost_usd: 1 }), // before previous window
		makeRow({ date: "2026-05-28", cost_usd: 2 }), // previous window [05-28..06-03]
		makeRow({ date: "2026-06-03", cost_usd: 3 }), // previous window (last day)
		makeRow({ date: "2026-06-04", cost_usd: 4 }), // current window [06-04..06-10] (first day)
		makeRow({ date: "2026-06-07", cost_usd: 5 }), // current window
		makeRow({ date: "2026-06-10", cost_usd: 6 }), // current window (last day)
		makeRow({ date: "2026-06-11", cost_usd: 7 }), // after current window
	];

	const window = { from: "2026-06-04", to: "2026-06-10" }; // 7-day span

	test("current = rows inside [from..to] inclusive", () => {
		const { current } = splitByCustomWindow(rows, window);
		expect(current.map((r) => r.date)).toEqual(["2026-06-04", "2026-06-07", "2026-06-10"]);
	});

	test("previous = the immediately preceding equal-length span [from-D .. from-1]", () => {
		// span = 7 → previous = [05-28 .. 06-03]
		const { previous } = splitByCustomWindow(rows, window);
		expect(previous.map((r) => r.date)).toEqual(["2026-05-28", "2026-06-03"]);
	});

	test("rows outside both windows are excluded from current and previous", () => {
		const { current, previous } = splitByCustomWindow(rows, window);
		const all = [...current, ...previous].map((r) => r.date);
		expect(all).not.toContain("2026-05-25");
		expect(all).not.toContain("2026-06-11");
	});

	test("a single-day window has a single-day previous window", () => {
		const single = { from: "2026-06-07", to: "2026-06-07" };
		const { current, previous } = splitByCustomWindow(rows, single);
		expect(current.map((r) => r.date)).toEqual(["2026-06-07"]);
		// span 1 → previous = [06-06 .. 06-06] → no rows on that day
		expect(previous).toHaveLength(0);
	});
});

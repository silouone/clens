import { describe, expect, test } from "bun:test";
import { toSummaryRow } from "../src/distill/analytics-summary";
import { extractStats } from "../src/distill/stats";
import type { CostEstimate, DistilledSession, StoredEvent } from "../src/types";

// Cost-truth tiers (specs/analytics-truth-and-brush): the per-session cost is ALWAYS the
// API-equivalent value at full list price, tagged with how it was derived:
//   Tier 0 measured   — verbatim total_cost_usd/costUSD (>0) captured on an event.
//   Tier 1/2 estimated — real token counts × API price table.
//   Tier 3 heuristic   — event/tool-call magic numbers (no real tokens).
// On-disk coverage of measured cost is ~0% today (transcripts carry only token `usage`),
// so the measured tier is forward-looking: these tests pin the resolution contract.

const sessionContext = {
	project_dir: "/test",
	cwd: "/test",
	git_branch: null,
	git_remote: null,
	git_commit: null,
	git_worktree: null,
	team_name: null,
	task_list_dir: null,
	claude_entrypoint: null,
	model: "claude-opus-4-8-20260101",
	agent_type: null,
} as const;

const makeEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

const usageEvent = (
	t: number,
	usage: Readonly<Record<string, number>>,
): StoredEvent =>
	makeEvent({
		t,
		event: "PostToolUse",
		data: { tool_name: "Read", tool_use_id: `u${t}`, usage },
	});

describe("extractStats — cost_basis resolution tiers", () => {
	test("Tier 3: heuristic when a known model has no real tokens", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read", tool_use_id: "t1" } }),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const ce = extractStats(events).cost_estimate;
		expect(ce?.cost_basis).toBe("heuristic");
		expect(ce?.is_estimated).toBe(true);
		expect(ce?.estimated_cost_usd).toBeGreaterThan(0);
	});

	test("Tier 2: estimated when real hook token usage is present", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			usageEvent(2000, {
				input_tokens: 1000,
				output_tokens: 500,
				cache_read_tokens: 200,
				cache_creation_tokens: 100,
			}),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const ce = extractStats(events).cost_estimate;
		expect(ce?.cost_basis).toBe("estimated");
		expect(ce?.is_estimated).toBe(false);
		expect(ce?.estimated_input_tokens).toBe(1000);
	});

	test("Tier 1: estimated when transcript token usage is supplied", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({ t: 2000, event: "SessionEnd", data: {} }),
		];
		const transcriptUsage = {
			input_tokens: 4000,
			output_tokens: 2000,
			cache_read_tokens: 0,
			cache_creation_tokens: 0,
		};

		const ce = extractStats(events, [], transcriptUsage).cost_estimate;
		expect(ce?.cost_basis).toBe("estimated");
		expect(ce?.is_estimated).toBe(false);
		expect(ce?.estimated_input_tokens).toBe(4000);
	});

	test("Tier 0: measured when an event carries total_cost_usd (>0), used verbatim", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			// Real tokens present too — but measured cost takes priority and is used verbatim.
			usageEvent(2000, { input_tokens: 1000, output_tokens: 500 }),
			makeEvent({ t: 3000, event: "Stop", data: { total_cost_usd: 12.5 } }),
			makeEvent({ t: 4000, event: "SessionEnd", data: {} }),
		];

		const ce = extractStats(events).cost_estimate;
		expect(ce?.cost_basis).toBe("measured");
		expect(ce?.is_estimated).toBe(false);
		expect(ce?.estimated_cost_usd).toBe(12.5); // verbatim, not rounded away or repriced
	});

	test("Tier 0: measured also reads the camelCase costUSD field", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({ t: 2000, event: "Stop", data: { costUSD: 3.33 } }),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const ce = extractStats(events).cost_estimate;
		expect(ce?.cost_basis).toBe("measured");
		expect(ce?.estimated_cost_usd).toBe(3.33);
	});

	test("a zero/negative measured cost is ignored — falls through to a token/heuristic tier", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({ t: 2000, event: "Stop", data: { total_cost_usd: 0 } }),
			usageEvent(2500, { input_tokens: 500, output_tokens: 250 }),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const ce = extractStats(events).cost_estimate;
		expect(ce?.cost_basis).toBe("estimated");
		expect(ce?.estimated_cost_usd).toBeGreaterThan(0);
	});

	test("measured picks the largest captured value (cumulative session total, not a delta)", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({ t: 2000, event: "PostToolUse", data: { tool_name: "Read", tool_use_id: "t1", total_cost_usd: 1.0 } }),
			makeEvent({ t: 3000, event: "PostToolUse", data: { tool_name: "Edit", tool_use_id: "t2", total_cost_usd: 4.0 } }),
			makeEvent({ t: 4000, event: "SessionEnd", data: {} }),
		];

		const ce = extractStats(events).cost_estimate;
		expect(ce?.cost_basis).toBe("measured");
		expect(ce?.estimated_cost_usd).toBe(4.0);
	});
});

describe("extractStats — stored cost is full list price (no subscription multiplier)", () => {
	const buildTokenEvents = (): StoredEvent[] => [
		makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
		usageEvent(2000, { input_tokens: 1_000_000, output_tokens: 0 }),
		makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
	];

	test("the 'max' tier does NOT change the stored API-equivalent cost", () => {
		const apiCost = extractStats(buildTokenEvents(), [], undefined, "api").cost_estimate?.estimated_cost_usd;
		const maxCost = extractStats(buildTokenEvents(), [], undefined, "max").cost_estimate?.estimated_cost_usd;
		expect(apiCost).toBeGreaterThan(0);
		expect(maxCost).toBe(apiCost);
	});

	test("opus-4-8 input @ $5/MTok — 1M input tokens ⇒ $5 at full list price", () => {
		const ce = extractStats(buildTokenEvents(), [], undefined, "max").cost_estimate;
		expect(ce?.estimated_cost_usd).toBeCloseTo(5, 4);
	});

	test("the resolved tier is still recorded on pricing_tier for staleness detection", () => {
		const ce = extractStats(buildTokenEvents(), [], undefined, "max").cost_estimate;
		expect(ce?.pricing_tier).toBe("max");
	});
});

const makeCostEstimate = (overrides: Partial<CostEstimate> = {}): CostEstimate => ({
	model: "claude-opus-4-8-20260101",
	estimated_input_tokens: 1000,
	estimated_output_tokens: 500,
	estimated_cost_usd: 7.5,
	is_estimated: false,
	cost_basis: "estimated",
	...overrides,
});

const makeDistilled = (ce: CostEstimate | undefined): DistilledSession => ({
	session_id: "s1",
	start_time: Date.parse("2026-06-15T12:00:00Z"),
	stats: {
		total_events: 4,
		duration_ms: 1000,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 2,
		failure_count: 0,
		failure_rate: 0,
		unique_files: [],
		model: ce?.model,
		cost_estimate: ce,
	},
	backtracks: [],
	decisions: [],
	file_map: { files: [] },
	git_diff: { commits: [], hunks: [] },
	reasoning: [],
	user_messages: [],
	complete: true,
});

describe("toSummaryRow — cost_basis + measured_cost_usd", () => {
	test("carries cost_basis through to the row", () => {
		const row = toSummaryRow(makeDistilled(makeCostEstimate({ cost_basis: "estimated" })));
		expect(row.cost_basis).toBe("estimated");
	});

	test("measured_cost_usd equals cost_usd only when cost_basis === 'measured'", () => {
		const measured = toSummaryRow(
			makeDistilled(makeCostEstimate({ cost_basis: "measured", estimated_cost_usd: 9.99 })),
		);
		expect(measured.cost_basis).toBe("measured");
		expect(measured.cost_usd).toBe(9.99);
		expect(measured.measured_cost_usd).toBe(9.99);
	});

	test("measured_cost_usd is 0 for estimated rows", () => {
		const row = toSummaryRow(makeDistilled(makeCostEstimate({ cost_basis: "estimated", estimated_cost_usd: 4.2 })));
		expect(row.cost_usd).toBe(4.2);
		expect(row.measured_cost_usd).toBe(0);
	});

	test("measured_cost_usd is 0 for heuristic rows", () => {
		const row = toSummaryRow(
			makeDistilled(makeCostEstimate({ cost_basis: "heuristic", is_estimated: true, estimated_cost_usd: 1.1 })),
		);
		expect(row.cost_basis).toBe("heuristic");
		expect(row.measured_cost_usd).toBe(0);
	});

	test("back-compat: untagged estimate with is_estimated=false ⇒ estimated (token-grounded, NOT measured)", () => {
		// Rows distilled before the cost-truth work lack cost_basis. `is_estimated=false`
		// historically meant token-grounded ("estimated") — the measured tier did not
		// exist yet, so an untagged row can never be "measured". Mapping it to measured
		// would inflate measured_cost_usd / measured_fraction and under-report the
		// "X% estimated" badge; measured_cost_usd must therefore stay 0.
		const row = toSummaryRow(
			makeDistilled(makeCostEstimate({ cost_basis: undefined, is_estimated: false, estimated_cost_usd: 6.0 })),
		);
		expect(row.cost_basis).toBe("estimated");
		expect(row.cost_usd).toBe(6.0);
		expect(row.measured_cost_usd).toBe(0);
	});

	test("back-compat: untagged estimate with is_estimated=true ⇒ heuristic", () => {
		const row = toSummaryRow(
			makeDistilled(makeCostEstimate({ cost_basis: undefined, is_estimated: true, estimated_cost_usd: 2.0 })),
		);
		expect(row.cost_basis).toBe("heuristic");
		expect(row.measured_cost_usd).toBe(0);
	});

	test("no cost estimate ⇒ heuristic basis, zero cost", () => {
		const row = toSummaryRow(makeDistilled(undefined));
		expect(row.cost_basis).toBe("heuristic");
		expect(row.cost_usd).toBe(0);
		expect(row.measured_cost_usd).toBe(0);
	});
});

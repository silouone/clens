import { describe, test, expect } from "bun:test";
import { toSummaryRow, localDayKey } from "../src/distill/analytics-summary";
import type { DistilledSession, EditChain } from "../src/types";

// Regression tests for the analytics summary extractor (specs/revive/bug-register.md):
//  - B11: per-tool calls must be carried (tools_by_name) so the route can compute
//         real tool failure rates instead of a permanent 0.
//  - B18: day bucketing must use the LOCAL calendar day, not UTC.
//  - B19: edit_chain_links must carry the total edits across chains so the route can
//         compute the real mean chain length (links per chain), not chains-per-session.

const makeDistilled = (overrides: Partial<DistilledSession> = {}): DistilledSession => ({
	session_id: "test-session",
	start_time: Date.parse("2026-03-15T12:00:00Z"),
	stats: {
		total_events: 10,
		duration_ms: 5000,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 5,
		failure_count: 0,
		failure_rate: 0,
		unique_files: [],
	},
	backtracks: [],
	decisions: [],
	file_map: { files: [] },
	git_diff: { commits: [], hunks: [] },
	reasoning: [],
	user_messages: [],
	complete: true,
	...overrides,
});

const makeChain = (totalEdits: number, overrides: Partial<EditChain> = {}): EditChain => ({
	file_path: "src/x.ts",
	steps: [],
	total_edits: totalEdits,
	total_failures: 0,
	total_reads: 0,
	effort_ms: 0,
	has_backtrack: false,
	surviving_edit_ids: [],
	abandoned_edit_ids: [],
	...overrides,
});

describe("localDayKey (B18 local-day bucketing)", () => {
	test("buckets by local calendar day, not UTC day", () => {
		// 2026-03-15T12:00:00Z is well inside the same day for every common offset.
		const ms = Date.parse("2026-03-15T12:00:00Z");
		const d = new Date(ms);
		const expected = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
		expect(localDayKey(ms)).toBe(expected);
	});

	test("uses the machine's local components (matches Date getters)", () => {
		const ms = Date.parse("2026-12-31T23:30:00Z");
		const d = new Date(ms);
		const expected = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
		expect(localDayKey(ms)).toBe(expected);
	});
});

describe("toSummaryRow", () => {
	test("B18: row.date is the local day of start_time", () => {
		const start = Date.parse("2026-03-15T08:00:00Z");
		const row = toSummaryRow(makeDistilled({ start_time: start }));
		expect(row.date).toBe(localDayKey(start));
	});

	test("B11: carries tools_by_name (per-tool call counts) from stats", () => {
		const row = toSummaryRow(
			makeDistilled({
				stats: {
					total_events: 20,
					duration_ms: 1000,
					events_by_type: {},
					tools_by_name: { Bash: 10, Read: 7, Edit: 3 },
					tool_call_count: 20,
					failure_count: 2,
					failure_rate: 0.1,
					unique_files: [],
					failures_by_tool: { Bash: 2 },
				},
			}),
		);
		expect(row.tools_by_name).toEqual({ Bash: 10, Read: 7, Edit: 3 });
		expect(row.failures_by_tool).toEqual({ Bash: 2 });
	});

	test("B11: tools_by_name defaults to {} when stats omit it", () => {
		const row = toSummaryRow(makeDistilled());
		expect(row.tools_by_name).toEqual({});
	});

	test("B19: edit_chain_links sums total_edits across chains (not chain count)", () => {
		const row = toSummaryRow(
			makeDistilled({
				edit_chains: { chains: [makeChain(18), makeChain(5), makeChain(2), makeChain(1)] },
			}),
		);
		expect(row.edit_chain_count).toBe(4);
		expect(row.edit_chain_links).toBe(26); // 18 + 5 + 2 + 1
		// Real mean chain length = links / chains = 6.5, NOT chains-per-session.
		expect(row.edit_chain_links / row.edit_chain_count).toBeCloseTo(6.5);
	});

	test("B19: edit_chain_links is 0 when there are no chains", () => {
		const row = toSummaryRow(makeDistilled({ edit_chains: { chains: [] } }));
		expect(row.edit_chain_count).toBe(0);
		expect(row.edit_chain_links).toBe(0);
	});
});

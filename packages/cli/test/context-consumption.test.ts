import { describe, expect, test } from "bun:test";
import { extractContextConsumption } from "../src/distill/context-consumption";
import { getModelContextWindow } from "../src/distill/stats";
import type { TranscriptEntry } from "../src/types/transcript";

const mockEntry = (overrides: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
	type: "assistant",
	timestamp: new Date().toISOString(),
	uuid: crypto.randomUUID(),
	parentUuid: null,
	sessionId: "test-session",
	message: {
		role: "assistant",
		model: "claude-sonnet-4-20250514",
		content: [],
		usage: {
			input_tokens: 1000,
			output_tokens: 200,
			cache_read_input_tokens: 500,
			cache_creation_input_tokens: 300,
		},
	},
	...overrides,
});

/** Guard that asserts a value is defined and returns it (avoids ! operator). */
const defined = <T>(value: T | undefined, msg = "expected defined"): T => {
	if (value === undefined || value === null) throw new Error(msg);
	return value;
};

describe("extractContextConsumption", () => {
	test("returns undefined when model is undefined", () => {
		const entries = [mockEntry()];
		const result = extractContextConsumption(entries, undefined);
		expect(result).toBeUndefined();
	});

	test("returns undefined for unknown model", () => {
		const entries = [mockEntry()];
		const result = extractContextConsumption(entries, "gpt-4o");
		expect(result).toBeUndefined();
	});

	test("returns undefined when no entries have usage data", () => {
		const entries = [mockEntry({ message: { role: "assistant", content: [] } })];
		const result = extractContextConsumption(entries, "claude-sonnet-4-20250514");
		expect(result).toBeUndefined();
	});

	test("returns undefined for empty entries", () => {
		const result = extractContextConsumption([], "claude-sonnet-4-20250514");
		expect(result).toBeUndefined();
	});

	test("extracts basic consumption from a single turn", () => {
		const entries = [mockEntry()];
		const r = defined(extractContextConsumption(entries, "claude-sonnet-4-20250514"));

		expect(r.turn_count).toBe(1);
		expect(r.model_context_window).toBe(200_000);
		expect(r.points).toHaveLength(1);

		const point = r.points[0];
		// total = 1000 + 500 + 300 = 1800
		expect(point.total_context_tokens).toBe(1800);
		expect(point.input_tokens).toBe(1000);
		expect(point.output_tokens).toBe(200);
		expect(point.cache_read_tokens).toBe(500);
		expect(point.cache_creation_tokens).toBe(300);
		expect(point.context_pct).toBe(0.9); // 1800/200000 * 100
		expect(point.is_compaction).toBe(false);
		expect(point.turn_index).toBe(0);
	});

	test("extracts multi-turn consumption with correct summary", () => {
		const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
		const entries = [
			mockEntry({
				timestamp: new Date(baseTime).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 2000,
						output_tokens: 400,
						cache_read_input_tokens: 1000,
						cache_creation_input_tokens: 500,
					},
				},
			}),
			mockEntry({
				timestamp: new Date(baseTime + 60_000).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 5000,
						output_tokens: 600,
						cache_read_input_tokens: 3000,
						cache_creation_input_tokens: 1000,
					},
				},
			}),
			mockEntry({
				timestamp: new Date(baseTime + 120_000).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 10000,
						output_tokens: 800,
						cache_read_input_tokens: 5000,
						cache_creation_input_tokens: 2000,
					},
				},
			}),
		];

		const r = defined(extractContextConsumption(entries, "claude-sonnet-4-20250514"));
		expect(r.turn_count).toBe(3);
		expect(r.points).toHaveLength(3);

		// Peak should be the last turn: 10000 + 5000 + 2000 = 17000
		expect(r.peak_context_tokens).toBe(17000);
		expect(r.peak_context_pct).toBe(8.5); // 17000/200000 * 100

		// Final should also be the last turn
		expect(r.final_context_pct).toBe(8.5);

		// No compaction
		expect(r.compaction_count).toBe(0);
	});

	test("detects compaction when context drops >30%", () => {
		const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
		const entries = [
			mockEntry({
				timestamp: new Date(baseTime).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 100000,
						output_tokens: 1000,
						cache_read_input_tokens: 50000,
						cache_creation_input_tokens: 10000,
					},
				},
			}),
			// Compaction: total drops from 160000 to 30000 (< 160000 * 0.7 = 112000)
			mockEntry({
				timestamp: new Date(baseTime + 60_000).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 20000,
						output_tokens: 500,
						cache_read_input_tokens: 8000,
						cache_creation_input_tokens: 2000,
					},
				},
			}),
			// Growth after compaction
			mockEntry({
				timestamp: new Date(baseTime + 120_000).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 40000,
						output_tokens: 700,
						cache_read_input_tokens: 15000,
						cache_creation_input_tokens: 5000,
					},
				},
			}),
		];

		const r = defined(extractContextConsumption(entries, "claude-sonnet-4-20250514"));
		expect(r.compaction_count).toBe(1);
		expect(r.points[1].is_compaction).toBe(true);
		expect(r.points[0].is_compaction).toBe(false);
		expect(r.points[2].is_compaction).toBe(false);

		// Peak should be first turn: 100000 + 50000 + 10000 = 160000
		expect(r.peak_context_tokens).toBe(160000);
	});

	test("deduplicates entries with same requestId", () => {
		const sharedRequestId = "req-123";
		const entries = [
			mockEntry({
				requestId: sharedRequestId,
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 1000,
						output_tokens: 100,
						cache_read_input_tokens: 500,
						cache_creation_input_tokens: 200,
					},
				},
			}),
			// Second streaming chunk with same requestId — should overwrite first
			mockEntry({
				requestId: sharedRequestId,
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 1000,
						output_tokens: 200,
						cache_read_input_tokens: 500,
						cache_creation_input_tokens: 200,
					},
				},
			}),
			// Different requestId — separate turn
			mockEntry({
				requestId: "req-456",
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 3000,
						output_tokens: 400,
						cache_read_input_tokens: 1500,
						cache_creation_input_tokens: 500,
					},
				},
			}),
		];

		const r = defined(extractContextConsumption(entries, "claude-sonnet-4-20250514"));
		// Should deduplicate to 2 turns (req-123 and req-456)
		expect(r.turn_count).toBe(2);
		expect(r.points).toHaveLength(2);
		// First point should use the LAST entry for req-123 (output_tokens: 200)
		expect(r.points[0].output_tokens).toBe(200);
	});

	test("computes velocity correctly excluding compaction points", () => {
		const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
		const entries = [
			mockEntry({
				timestamp: new Date(baseTime).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 10000,
						output_tokens: 500,
						cache_read_input_tokens: 5000,
						cache_creation_input_tokens: 1000,
					},
				},
			}),
			// Compaction at 2 min
			mockEntry({
				timestamp: new Date(baseTime + 120_000).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 2000,
						output_tokens: 200,
						cache_read_input_tokens: 1000,
						cache_creation_input_tokens: 200,
					},
				},
			}),
			// Growth at 4 min
			mockEntry({
				timestamp: new Date(baseTime + 240_000).toISOString(),
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 20000,
						output_tokens: 800,
						cache_read_input_tokens: 10000,
						cache_creation_input_tokens: 3000,
					},
				},
			}),
		];

		const r = defined(extractContextConsumption(entries, "claude-sonnet-4-20250514"));

		// Non-compaction points: first (t=0, 16000 total, 8%) and third (t=240s, 33000 total, 16.5%)
		// Velocity = (16.5 - 8) / 4 min = 2.125 per min → rounded to 2.13
		// First: (10000+5000+1000)/200000*100 = 8
		// Third: (20000+10000+3000)/200000*100 = 16.5
		// Time span: 240000ms = 4 min
		// Velocity: (16.5 - 8) / 4 = 2.125 → 2.13
		expect(r.context_velocity_per_min).toBe(2.13);
	});

	test("filters out non-assistant entries", () => {
		const entries = [
			mockEntry({ type: "user" }),
			mockEntry({ type: "progress" }),
			mockEntry(), // only this one is assistant
		];

		const r = defined(extractContextConsumption(entries, "claude-sonnet-4-20250514"));
		expect(r.turn_count).toBe(1);
	});

	test("works with claude-opus-4-6 model (1M context)", () => {
		const entries = [
			mockEntry({
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 100000,
						output_tokens: 5000,
						cache_read_input_tokens: 50000,
						cache_creation_input_tokens: 20000,
					},
				},
			}),
		];

		const r = defined(extractContextConsumption(entries, "claude-opus-4-6"));
		expect(r.model_context_window).toBe(1_000_000);
		// total = 170000, pct = 170000/1000000 * 100 = 17
		expect(r.points[0].context_pct).toBe(17);
	});
});

describe("getModelContextWindow", () => {
	// Regression for bug B8: every Opus variant resolved to 1M; only 4.6+ are 1M.
	test("claude-opus-4-0 (legacy) resolves to 200K", () => {
		expect(getModelContextWindow("claude-opus-4-20250514")).toBe(200_000);
	});

	test("claude-opus-4-6 and later resolve to 1M", () => {
		expect(getModelContextWindow("claude-opus-4-6")).toBe(1_000_000);
		expect(getModelContextWindow("claude-opus-4-7")).toBe(1_000_000);
		expect(getModelContextWindow("claude-opus-4-8")).toBe(1_000_000);
	});

	test("claude-fable-5 resolves to 1M", () => {
		expect(getModelContextWindow("claude-fable-5[1m]")).toBe(1_000_000);
	});

	test("claude-sonnet-4-6 resolves to 1M, older sonnet to 200K", () => {
		expect(getModelContextWindow("claude-sonnet-4-6")).toBe(1_000_000);
		expect(getModelContextWindow("claude-sonnet-4-20250514")).toBe(200_000);
	});

	test("resolves claude-haiku-4 prefix", () => {
		expect(getModelContextWindow("claude-haiku-4-20250514")).toBe(200_000);
	});

	test("returns undefined for unknown model", () => {
		expect(getModelContextWindow("gpt-4o")).toBeUndefined();
	});

	test("matches exact prefix", () => {
		expect(getModelContextWindow("claude-opus-4")).toBe(200_000);
	});
});

import { describe, expect, test } from "bun:test";
import { extractTokenUsage, extractUserType } from "../src/distill/agent-distill";
import { estimateCostFromTokens, getPricing } from "../src/distill/stats";
import type { TranscriptEntry } from "../src/types";

const makeAssistantEntry = (overrides: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
	uuid: "uuid-1",
	parentUuid: null,
	sessionId: "session-1",
	type: "assistant",
	timestamp: "2024-01-01T00:00:01.000Z",
	message: {
		role: "assistant",
		content: [],
	},
	...overrides,
});

const makeUserEntry = (overrides: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
	uuid: "uuid-u1",
	parentUuid: null,
	sessionId: "session-1",
	type: "user",
	timestamp: "2024-01-01T00:00:00.000Z",
	message: {
		role: "user",
		content: "Hello",
	},
	...overrides,
});

// ---------------------------------------------------------------------------
// Token dedup by requestId
// ---------------------------------------------------------------------------

describe("extractTokenUsage — requestId dedup", () => {
	test("4 entries with same requestId → usage counted once (last wins)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "a1",
				requestId: "req-1",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
				},
			}),
			makeAssistantEntry({
				uuid: "a2",
				requestId: "req-1",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 },
				},
			}),
			makeAssistantEntry({
				uuid: "a3",
				requestId: "req-1",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 300, output_tokens: 150, cache_read_input_tokens: 30, cache_creation_input_tokens: 15 },
				},
			}),
			makeAssistantEntry({
				uuid: "a4",
				requestId: "req-1",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 400, output_tokens: 200, cache_read_input_tokens: 40, cache_creation_input_tokens: 20 },
				},
			}),
		];

		const usage = extractTokenUsage(entries);
		// Only the last entry (a4) should be counted since all share req-1
		expect(usage.input_tokens).toBe(400);
		expect(usage.output_tokens).toBe(200);
		expect(usage.cache_read_tokens).toBe(40);
		expect(usage.cache_creation_tokens).toBe(20);
	});

	test("entries without requestId → each counted separately (fallback to uuid)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "unique-1",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			}),
			makeAssistantEntry({
				uuid: "unique-2",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 200, output_tokens: 80 },
				},
			}),
		];

		const usage = extractTokenUsage(entries);
		// Each entry has a unique uuid and no requestId → both counted
		expect(usage.input_tokens).toBe(300);
		expect(usage.output_tokens).toBe(130);
	});

	test("mixed: some entries share requestId, others have unique uuids", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "a1",
				requestId: "req-1",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			}),
			makeAssistantEntry({
				uuid: "a2",
				requestId: "req-1",
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 200, output_tokens: 100 },
				},
			}),
			makeAssistantEntry({
				uuid: "a3",
				// no requestId → falls back to uuid "a3"
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 300, output_tokens: 150 },
				},
			}),
		];

		const usage = extractTokenUsage(entries);
		// req-1 group: last wins → 200 input, 100 output
		// a3 standalone: 300 input, 150 output
		// total: 500 input, 250 output
		expect(usage.input_tokens).toBe(500);
		expect(usage.output_tokens).toBe(250);
	});
});

// ---------------------------------------------------------------------------
// Pricing tiers
// ---------------------------------------------------------------------------

describe("getPricing", () => {
	test("API tier returns published rates (full price)", () => {
		const pricing = getPricing("claude-sonnet-4-20250514", "api");
		expect(pricing).toBeDefined();
		expect(pricing?.input).toBe(3);
		expect(pricing?.output).toBe(15);
		expect(pricing?.cache_read).toBe(0.3);
		expect(pricing?.cache_write).toBe(3.75);
	});

	test("Max tier returns 1/3 rates", () => {
		const pricing = getPricing("claude-sonnet-4-20250514", "max");
		expect(pricing).toBeDefined();
		expect(pricing?.input).toBeCloseTo(1, 4);
		expect(pricing?.output).toBeCloseTo(5, 4);
		expect(pricing?.cache_read).toBeCloseTo(0.1, 4);
		expect(pricing?.cache_write).toBeCloseTo(1.25, 4);
	});

	test("auto tier returns same as api (full price)", () => {
		const apiPricing = getPricing("claude-opus-4-20250514", "api");
		const autoPricing = getPricing("claude-opus-4-20250514", "auto");
		expect(autoPricing).toEqual(apiPricing);
	});

	test("defaults to api tier when omitted", () => {
		const pricing = getPricing("claude-opus-4-20250514");
		expect(pricing).toBeDefined();
		expect(pricing?.input).toBe(15);
		expect(pricing?.output).toBe(75);
	});

	test("returns undefined for unknown model", () => {
		const pricing = getPricing("gpt-4-turbo", "api");
		expect(pricing).toBeUndefined();
	});
});

describe("estimateCostFromTokens with tier", () => {
	test("API tier: known tokens + sonnet model → expected USD", () => {
		const result = estimateCostFromTokens(
			"claude-sonnet-4-20250514",
			1_000_000,
			1_000_000,
			undefined,
			undefined,
			"api",
		);
		expect(result).toBeDefined();
		// $3/M input + $15/M output = $18
		expect(result?.estimated_cost_usd).toBe(18);
		expect(result?.pricing_tier).toBe("api");
		expect(result?.is_estimated).toBe(false);
	});

	test("Max tier: known tokens + sonnet model → 1/3 of API cost", () => {
		const result = estimateCostFromTokens(
			"claude-sonnet-4-20250514",
			1_000_000,
			1_000_000,
			undefined,
			undefined,
			"max",
		);
		expect(result).toBeDefined();
		// ($3/M * 1/3) input + ($15/M * 1/3) output = $1 + $5 = $6
		expect(result?.estimated_cost_usd).toBe(6);
		expect(result?.pricing_tier).toBe("max");
	});

	test("API tier: opus model with cache tokens", () => {
		const result = estimateCostFromTokens(
			"claude-opus-4-20250514",
			500_000,   // input
			200_000,   // output
			1_000_000, // cache read
			100_000,   // cache creation
			"api",
		);
		expect(result).toBeDefined();
		// (0.5M * $15) + (0.2M * $75) + (1M * $1.5) + (0.1M * $18.75)
		// = $7.5 + $15 + $1.5 + $1.875 = $25.875
		expect(result?.estimated_cost_usd).toBe(25.875);
		expect(result?.pricing_tier).toBe("api");
	});

	test("default tier is api when omitted", () => {
		const withDefault = estimateCostFromTokens("claude-sonnet-4-20250514", 1_000_000, 1_000_000);
		const withExplicit = estimateCostFromTokens("claude-sonnet-4-20250514", 1_000_000, 1_000_000, undefined, undefined, "api");
		expect(withDefault?.estimated_cost_usd).toBe(withExplicit?.estimated_cost_usd);
		expect(withDefault?.pricing_tier).toBe("api");
	});

	test("pricing_tier is included in CostEstimate", () => {
		const result = estimateCostFromTokens("claude-sonnet-4-20250514", 1000, 500, undefined, undefined, "max");
		expect(result?.pricing_tier).toBe("max");
	});
});

// ---------------------------------------------------------------------------
// extractUserType
// ---------------------------------------------------------------------------

describe("extractUserType", () => {
	test("detects userType from transcript entries", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry(),
			makeAssistantEntry({
				userType: "external",
			}),
		];

		const result = extractUserType(entries);
		expect(result).toBe("external");
	});

	test("returns undefined when no userType present", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry(),
			makeAssistantEntry(),
		];

		const result = extractUserType(entries);
		expect(result).toBeUndefined();
	});

	test("returns first userType found", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "a1",
				userType: "pro",
			}),
			makeAssistantEntry({
				uuid: "a2",
				userType: "external",
			}),
		];

		const result = extractUserType(entries);
		expect(result).toBe("pro");
	});
});

import { describe, expect, test } from "bun:test";
import { getPricing } from "../src/distill/stats";

// ---------------------------------------------------------------------------
// Per-tier published rates (locked semantics, SHARED-CONTEXT):
//   Fable 5         $10 / $50
//   Opus 4.5+       $5  / $25   (4.5, 4.6, 4.7, 4.8 ...)
//   Opus 4.0/4.1    $15 / $75   (legacy family fallback)
//   Haiku 4.5       $1  / $5
// Longest matching prefix wins, so version-specific entries override the
// family fallback. These tests pin each tier so a table edit can't silently
// regress a published rate.
// ---------------------------------------------------------------------------

describe("getPricing — per-tier published rates", () => {
	test("Opus 4.8 → $5 / $25 (current tier)", () => {
		const pricing = getPricing("claude-opus-4-8", "api");
		expect(pricing).toBeDefined();
		expect(pricing?.input).toBe(5);
		expect(pricing?.output).toBe(25);
		expect(pricing?.cache_read).toBe(0.5);
		expect(pricing?.cache_write).toBe(6.25);
	});

	test("Opus 4.5 → $5 / $25 (first version-specific entry above legacy)", () => {
		const pricing = getPricing("claude-opus-4-5", "api");
		expect(pricing).toBeDefined();
		expect(pricing?.input).toBe(5);
		expect(pricing?.output).toBe(25);
	});

	test("Fable 5 → $10 / $50", () => {
		const pricing = getPricing("claude-fable-5", "api");
		expect(pricing).toBeDefined();
		expect(pricing?.input).toBe(10);
		expect(pricing?.output).toBe(50);
		expect(pricing?.cache_read).toBe(1.0);
		expect(pricing?.cache_write).toBe(12.5);
	});

	test("Haiku 4.5 → $1 / $5", () => {
		const pricing = getPricing("claude-haiku-4-5", "api");
		expect(pricing).toBeDefined();
		expect(pricing?.input).toBe(1);
		expect(pricing?.output).toBe(5);
		expect(pricing?.cache_read).toBe(0.1);
		expect(pricing?.cache_write).toBe(1.25);
	});
});

// ---------------------------------------------------------------------------
// Longest-prefix boundary: 4 -> 4-5
// The legacy `claude-opus-4` entry ($15/$75) must NOT swallow versioned ids
// that have their own longer prefix entry ($5/$25), while versions WITHOUT a
// specific entry (4.0 / 4.1) must fall back to the legacy family rate.
// ---------------------------------------------------------------------------

describe("getPricing — Opus 4 -> 4-5 longest-prefix boundary", () => {
	test("dated Opus 4.5 id resolves to the 4-5 entry, not the legacy family", () => {
		const pricing = getPricing("claude-opus-4-5-20251101", "api");
		// Longest prefix is `claude-opus-4-5` → new tier, NOT legacy `claude-opus-4`.
		expect(pricing?.input).toBe(5);
		expect(pricing?.output).toBe(25);
	});

	test("Opus 4.1 falls back to legacy family rate ($15/$75)", () => {
		// No `claude-opus-4-1` entry exists → longest match is `claude-opus-4`.
		const pricing = getPricing("claude-opus-4-1-20250805", "api");
		expect(pricing?.input).toBe(15);
		expect(pricing?.output).toBe(75);
	});

	test("bare legacy `claude-opus-4` resolves to legacy family rate", () => {
		const pricing = getPricing("claude-opus-4", "api");
		expect(pricing?.input).toBe(15);
		expect(pricing?.output).toBe(75);
	});

	test("boundary is strict: opus 4.1 (legacy) and opus 4.5 (new) differ 3x", () => {
		const legacy = getPricing("claude-opus-4-1", "api");
		const current = getPricing("claude-opus-4-5", "api");
		expect(legacy?.input).toBe(15);
		expect(current?.input).toBe(5);
		// The 4.5+ drop is exactly 3x on input and output.
		expect((legacy?.input ?? 0) / (current?.input ?? 1)).toBe(3);
		expect((legacy?.output ?? 0) / (current?.output ?? 1)).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// NUM-2: bare-alias normalization
// Claude Code may emit bare aliases (`opus`, `sonnet`, `haiku`, `fable`)
// instead of fully-qualified ids. Each must normalize to its CURRENT canonical
// tier so the longest-prefix match never falls through to an unpriced $0.
// ---------------------------------------------------------------------------

describe("getPricing — NUM-2 alias normalization", () => {
	test("`opus` alias resolves to current Opus tier ($5/$25)", () => {
		const aliased = getPricing("opus", "api");
		const canonical = getPricing("claude-opus-4-8", "api");
		expect(aliased).toBeDefined();
		expect(aliased).toEqual(canonical);
		expect(aliased?.input).toBe(5);
		expect(aliased?.output).toBe(25);
	});

	test("`sonnet` alias resolves to current Sonnet tier ($3/$15)", () => {
		const aliased = getPricing("sonnet", "api");
		const canonical = getPricing("claude-sonnet-4-6", "api");
		expect(aliased).toEqual(canonical);
		expect(aliased?.input).toBe(3);
		expect(aliased?.output).toBe(15);
	});

	test("`haiku` alias resolves to current Haiku tier ($1/$5)", () => {
		const aliased = getPricing("haiku", "api");
		const canonical = getPricing("claude-haiku-4-5", "api");
		expect(aliased).toEqual(canonical);
		expect(aliased?.input).toBe(1);
		expect(aliased?.output).toBe(5);
	});

	test("`fable` alias resolves to Fable tier ($10/$50)", () => {
		const aliased = getPricing("fable", "api");
		const canonical = getPricing("claude-fable-5", "api");
		expect(aliased).toEqual(canonical);
		expect(aliased?.input).toBe(10);
		expect(aliased?.output).toBe(50);
	});

	test("alias matching is case-insensitive", () => {
		expect(getPricing("OPUS", "api")).toEqual(getPricing("opus", "api"));
		expect(getPricing("Haiku", "api")).toEqual(getPricing("haiku", "api"));
	});

	test("alias never falls through to an unpriced $0 (all known aliases priced)", () => {
		for (const alias of ["opus", "sonnet", "haiku", "fable"]) {
			const pricing = getPricing(alias, "api");
			expect(pricing).toBeDefined();
			expect(pricing?.input).toBeGreaterThan(0);
			expect(pricing?.output).toBeGreaterThan(0);
		}
	});
});

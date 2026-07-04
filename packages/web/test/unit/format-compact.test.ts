import { describe, expect, test } from "bun:test";
import { formatCompact } from "../../src/client/components/charts/shared";

// Regression guard for the overview-moat-refactor Wave 3 stray-decimal defect:
// integer counts rendered through formatCompact (HorizontalBar values + tooltips,
// DonutChart's default formatValue, axis ticks) used to show "6.0" while a
// sibling showed "75" — because the sub-10 branch always called `n.toFixed(1)`.
// Integers must render exactly; only genuinely fractional sub-1000 values keep
// one decimal. The ≥1K / ≥1M compact suffixes are intentional and preserved.

describe("formatCompact — integers render without a stray decimal", () => {
	test("small integers stay integers (the reported 'Read 6.0' bug)", () => {
		expect(formatCompact(6)).toBe("6");
		expect(formatCompact(75)).toBe("75");
	});

	test("zero and single digits", () => {
		expect(formatCompact(0)).toBe("0");
		expect(formatCompact(1)).toBe("1");
		expect(formatCompact(9)).toBe("9");
	});

	test("sub-1000 integers up to the K boundary", () => {
		expect(formatCompact(10)).toBe("10");
		expect(formatCompact(999)).toBe("999");
	});

	test("compact K/M notation is preserved for large magnitudes", () => {
		expect(formatCompact(1_000)).toBe("1.0K");
		expect(formatCompact(1_500)).toBe("1.5K");
		expect(formatCompact(1_500_000)).toBe("1.5M");
	});

	test("genuinely fractional sub-10 values keep one decimal of precision", () => {
		expect(formatCompact(2.5)).toBe("2.5");
	});
});

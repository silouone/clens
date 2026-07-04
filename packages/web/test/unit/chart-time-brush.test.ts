import { describe, expect, test } from "bun:test";
import {
	brushBand,
	dateDomain,
	dayToDate,
	parseDay,
	pixelToDate,
	resolveBrushSelection,
	timeScale,
} from "../../src/client/components/charts/shared";

// Continuous time x-scale + drag-brush math (analytics-truth-and-brush, task 2.1).
// These are the PURE helpers the StackedArea/LineChart/BarChart agents consume; the
// reactive createBrush wrapper is exercised in the chart components themselves. The
// headline regression here is AC11: a calendar gap (3/28 -> 5/18) must render as a
// proportional horizontal gap, not an evenly-spaced compressed step.

describe("parseDay / dayToDate", () => {
	test("round-trips a calendar day", () => {
		expect(dayToDate(parseDay("2026-05-18"))).toBe("2026-05-18");
	});

	test("equal date strings yield equal day-epochs (timezone-stable)", () => {
		expect(parseDay("2026-01-05")).toBe(parseDay("2026-01-05"));
	});

	test("consecutive days differ by exactly one", () => {
		expect(parseDay("2026-03-29") - parseDay("2026-03-28")).toBe(1);
	});

	test("a 51-day gap is 51 epoch-days apart (3/28 -> 5/18)", () => {
		expect(parseDay("2026-05-18") - parseDay("2026-03-28")).toBe(51);
	});

	test("zero-pads month and day on inverse", () => {
		expect(dayToDate(parseDay("2026-01-05"))).toBe("2026-01-05");
	});

	test("returns NaN for unparseable input", () => {
		expect(Number.isNaN(parseDay("not-a-date"))).toBe(true);
	});
});

describe("dateDomain", () => {
	test("derives [min, max] day-epoch across dates", () => {
		const dom = dateDomain(["2026-03-28", "2026-05-18", "2026-04-01"]);
		expect(dom).toEqual([parseDay("2026-03-28"), parseDay("2026-05-18")]);
	});

	test("ignores unparseable dates", () => {
		const dom = dateDomain(["bad", "2026-04-01", "also-bad"]);
		expect(dom).toEqual([parseDay("2026-04-01"), parseDay("2026-04-01")]);
	});

	test("returns undefined when no usable date exists", () => {
		expect(dateDomain([])).toBeUndefined();
		expect(dateDomain(["x", "y"])).toBeUndefined();
	});
});

describe("timeScale (AC11 continuous time axis)", () => {
	test("maps domain endpoints to range endpoints", () => {
		const dom = dateDomain(["2026-03-28", "2026-05-18"]);
		if (!dom) throw new Error("domain");
		const scale = timeScale(dom, [0, 100]);
		expect(scale("2026-03-28")).toBeCloseTo(0);
		expect(scale("2026-05-18")).toBeCloseTo(100);
	});

	test("positions a point by CALENDAR time, leaving gaps proportional", () => {
		// Three plotted points: 3/28, 3/29, 5/18. By INDEX the middle point would
		// sit at 50% (the old bug). By calendar time it sits at 1/51 of the span.
		const dom = dateDomain(["2026-03-28", "2026-03-29", "2026-05-18"]);
		if (!dom) throw new Error("domain");
		const scale = timeScale(dom, [0, 510]);
		expect(scale("2026-03-29")).toBeCloseTo(10); // 1 day of 51 across 510px
		// Not the index-based 255 (50%) — the gap is preserved.
		expect(scale("2026-03-29")).not.toBeCloseTo(255);
	});

	test("centres a single-day domain instead of pinning to the axis", () => {
		const dom = dateDomain(["2026-04-01"]);
		if (!dom) throw new Error("domain");
		const scale = timeScale(dom, [0, 200]);
		expect(scale("2026-04-01")).toBeCloseTo(100);
	});

	test("centres unparseable dates rather than throwing", () => {
		const dom = dateDomain(["2026-03-28", "2026-05-18"]);
		if (!dom) throw new Error("domain");
		const scale = timeScale(dom, [0, 100]);
		expect(scale("garbage")).toBeCloseTo(50);
	});
});

describe("pixelToDate (brush inverse)", () => {
	const dom = dateDomain(["2026-03-01", "2026-03-31"]);
	if (!dom) throw new Error("domain");

	test("maps the left edge to the first day", () => {
		expect(pixelToDate(0, dom, [0, 300])).toBe("2026-03-01");
	});

	test("maps the right edge to the last day", () => {
		expect(pixelToDate(300, dom, [0, 300])).toBe("2026-03-31");
	});

	test("maps the midpoint to the middle day", () => {
		expect(pixelToDate(150, dom, [0, 300])).toBe("2026-03-16");
	});

	test("clamps pixels outside the plot to the domain bounds", () => {
		expect(pixelToDate(-50, dom, [0, 300])).toBe("2026-03-01");
		expect(pixelToDate(9999, dom, [0, 300])).toBe("2026-03-31");
	});

	test("a single-day domain resolves every pixel to that day", () => {
		const one = dateDomain(["2026-04-09"]);
		if (!one) throw new Error("domain");
		expect(pixelToDate(123, one, [0, 300])).toBe("2026-04-09");
	});
});

describe("brushBand (live selection geometry)", () => {
	test("returns the left edge and width for a left-to-right drag", () => {
		expect(brushBand(40, 120, [0, 300])).toEqual({ x: 40, width: 80 });
	});

	test("is direction-agnostic (right-to-left yields the same band)", () => {
		expect(brushBand(120, 40, [0, 300])).toEqual({ x: 40, width: 80 });
	});

	test("clamps the band to the plot range", () => {
		expect(brushBand(-20, 9999, [0, 300])).toEqual({ x: 0, width: 300 });
	});

	test("a zero-length drag yields zero width", () => {
		expect(brushBand(50, 50, [0, 300])).toEqual({ x: 50, width: 0 });
	});
});

describe("resolveBrushSelection (pixel span -> inclusive dates, AC7)", () => {
	const dates = ["2026-03-01", "2026-03-10", "2026-03-20", "2026-03-31"];
	const range: readonly [number, number] = [0, 300];

	test("resolves a drag to the covered inclusive window", () => {
		// 30-day domain across 300px: pixel 100 -> day 10, pixel 200 -> day 20.
		const sel = resolveBrushSelection(100, 200, dates, range);
		expect(sel).toEqual({ start: "2026-03-11", end: "2026-03-21" });
	});

	test("is direction-agnostic", () => {
		const a = resolveBrushSelection(100, 200, dates, range);
		const b = resolveBrushSelection(200, 100, dates, range);
		expect(b).toEqual(a);
	});

	test("returns undefined for a click-sized drag (below threshold)", () => {
		expect(resolveBrushSelection(150, 152, dates, range)).toBeUndefined();
	});

	test("returns undefined when no usable date domain exists", () => {
		expect(resolveBrushSelection(0, 300, ["x", "y"], range)).toBeUndefined();
	});

	test("always emits start <= end", () => {
		const sel = resolveBrushSelection(280, 20, dates, range);
		if (!sel) throw new Error("expected selection");
		expect(sel.start <= sel.end).toBe(true);
	});
});

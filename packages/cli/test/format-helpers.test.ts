import { describe, expect, test } from "bun:test";
import { fmtDuration } from "../src/commands/format-helpers";

describe("fmtDuration", () => {
	test("42000ms → 42s", () => {
		expect(fmtDuration(42000)).toBe("42s");
	});

	test("303000ms → 5m03s", () => {
		expect(fmtDuration(303000)).toBe("5m03s");
	});

	test("3540000ms → 59m", () => {
		expect(fmtDuration(3540000)).toBe("59m");
	});

	test("7200000ms → 2h0m", () => {
		expect(fmtDuration(7200000)).toBe("2h0m");
	});

	test("5400000ms → 1h30m", () => {
		expect(fmtDuration(5400000)).toBe("1h30m");
	});
});

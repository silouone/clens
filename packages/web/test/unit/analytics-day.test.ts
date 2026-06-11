import { describe, expect, test } from "bun:test"
import { localDayKey, matchesLocalDay, isValidDayKey } from "../../src/client/lib/analytics-day"

// Regression guards for bug B22 (specs/revive/bug-register.md): the usage/insights
// charts navigated to `/?date=YYYY-MM-DD`, but nothing consumed that param so the
// drill-down silently did nothing. The session list now filters by LOCAL calendar day
// using matchesLocalDay; isValidDayKey guards the param before it is used.

// Build a local timestamp so tests are timezone-stable (they compute the key in the
// same local zone the function uses).
const localTs = (y: number, mo: number, d: number, h = 12, mi = 0): number =>
	new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe("localDayKey (B22)", () => {
	test("formats the LOCAL calendar day as YYYY-MM-DD", () => {
		expect(localDayKey(localTs(2026, 3, 15))).toBe("2026-03-15")
	})

	test("zero-pads month and day", () => {
		expect(localDayKey(localTs(2026, 1, 5))).toBe("2026-01-05")
	})

	test("uses local midnight boundaries (00:05 and 23:55 stay on the same local day)", () => {
		expect(localDayKey(localTs(2026, 3, 15, 0, 5))).toBe("2026-03-15")
		expect(localDayKey(localTs(2026, 3, 15, 23, 55))).toBe("2026-03-15")
	})
})

describe("matchesLocalDay (B22)", () => {
	test("true when the start time falls on the given local day", () => {
		expect(matchesLocalDay(localTs(2026, 3, 15, 9, 30), "2026-03-15")).toBe(true)
		expect(matchesLocalDay(localTs(2026, 3, 15, 0, 1), "2026-03-15")).toBe(true)
		expect(matchesLocalDay(localTs(2026, 3, 15, 23, 59), "2026-03-15")).toBe(true)
	})

	test("false for a different local day", () => {
		expect(matchesLocalDay(localTs(2026, 3, 14, 23, 59), "2026-03-15")).toBe(false)
		expect(matchesLocalDay(localTs(2026, 3, 16, 0, 1), "2026-03-15")).toBe(false)
	})
})

describe("isValidDayKey (B22)", () => {
	test("accepts well-formed YYYY-MM-DD keys", () => {
		expect(isValidDayKey("2026-03-15")).toBe(true)
		expect(isValidDayKey("2026-01-01")).toBe(true)
	})

	test("rejects undefined and malformed values", () => {
		expect(isValidDayKey(undefined)).toBe(false)
		expect(isValidDayKey("")).toBe(false)
		expect(isValidDayKey("2026-3-5")).toBe(false)
		expect(isValidDayKey("not-a-date")).toBe(false)
		expect(isValidDayKey("2026/03/15")).toBe(false)
	})
})

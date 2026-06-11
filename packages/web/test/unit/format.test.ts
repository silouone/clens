import { describe, expect, test } from "bun:test"
import { calendarDaysBetween, formatDate } from "../../src/client/lib/format"

// Regression guards for bug B21 (specs/revive/bug-register.md): the WHEN column's
// "relative" dates used 24h-wide buckets (Math.floor(diffMs / 86_400_000)) so an
// event at "yesterday 23:00" — under 24h ago — rendered as today's HH:MM. The fix
// buckets by LOCAL calendar day instead. The "absolute" preference must keep
// working unchanged.

// Build a local timestamp from Y/M/D h:m so tests are timezone-stable (they
// compute "now" and "then" in the same local zone the function uses).
const localTs = (y: number, mo: number, d: number, h = 12, mi = 0): number =>
	new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe("calendarDaysBetween (B21)", () => {
	test("same calendar day is 0 even across many hours", () => {
		expect(calendarDaysBetween(localTs(2026, 6, 11, 23, 59), localTs(2026, 6, 11, 0, 1))).toBe(0)
	})

	test("yesterday 23:00 -> now 01:00 (under 24h) counts as 1 calendar day", () => {
		const now = localTs(2026, 6, 11, 1, 0)
		const then = localTs(2026, 6, 10, 23, 0)
		// elapsed is only 2h, but it crossed one local midnight
		expect(now - then).toBeLessThan(86_400_000)
		expect(calendarDaysBetween(now, then)).toBe(1)
	})

	test("counts multiple midnight crossings", () => {
		expect(calendarDaysBetween(localTs(2026, 6, 11), localTs(2026, 6, 4))).toBe(7)
	})
})

describe("formatDate relative mode (B21)", () => {
	const now = localTs(2026, 6, 11, 1, 0) // today is the 11th at 01:00 local

	test("an event earlier today renders as HH:MM, not 'Yesterday'", () => {
		const out = formatDate(localTs(2026, 6, 11, 0, 5), "relative", now)
		// 00:05 today — formatted as a time, contains a colon, not a relative word
		expect(out).toMatch(/\d{1,2}:\d{2}/)
		expect(out).not.toBe("Yesterday")
	})

	test("yesterday 23:00 (under 24h ago) renders as 'Yesterday', not today's time", () => {
		const out = formatDate(localTs(2026, 6, 10, 23, 0), "relative", now)
		expect(out).toBe("Yesterday")
	})

	test("2 calendar days ago renders as 'Nd ago'", () => {
		expect(formatDate(localTs(2026, 6, 9, 12, 0), "relative", now)).toBe("2d ago")
	})

	test("a week or more ago falls back to an absolute month/day", () => {
		const out = formatDate(localTs(2026, 6, 1, 12, 0), "relative", now)
		expect(out).not.toMatch(/ago|Yesterday/)
		expect(out.length).toBeGreaterThan(0)
	})
})

describe("formatDate absolute mode (B21 preference preserved)", () => {
	test("absolute mode ignores 'now' and renders month/day/time", () => {
		const ts = localTs(2026, 3, 5, 14, 32)
		const out = formatDate(ts, "absolute")
		// month short name + day + time-of-day all present
		expect(out).toMatch(/\d{1,2}:\d{2}/)
		expect(out).toMatch(/[A-Za-z]{3}/)
	})
})

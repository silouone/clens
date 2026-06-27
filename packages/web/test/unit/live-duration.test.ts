import { describe, expect, test } from "bun:test"
import { computeLiveElapsed, LIVE_ACTIVE_THRESHOLD_MS } from "../../src/client/lib/live-duration"

// Regression guards for bug B20 (specs/revive/bug-register.md): the live view
// duration was computed as `Date.now() - start_time` where start_time was the
// PAGE-LOAD instant (Date.now() in createInitialState), so the counter was
// page-relative and reset per navigation. It must instead be
// lastEventTime - firstEventTime (SERVER timestamps), ticking forward from the
// last event time only while the session is active.

describe("computeLiveElapsed (B20)", () => {
	test("no events yet -> 0 (not page-relative wall clock)", () => {
		expect(
			computeLiveElapsed({
				firstEventTime: 0,
				lastEventTime: 0,
				status: "active",
				lastEventReceivedAt: 5_000,
				localNow: 1_000_000,
			}),
		).toBe(0)
	})

	test("complete session reports the exact server span, independent of local clock", () => {
		const first = 1_000_000
		const last = 1_000_000 + 90_000 // 90s of real session
		expect(
			computeLiveElapsed({
				firstEventTime: first,
				lastEventTime: last,
				status: "complete",
				lastEventReceivedAt: 42, // irrelevant when complete
				localNow: 9_999_999_999,
			}),
		).toBe(90_000)
	})

	test("active session = server span + local time since last event arrived", () => {
		const first = 1_000_000
		const last = 1_000_000 + 60_000 // 60s server span
		const received = 7_000 // local instant the last event landed
		const now = received + 5_000 // 5s later
		expect(
			computeLiveElapsed({
				firstEventTime: first,
				lastEventTime: last,
				status: "active",
				lastEventReceivedAt: received,
				localNow: now,
			}),
		).toBe(65_000)
	})

	test("active duration is NOT page-relative: a huge localNow does not inflate it", () => {
		// The old bug: Date.now() - start_time grew with wall clock regardless of
		// event timestamps. Here the server span is tiny and the local delta since
		// the last event is tiny, so the result stays small even though localNow is
		// a large absolute timestamp.
		const out = computeLiveElapsed({
			firstEventTime: 1_700_000_000_000,
			lastEventTime: 1_700_000_000_000 + 2_000,
			status: "active",
			lastEventReceivedAt: 1_700_000_050_000,
			localNow: 1_700_000_050_500,
		})
		expect(out).toBe(2_500)
	})

	test("clamps to 0 on out-of-order inputs (never negative)", () => {
		expect(
			computeLiveElapsed({
				firstEventTime: 2_000,
				lastEventTime: 1_000, // last < first (shouldn't happen, but guard)
				status: "complete",
				lastEventReceivedAt: 0,
				localNow: 0,
			}),
		).toBe(0)
	})

	test("idle session freezes at the server span and does not keep ticking (NUM-12)", () => {
		// The reducer only ever emits raw status "active" until a terminal event,
		// so a quiet live session arrives here as "active". Once its last event is
		// older than the active threshold it is effectively idle and the counter
		// must stop advancing: the bare server span, regardless of how far localNow
		// has run past the last event.
		const first = 1_000_000
		const last = first + 60_000 // 60s server span
		const received = 2_000_000
		const base = {
			firstEventTime: first,
			lastEventTime: last,
			status: "active" as const,
			lastEventReceivedAt: received,
		}
		// Just past the threshold -> idle -> frozen at the span.
		expect(
			computeLiveElapsed({ ...base, localNow: last + LIVE_ACTIVE_THRESHOLD_MS + 1 }),
		).toBe(60_000)
		// Much later still -> same frozen value, proving it no longer ticks.
		expect(computeLiveElapsed({ ...base, localNow: last + LIVE_ACTIVE_THRESHOLD_MS * 100 })).toBe(
			60_000,
		)
	})

	test("does not tick backward if localNow precedes lastEventReceivedAt", () => {
		const first = 1_000
		const last = 1_000 + 30_000
		expect(
			computeLiveElapsed({
				firstEventTime: first,
				lastEventTime: last,
				status: "active",
				lastEventReceivedAt: 100_000,
				localNow: 99_000, // clock skew: earlier than receipt
			}),
		).toBe(30_000)
	})
})

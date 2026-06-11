import { describe, expect, test } from "bun:test"
import { debounce, type DebounceClock } from "../../src/client/lib/debounce"

// Regression guard for the SSE refetch debounce-starvation bugs
// (session-list-refetch-debounce-starvation / sse-refetch-debounce-starvation,
// specs/revive/discrepancy-report.md): debouncedRefetch was a pure trailing-edge
// debounce (clearTimeout + new setTimeout on every call) with NO max-wait. While
// SSE session_update/distill_complete events arrive faster than the 10s window —
// exactly what happens during a busy live session — the timer is reset on every
// call and the session list NEVER refreshes. The fix adds a max-wait that forces
// a trailing flush once the call has been pending for maxWaitMs.

/**
 * Deterministic fake clock + timer scheduler. Time only advances via advance();
 * timers fire in FIFO order when their deadline is reached. No real wall clock.
 */
const makeFakeClock = () => {
	type Scheduled = { readonly id: number; readonly cb: () => void; readonly at: number }
	const state = { now: 0, nextId: 1, timers: [] as Scheduled[] }

	const clock: DebounceClock = {
		now: () => state.now,
		setTimer: (cb, ms) => {
			const id = state.nextId
			state.nextId = id + 1
			state.timers = [...state.timers, { id, cb, at: state.now + ms }]
			return id
		},
		clearTimer: (handle) => {
			state.timers = state.timers.filter((t) => t.id !== handle)
		},
	}

	const advance = (ms: number) => {
		const target = state.now + ms
		// Fire every timer whose deadline falls within [now, target], in order.
		const fireDue = () => {
			const due = state.timers
				.filter((t) => t.at <= target)
				.sort((a, b) => a.at - b.at)
			if (due.length === 0) {
				state.now = target
				return
			}
			const next = due[0]
			state.now = next.at
			state.timers = state.timers.filter((t) => t.id !== next.id)
			next.cb()
			fireDue()
		}
		fireDue()
	}

	return { clock, advance }
}

describe("debounce (trailing edge)", () => {
	test("fires once after the quiet window when calls stop", () => {
		const { clock, advance } = makeFakeClock()
		const calls: number[] = []
		const fn = debounce(() => calls.push(clock.now()), 1_000, 0, clock)

		fn()
		advance(500)
		expect(calls).toEqual([]) // still within the window
		advance(500) // total 1_000 since last call
		expect(calls.length).toBe(1)
	})

	test("resets the window on each call (trailing semantics)", () => {
		const { clock, advance } = makeFakeClock()
		const calls: number[] = []
		const fn = debounce(() => calls.push(clock.now()), 1_000, 0, clock)

		fn()
		advance(900)
		fn() // resets the 1s window
		advance(900)
		expect(calls).toEqual([]) // never quiet for a full second
		advance(100)
		expect(calls.length).toBe(1)
	})
})

describe("debounce max-wait starvation cap (refetch-debounce-starvation regression)", () => {
	test("WITHOUT max-wait, sustained calls starve the function forever", () => {
		const { clock, advance } = makeFakeClock()
		const calls: number[] = []
		const fn = debounce(() => calls.push(clock.now()), 1_000, 0, clock) // no cap

		// A call every 900ms keeps resetting the 1s window — the old bug.
		Array.from({ length: 20 }).forEach(() => {
			fn()
			advance(900)
		})
		expect(calls).toEqual([]) // starved: the function never ran
	})

	test("WITH max-wait, a forced trailing flush fires despite sustained calls", () => {
		const { clock, advance } = makeFakeClock()
		const calls: number[] = []
		const fn = debounce(() => calls.push(clock.now()), 1_000, 5_000, clock)

		// Same sustained-activity pattern: a call every 900ms.
		Array.from({ length: 20 }).forEach(() => {
			fn()
			advance(900)
		})
		// Once a call has been pending >= 5_000ms, the next call flushes it.
		expect(calls.length).toBeGreaterThan(0)
		// And it flushed at or after the cap, not before.
		expect(calls[0]).toBeGreaterThanOrEqual(5_000)
	})

	test("max-wait does not change behavior when calls are sparse", () => {
		const { clock, advance } = makeFakeClock()
		const calls: number[] = []
		const fn = debounce(() => calls.push(clock.now()), 1_000, 5_000, clock)

		fn()
		advance(2_000) // quiet far longer than the debounce window
		expect(calls.length).toBe(1) // fired via the normal trailing timer
		expect(calls[0]).toBe(1_000)
	})
})

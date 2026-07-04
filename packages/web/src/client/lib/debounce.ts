/**
 * Pure trailing-edge debounce with a max-wait guarantee.
 *
 * Lives in its own leaf module — no SolidJS or browser-global imports — so the
 * timer/starvation logic can be unit-tested directly with injectable clock and
 * timer primitives. `events.ts` re-exports this for use by the SSE refetch path.
 *
 * A plain trailing debounce (clearTimeout + setTimeout on every call) starves
 * under sustained activity: while calls keep arriving faster than `ms`, the
 * timer is reset on every call and `fn` never runs. `maxWaitMs` bounds that
 * starvation — once `fn` has been pending for `maxWaitMs` without firing, the
 * next call flushes it immediately. Pass `maxWaitMs <= 0` to disable the cap.
 */

export type DebounceClock = {
	/** Current wall-clock instant in ms. */
	readonly now: () => number;
	/** Schedule `cb` after `ms`; returns an opaque handle. */
	readonly setTimer: (cb: () => void, ms: number) => unknown;
	/** Cancel a previously scheduled timer. */
	readonly clearTimer: (handle: unknown) => void;
};

const defaultClock: DebounceClock = {
	now: () => Date.now(),
	setTimer: (cb, ms) => setTimeout(cb, ms),
	clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const debounce = <T extends (...args: readonly unknown[]) => void>(
	fn: T,
	ms: number,
	maxWaitMs = 0,
	clock: DebounceClock = defaultClock,
): ((...args: Parameters<T>) => void) => {
	// Pragmatic exception: mutable timer/state refs are inherent to debounce
	// semantics (a timer handle and the first-pending instant must persist
	// across calls within this closure).
	// eslint-disable-next-line -- mutable timer handle required for debounce
	let timer: unknown;
	// eslint-disable-next-line -- mutable ref: wall-clock of the first pending call
	let firstPendingAt: number | undefined;
	const cap = maxWaitMs > 0 ? maxWaitMs : Number.POSITIVE_INFINITY;
	return (...args: Parameters<T>) => {
		const now = clock.now();
		if (firstPendingAt === undefined) firstPendingAt = now;
		const run = () => {
			if (timer !== undefined) clock.clearTimer(timer);
			timer = undefined;
			firstPendingAt = undefined;
			fn(...args);
		};
		// Max-wait reached: flush now rather than resetting the timer again.
		if (now - firstPendingAt >= cap) {
			run();
			return;
		}
		if (timer !== undefined) clock.clearTimer(timer);
		timer = clock.setTimer(run, ms);
	};
};

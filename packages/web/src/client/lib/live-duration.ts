/**
 * Pure live-session duration math (bug B20).
 *
 * Kept in its own leaf module — with no SolidJS or browser-global imports — so
 * it can be unit-tested directly. `live-store.ts` (which transitively pulls in
 * Solid reactivity and `window`/`localStorage` at import time) re-exports this.
 */

export type LiveElapsedArgs = {
	/** Server timestamp (ms) of the earliest event seen; 0 if none yet. */
	readonly firstEventTime: number
	/** Server timestamp (ms) of the most recent event seen; 0 if none yet. */
	readonly lastEventTime: number
	/** Current session status. */
	readonly status: "active" | "idle" | "complete"
	/** Local wall-clock instant (ms) the last event was received. */
	readonly lastEventReceivedAt: number
	/** Current local wall-clock instant (ms). */
	readonly localNow: number
}

/**
 * Compute the live session duration in ms.
 *
 * The baseline span is `lastEventTime - firstEventTime` using SERVER
 * timestamps — never page-relative wall clock. While the session is still
 * active we tick forward *from the last event time*: `localNow -
 * lastEventReceivedAt` is the wall-clock time observed locally since that last
 * event arrived, added on top of the server span so the counter advances
 * smoothly between events. A complete session (or one with no events yet)
 * reports the bare span.
 */
export const computeLiveElapsed = (args: LiveElapsedArgs): number => {
	const { firstEventTime, lastEventTime, status, lastEventReceivedAt, localNow } = args
	if (firstEventTime === 0 || lastEventTime === 0) return 0
	const span = lastEventTime - firstEventTime
	if (status === "complete") return Math.max(0, span)
	const sinceLastEvent = Math.max(0, localNow - lastEventReceivedAt)
	return Math.max(0, span + sinceLastEvent)
}

/**
 * A live session whose last event is older than this is "idle", not "active".
 * Mirrors the server's ACTIVE_THRESHOLD_MS (@clens/cli deriveSessionStatus) so
 * the live detail view and the session list agree on the active/idle boundary —
 * a quiet live session must not show "active" forever while the list says
 * "idle". Kept as a local literal so this leaf module imports nothing.
 */
export const LIVE_ACTIVE_THRESHOLD_MS = 600_000 // 10 minutes

export type LiveStatus = "active" | "idle" | "complete"

/**
 * Derive the DISPLAY status of a live session, aligned with the server's
 * deriveSessionStatus semantics. The reducer can only ever produce "active" (or
 * "complete" on a terminal event) because it has no notion of "now"; this
 * overlay downgrades a still-running session to "idle" once its most recent
 * event is older than the active threshold.
 *
 * - "complete" is terminal and never reverts.
 * - With no events yet (lastEventTime === 0) the session is treated as active
 *   (it just mounted; nothing has gone quiet).
 * - Otherwise active iff `now - lastEventTime <= LIVE_ACTIVE_THRESHOLD_MS`,
 *   else idle.
 */
export const deriveLiveStatus = (
	rawStatus: LiveStatus,
	lastEventTime: number,
	now: number,
): LiveStatus => {
	if (rawStatus === "complete") return "complete"
	if (lastEventTime === 0) return "active"
	return now - lastEventTime <= LIVE_ACTIVE_THRESHOLD_MS ? "active" : "idle"
}

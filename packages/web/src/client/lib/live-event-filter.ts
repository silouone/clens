import type { StoredEvent } from "../../shared/types";

/**
 * SolidJS-free leaf module: the authoritative acceptance predicate for live
 * (SSE-broadcast) events against the currently-viewed session.
 *
 * Lives here (not inline in live-store.ts) so it can be unit-imported under bun
 * — live-store.ts transitively pulls in api.ts, which touches `window` at module
 * load and crashes the test runtime.
 *
 * Background (bug: child-session-live-events-prefiltered):
 * The server broadcasts each watched JSONL file's events under that file's own
 * session id (derived from the filename). A child/sub-session therefore emits
 * events whose `sid` is the CHILD's id, not the parent's. The SSE layer
 * (events.ts) must NOT pre-filter on `data.session_id === activeSessionId()`,
 * because the parent's id never equals a child's — doing so silently drops every
 * child-session event before it ever reaches the store. Instead, events.ts
 * forwards all events while a session is active, and this predicate makes the
 * authoritative accept/reject decision using the embedded event's own `sid`.
 */

// ── Type guard ──────────────────────────────────────────────────────

/**
 * Narrow an unknown SSE payload to a StoredEvent. A live event must carry both
 * an `event` discriminator and a server timestamp `t`.
 */
export const isStoredEvent = (raw: unknown): raw is StoredEvent =>
	typeof raw === "object" && raw !== null && "event" in raw && "t" in raw;

// ── Acceptance predicate ────────────────────────────────────────────

/**
 * Decide whether a live event belongs to the viewed session.
 *
 * Accepts when the event's own `sid` is either the viewed session itself or one
 * of its known child sessions. This is the single source of truth for live-event
 * acceptance — the SSE forwarder deliberately does no session filtering of its
 * own.
 */
export const acceptsLiveEvent = (
	event: StoredEvent,
	sessionId: string,
	childSessionIds: ReadonlySet<string>,
): boolean => event.sid === sessionId || childSessionIds.has(event.sid);

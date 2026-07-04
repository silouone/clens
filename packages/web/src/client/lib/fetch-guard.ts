/**
 * Pure stale-fetch guards for async store resolutions.
 *
 * Leaf module — no SolidJS or browser-global imports — so the request-key
 * comparison is unit-testable. Async fetches in a per-session store can resolve
 * AFTER the user has navigated to a different session; writing their results
 * then clobbers the new session's state with the old session's data. Each store
 * compares the in-flight request's key against the current key before any
 * setState; a mismatch means the response is stale and must be dropped.
 */

/**
 * True when a conversation fetch issued for `requestId` should be discarded
 * because the active session has since changed (or been cleared).
 *
 * A response is stale when the current session id no longer equals the id the
 * request was issued for — including the case where the session was cleared
 * (currentId === undefined). When they still match, the response is current and
 * safe to apply.
 */
export const isStaleConversationFetch = (
	requestId: string,
	currentId: string | undefined,
): boolean => currentId !== requestId;

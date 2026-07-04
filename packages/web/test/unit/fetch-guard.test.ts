import { describe, expect, test } from "bun:test";
import { isStaleConversationFetch } from "../../src/client/lib/fetch-guard";

// Regression guard for bug conversation-store-stale-fetch-clobber
// (specs/revive/discrepancy-report.md): createConversationStore.fetchPage wrote
// setEntries/setTotal/setHasMore/setOffset on resolution with NO guard that the
// in-flight request's session id still matched the current sessionId(). When the
// user navigated to session B while session A's conversation fetch was awaiting,
// A's response clobbered B's store. The fix gates every state write on the
// request id still matching the live session id.

describe("isStaleConversationFetch (stale-fetch clobber guard)", () => {
	test("fresh: request id matches the current session — apply the response", () => {
		expect(isStaleConversationFetch("session-a", "session-a")).toBe(false);
	});

	test("stale: user navigated to another session mid-flight — drop the response", () => {
		// The core bug: A's fetch resolves while B is the active session.
		expect(isStaleConversationFetch("session-a", "session-b")).toBe(true);
	});

	test("stale: the session was cleared (undefined) while the fetch was in flight", () => {
		expect(isStaleConversationFetch("session-a", undefined)).toBe(true);
	});

	test("identical-string ids still count as fresh (no false stale)", () => {
		const id = `${"sess"}-123`; // distinct object, equal value
		expect(isStaleConversationFetch("sess-123", id)).toBe(false);
	});
});

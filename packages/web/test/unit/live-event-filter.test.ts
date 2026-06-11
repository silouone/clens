import { describe, expect, test } from "bun:test"
import { acceptsLiveEvent, isStoredEvent } from "../../src/client/lib/live-event-filter"
import type { StoredEvent } from "../../src/shared/types"

// Regression: child-session-live-events-prefiltered
// The server broadcasts each watched JSONL file's events under that file's OWN
// session id. A child session therefore emits events whose `sid` is the child's
// id, never the viewed parent's. The SSE forwarder must not pre-filter on the
// parent id, and acceptance is decided here against the event's own sid.

const makeEvent = (sid: string, overrides: Partial<StoredEvent> = {}): StoredEvent => ({
	t: 1000,
	event: "PreToolUse",
	sid,
	data: {},
	...overrides,
})

describe("isStoredEvent", () => {
	test("accepts a well-formed stored event", () => {
		expect(isStoredEvent(makeEvent("s1"))).toBe(true)
	})

	test("rejects payloads missing the event discriminator", () => {
		expect(isStoredEvent({ t: 1, sid: "s1", data: {} })).toBe(false)
	})

	test("rejects payloads missing the timestamp", () => {
		expect(isStoredEvent({ event: "PreToolUse", sid: "s1", data: {} })).toBe(false)
	})

	test("rejects non-objects and null", () => {
		expect(isStoredEvent(null)).toBe(false)
		expect(isStoredEvent(undefined)).toBe(false)
		expect(isStoredEvent("PreToolUse")).toBe(false)
	})
})

describe("acceptsLiveEvent", () => {
	const PARENT = "parent-sid"
	const CHILD = "child-sid"
	const FOREIGN = "unrelated-sid"

	test("accepts an event whose sid is the viewed session itself", () => {
		expect(acceptsLiveEvent(makeEvent(PARENT), PARENT, new Set())).toBe(true)
	})

	test("accepts a CHILD session's event (broadcast under the child's own sid)", () => {
		// This is the core of the bug: the event arrives with the child's sid,
		// which never equals the parent's activeSessionId(). It must still be
		// accepted because the child is a known child of the viewed session.
		expect(acceptsLiveEvent(makeEvent(CHILD), PARENT, new Set([CHILD]))).toBe(true)
	})

	test("accepts events from any of several known child sessions", () => {
		const children = new Set(["c1", "c2", "c3"])
		expect(acceptsLiveEvent(makeEvent("c2"), PARENT, children)).toBe(true)
		expect(acceptsLiveEvent(makeEvent("c3"), PARENT, children)).toBe(true)
	})

	test("rejects an event from an unrelated session", () => {
		expect(acceptsLiveEvent(makeEvent(FOREIGN), PARENT, new Set([CHILD]))).toBe(false)
	})

	test("rejects a child's event before that child is known to the session", () => {
		// Until the spawn link registers the child in child_session_ids, the
		// event is (correctly) not yet attributable to the parent.
		expect(acceptsLiveEvent(makeEvent(CHILD), PARENT, new Set())).toBe(false)
	})
})

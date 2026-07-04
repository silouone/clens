import { describe, expect, test } from "bun:test";
import { ACTIVE_THRESHOLD_MS, deriveSessionStatus, SESSION_STATUSES } from "../src/types";

// Regression coverage for the status model (bugs B5/B6). A session is only
// "complete" when it ended cleanly (SessionEnd). Otherwise it is "active" while
// its last event is recent, and "idle" once it has gone quiet past the window.
describe("deriveSessionStatus", () => {
	const NOW = 1_700_000_000_000;

	test("SessionEnd always means complete, regardless of age", () => {
		expect(deriveSessionStatus(true, NOW, NOW)).toBe("complete");
		// Even an ancient ended session stays complete.
		expect(deriveSessionStatus(true, 0, NOW)).toBe("complete");
	});

	test("non-ended + last event within the window is active", () => {
		expect(deriveSessionStatus(false, NOW, NOW)).toBe("active");
		expect(deriveSessionStatus(false, NOW - 60_000, NOW)).toBe("active");
	});

	test("non-ended + last event exactly at the threshold boundary is active", () => {
		expect(deriveSessionStatus(false, NOW - ACTIVE_THRESHOLD_MS, NOW)).toBe("active");
	});

	test("non-ended + last event past the window is idle", () => {
		expect(deriveSessionStatus(false, NOW - ACTIVE_THRESHOLD_MS - 1, NOW)).toBe("idle");
		// A session whose last event was hours ago is idle, not active (bug B6).
		expect(deriveSessionStatus(false, NOW - 5 * 60 * 60_000, NOW)).toBe("idle");
	});

	test("threshold is 10 minutes", () => {
		expect(ACTIVE_THRESHOLD_MS).toBe(600_000);
	});

	test("status set is exactly complete/active/idle", () => {
		expect([...SESSION_STATUSES]).toEqual(["complete", "active", "idle"]);
	});
});

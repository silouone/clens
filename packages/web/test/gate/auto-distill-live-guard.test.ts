import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AutoDistillGuardInput, shouldAutoDistill } from "../../src/client/lib/auto-distill";

// Regression guard for bug B17 / D13 (specs/revive/bug-register.md):
// viewing a LIVE (active/idle) session used to trigger client auto-distill,
// freezing a stale "complete" snapshot seconds into a running session. The
// fix gates auto-distill on the list-derived session status being "complete".

const SESSION_DETAIL = resolve(import.meta.dir, "../../src/client/pages/SessionDetail.tsx");

/** A complete, not-yet-analyzed session — the only case that should auto-distill. */
const completeUnanalyzed: AutoDistillGuardInput = {
	autoDistillEnabled: true,
	isNotDistilled: true,
	alreadyTriggered: false,
	detailLoading: false,
	summaryStatus: "complete",
};

describe("shouldAutoDistill (B17 live-session guard)", () => {
	test("auto-distills a complete, not-yet-analyzed session", () => {
		expect(shouldAutoDistill(completeUnanalyzed)).toBe(true);
	});

	test("does NOT auto-distill a LIVE (incomplete/active) session — the core B17 bug", () => {
		expect(shouldAutoDistill({ ...completeUnanalyzed, summaryStatus: "incomplete" })).toBe(false);
	});

	test("does NOT auto-distill when the session list summary is missing (not loaded yet)", () => {
		expect(shouldAutoDistill({ ...completeUnanalyzed, summaryStatus: undefined })).toBe(false);
	});

	test("does NOT auto-distill when the preference is off, even for a complete session", () => {
		expect(shouldAutoDistill({ ...completeUnanalyzed, autoDistillEnabled: false })).toBe(false);
	});

	test("does NOT auto-distill an already-distilled session", () => {
		expect(shouldAutoDistill({ ...completeUnanalyzed, isNotDistilled: false })).toBe(false);
	});

	test("does NOT re-trigger once auto-distill has already fired", () => {
		expect(shouldAutoDistill({ ...completeUnanalyzed, alreadyTriggered: true })).toBe(false);
	});

	test("does NOT auto-distill while the detail resource is still loading", () => {
		expect(shouldAutoDistill({ ...completeUnanalyzed, detailLoading: true })).toBe(false);
	});
});

describe("SessionDetail auto-distill effect wiring (B17 source pin)", () => {
	const source = readFileSync(SESSION_DETAIL, "utf-8");

	test("auto-distill effect delegates the decision to shouldAutoDistill", () => {
		expect(source).toContain("shouldAutoDistill(");
	});

	test("the guard is fed the list-derived session status", () => {
		// The live/complete distinction is only knowable from the list summary's
		// status; if this stops being passed the guard silently re-opens the bug.
		expect(source).toContain("summaryStatus: notDistilledSummary()?.status");
	});

	test("auto-distill no longer fires from preference + not_distilled alone", () => {
		// Pin that the old unguarded condition (preference && isNotDistilled &&
		// !triggered && !loading, with no status check) is gone.
		const oldUnguarded = /preferences\(\)\.autoDistill\s*&&\s*\n?\s*isNotDistilled\(\)\s*&&/;
		expect(oldUnguarded.test(source)).toBe(false);
	});
});

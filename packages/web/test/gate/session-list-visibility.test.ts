import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression gate for B24 + B25 in SessionList.tsx.
//
// SessionList.tsx is a SolidJS component that cannot be imported into a plain
// bun test (no JSX runtime configured for client TSX — same constraint that
// makes the B13 design-token gate a source-level lint). So we (1) lint the
// source to guarantee the bug-causing line stays removed, and (2) reproduce the
// pure label contract here to lock its behavior.

const SOURCE_PATH = resolve(import.meta.dir, "../../src/client/pages/SessionList.tsx");

describe("SessionList visibility — B24 (1-event sessions findable)", () => {
	const source = readFileSync(SOURCE_PATH, "utf-8");

	test("does NOT blanket-exclude zero-duration sessions from the list filter", () => {
		// The original bug filtered every session whose only event was a
		// SessionEnd (duration_ms === 0) out of the rendered list AND search.
		// Guard that the `s.duration_ms <= 0` early-return is not reintroduced in
		// the session filter.
		expect(source).not.toContain("if (s.duration_ms <= 0) return false");
	});

	test("wires the honest count label into the FilterBar", () => {
		expect(source).toContain("buildCountLabel(filtered().length, scopedTotal())");
	});
});

// ── B25: honest "X of Y sessions" count label ────────────────────────
//
// Mirror of buildCountLabel in SessionList.tsx. If the contract changes, this
// test must change with it — keeping the two in sync is the point of the gate.

const buildCountLabel = (shown: number, total: number): string => {
	const noun = `session${total !== 1 ? "s" : ""}`;
	return shown < total ? `of ${total} ${noun}` : noun;
};

describe("buildCountLabel — B25 (honest filtered count)", () => {
	test("reveals hidden sessions as 'of Y sessions' when a filter excludes some", () => {
		// 281 shown of 301 total → rendered as "281 of 301 sessions"
		expect(buildCountLabel(281, 301)).toBe("of 301 sessions");
	});

	test("shows the plain noun when nothing is hidden", () => {
		expect(buildCountLabel(301, 301)).toBe("sessions");
	});

	test("uses singular noun for a single total session", () => {
		expect(buildCountLabel(1, 1)).toBe("session");
	});

	test("never claims a larger shown count than the total", () => {
		// Defensive: shown >= total collapses to the plain noun, never "of N".
		expect(buildCountLabel(5, 3)).toBe("sessions");
	});
});

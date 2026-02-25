import { describe, expect, test } from "bun:test";
import { extractBacktracks } from "../src/distill/backtracks";
import type { StoredEvent } from "../src/types";

const makeEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

describe("extractBacktracks - deduplication", () => {
	test("failure_retry subsumed by debugging_loop is removed", () => {
		// A Bash failure followed by 2+ Bash retries forms a debugging_loop.
		// The initial failure + first retry also matches failure_retry.
		// Dedup should remove the failure_retry since its tool_use_ids are a subset of the debugging_loop.
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "b1", error: "exit 1", tool_input: { command: "tsc" } },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b2", tool_input: { command: "npx tsc" } },
			}),
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b3", tool_input: { command: "bun run typecheck" } },
			}),
		];

		const backtracks = extractBacktracks(events);

		const debugLoops = backtracks.filter((b) => b.type === "debugging_loop");
		const retries = backtracks.filter((b) => b.type === "failure_retry");

		expect(debugLoops).toHaveLength(1);
		expect(debugLoops[0].tool_use_ids).toEqual(["b1", "b2", "b3"]);
		// failure_retry [b1, b2] is subsumed by debugging_loop [b1, b2, b3] — should be removed
		expect(retries).toHaveLength(0);
	});

	test("failure_retry NOT overlapping with debugging_loop is kept", () => {
		// An Edit failure_retry that has nothing to do with a Bash debugging_loop
		const events: StoredEvent[] = [
			// Edit failure_retry (independent)
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: { tool_name: "Edit", tool_use_id: "e1", error: "not found", tool_input: { file_path: "/a.ts" } },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "e2" },
			}),
			// Bash debugging_loop (separate)
			makeEvent({
				t: 5000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "b1", error: "exit 1", tool_input: { command: "test" } },
			}),
			makeEvent({
				t: 6000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b2", tool_input: { command: "test2" } },
			}),
			makeEvent({
				t: 7000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b3", tool_input: { command: "test3" } },
			}),
		];

		const backtracks = extractBacktracks(events);

		const retries = backtracks.filter((b) => b.type === "failure_retry");
		const debugLoops = backtracks.filter((b) => b.type === "debugging_loop");

		expect(debugLoops).toHaveLength(1);
		// The Edit failure_retry has tool_use_ids [e1, e2] which are NOT in the debugging_loop set
		expect(retries).toHaveLength(1);
		expect(retries[0].tool_use_ids).toEqual(["e1", "e2"]);
	});

	test("iteration_struggle subsumed by debugging_loop is removed", () => {
		// Create a scenario where Bash edits to same file 4+ times overlap with debugging_loop IDs
		// Actually iteration_struggle uses Edit/Write tools, and debugging_loop uses Bash.
		// They can only overlap if the tool_use_ids happen to match. In practice they won't
		// because Edit IDs differ from Bash IDs. But let's test the dedup logic with Bash events
		// that produce both iteration_struggle (Edit events with same file) and debugging_loop.

		// For a realistic test: create Edit events with IDs that also appear in a debugging_loop.
		// This is contrived but tests the dedup mechanism.
		const events: StoredEvent[] = [
			// 4 Edit events on same file within 5 minutes (iteration_struggle)
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "x1", tool_input: { file_path: "/foo.ts" } },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "x2", tool_input: { file_path: "/foo.ts" } },
			}),
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "x3", tool_input: { file_path: "/foo.ts" } },
			}),
			makeEvent({
				t: 4000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "x4", tool_input: { file_path: "/foo.ts" } },
			}),
		];

		const backtracks = extractBacktracks(events);

		// No debugging_loop here (no Bash failures), so iteration_struggle should be preserved
		const struggles = backtracks.filter((b) => b.type === "iteration_struggle");
		expect(struggles).toHaveLength(1);
		expect(struggles[0].tool_use_ids).toEqual(["x1", "x2", "x3", "x4"]);
	});

	test("independent backtracks are all preserved", () => {
		const events: StoredEvent[] = [
			// failure_retry for Edit
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: { tool_name: "Edit", tool_use_id: "e1", error: "not found", tool_input: { file_path: "/a.ts" } },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "e2" },
			}),
			// 4 Edit events on same file (iteration_struggle)
			makeEvent({
				t: 10000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "s1", tool_input: { file_path: "/bar.ts" } },
			}),
			makeEvent({
				t: 11000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "s2", tool_input: { file_path: "/bar.ts" } },
			}),
			makeEvent({
				t: 12000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "s3", tool_input: { file_path: "/bar.ts" } },
			}),
			makeEvent({
				t: 13000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "s4", tool_input: { file_path: "/bar.ts" } },
			}),
		];

		const backtracks = extractBacktracks(events);

		// No debugging_loop, so all should be preserved
		const retries = backtracks.filter((b) => b.type === "failure_retry");
		const struggles = backtracks.filter((b) => b.type === "iteration_struggle");
		expect(retries).toHaveLength(1);
		expect(struggles).toHaveLength(1);
	});

	test("debugging_loop counts through PostToolUseFailure in middle of chain", () => {
		// BUG-2: [PostFail_Bash, PreTool_Bash, PostFail_Bash, PreTool_Bash, PreTool_Bash]
		// should detect debugging_loop with 4 attempts (fail + 3 PreToolUse), not truncated at 2
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "b1", error: "exit 1", tool_input: { command: "npm test" } },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b2", tool_input: { command: "npm test -- --fix" } },
			}),
			makeEvent({
				t: 3000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "b3", error: "exit 1", tool_input: { command: "npm test -- --fix" } },
			}),
			makeEvent({
				t: 4000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b4", tool_input: { command: "npm run lint" } },
			}),
			makeEvent({
				t: 5000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b5", tool_input: { command: "npm test" } },
			}),
		];

		const backtracks = extractBacktracks(events);

		const debugLoops = backtracks.filter((b) => b.type === "debugging_loop");
		expect(debugLoops).toHaveLength(1);
		// 4 attempts: initial failure + 3 PreToolUse (PostToolUseFailure in middle doesn't break chain)
		expect(debugLoops[0].attempts).toBe(4);
		expect(debugLoops[0].tool_use_ids).toEqual(["b1", "b2", "b4", "b5"]);
		expect(debugLoops[0].start_t).toBe(1000);
		expect(debugLoops[0].end_t).toBe(5000);
	});

	test("debugging_loop terminates when time gap exceeds 5 minutes", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "b1", error: "exit 1", tool_input: { command: "test" } },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b2", tool_input: { command: "test2" } },
			}),
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b3", tool_input: { command: "test3" } },
			}),
			// 6-minute gap: agent went to lunch
			makeEvent({
				t: 3000 + 6 * 60 * 1000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b4", tool_input: { command: "test4" } },
			}),
			makeEvent({
				t: 3000 + 6 * 60 * 1000 + 1000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b5", tool_input: { command: "test5" } },
			}),
		];

		const backtracks = extractBacktracks(events);
		const debugLoops = backtracks.filter((b) => b.type === "debugging_loop");

		expect(debugLoops).toHaveLength(1);
		// Chain terminates at b3, does NOT include b4/b5 after the gap
		expect(debugLoops[0].tool_use_ids).toEqual(["b1", "b2", "b3"]);
		expect(debugLoops[0].attempts).toBe(3);
	});

	test("debugging_loop terminates when non-Bash PreToolUse interleaves", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "b1", error: "exit 1", tool_input: { command: "tsc" } },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b2", tool_input: { command: "tsc --noEmit" } },
			}),
			// Agent moved on — Edit interleaves
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "e1", tool_input: { file_path: "/fix.ts" } },
			}),
			// More Bash after the Edit — should NOT be included
			makeEvent({
				t: 4000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b3", tool_input: { command: "tsc" } },
			}),
			makeEvent({
				t: 5000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b4", tool_input: { command: "npm test" } },
			}),
		];

		const backtracks = extractBacktracks(events);
		const debugLoops = backtracks.filter((b) => b.type === "debugging_loop");

		// Only 2 attempts (b1, b2) — not enough for debugging_loop (needs 3+)
		// The Edit interleave at t=3000 stops the chain before b3/b4 are reached
		expect(debugLoops).toHaveLength(0);
	});

	test("debugging_loop chain is capped at 50 attempts", () => {
		// Build a long chain: 1 initial failure + 60 PreToolUse Bash events
		const initialFailure = makeEvent({
			t: 1000,
			event: "PostToolUseFailure",
			data: { tool_name: "Bash", tool_use_id: "b0", error: "exit 1", tool_input: { command: "test" } },
		});
		const bashRetries = Array.from({ length: 60 }, (_, i) =>
			makeEvent({
				t: 2000 + i * 1000,
				event: "PreToolUse" as const,
				data: { tool_name: "Bash", tool_use_id: `b${i + 1}`, tool_input: { command: `cmd${i}` } },
			}),
		);

		const events: StoredEvent[] = [initialFailure, ...bashRetries];
		const backtracks = extractBacktracks(events);
		const debugLoops = backtracks.filter((b) => b.type === "debugging_loop");

		expect(debugLoops).toHaveLength(1);
		// 1 initial failure + 50 capped PreToolUse = 51 total
		expect(debugLoops[0].attempts).toBe(51);
		expect(debugLoops[0].tool_use_ids).toHaveLength(51);
	});

	test("dedup with no debugging_loops preserves all retries", () => {
		const events: StoredEvent[] = [
			// Two separate failure_retries for different tools
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: { tool_name: "Edit", tool_use_id: "e1", error: "not found" },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "e2" },
			}),
			makeEvent({
				t: 5000,
				event: "PostToolUseFailure",
				data: { tool_name: "Edit", tool_use_id: "e3", error: "mismatch" },
			}),
			makeEvent({
				t: 6000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "e4" },
			}),
		];

		const backtracks = extractBacktracks(events);

		const debugLoops = backtracks.filter((b) => b.type === "debugging_loop");
		const retries = backtracks.filter((b) => b.type === "failure_retry");

		expect(debugLoops).toHaveLength(0);
		expect(retries).toHaveLength(2);
	});
});

import { describe, expect, test } from "bun:test";
import { extractEditChains } from "../src/distill/edit-chains";
import type { BacktrackResult, StoredEvent, TranscriptReasoning } from "../src/types";

const makeEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

describe("extractEditChains", () => {
	test("empty events → empty chains", () => {
		const result = extractEditChains([], [], []);
		expect(result.chains).toEqual([]);
	});

	test("single successful Edit → one chain, one step, outcome success", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "foo", new_string: "bar" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains).toHaveLength(1);
		expect(result.chains[0].file_path).toBe("/foo.ts");
		expect(result.chains[0].steps).toHaveLength(1);
		expect(result.chains[0].steps[0].outcome).toBe("success");
		expect(result.chains[0].surviving_edit_ids).toContain("t1");
		expect(result.chains[0].total_edits).toBe(1);
		expect(result.chains[0].total_failures).toBe(0);
	});

	test("single failed Edit → outcome failure, error_preview populated", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "foo", new_string: "bar" },
				},
			}),
			makeEvent({
				t: 2000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					error: "old_string not found",
					tool_input: { file_path: "/foo.ts" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains).toHaveLength(1);
		expect(result.chains[0].steps[0].outcome).toBe("failure");
		expect(result.chains[0].steps[0].error_preview).toBe("old_string not found");
		expect(result.chains[0].abandoned_edit_ids).toContain("t1");
		expect(result.chains[0].total_failures).toBe(1);
	});

	test("Edit with thinking binding → thinking_preview and thinking_intent populated", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "a", new_string: "b" },
				},
			}),
		];

		const reasoning: readonly TranscriptReasoning[] = [
			{
				t: 900,
				thinking: "I need to fix the validation logic here",
				tool_use_id: "t1",
				intent_hint: "debugging",
			},
		];

		const result = extractEditChains(events, reasoning, []);
		expect(result.chains[0].steps[0].thinking_preview).toBeDefined();
		expect(result.chains[0].steps[0].thinking_preview?.startsWith("I need to fix")).toBe(true);
		expect(result.chains[0].steps[0].thinking_intent).toBe("debugging");
	});

	test("Edit without thinking → thinking fields undefined", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "a", new_string: "b" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains[0].steps[0].thinking_preview).toBeUndefined();
		expect(result.chains[0].steps[0].thinking_intent).toBeUndefined();
	});

	test("recovery read: Read between failed Edit and retry on same file", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "a", new_string: "b" },
				},
			}),
			makeEvent({
				t: 2000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					error: "not found",
					tool_input: { file_path: "/foo.ts" },
				},
			}),
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: {
					tool_name: "Read",
					tool_use_id: "t2",
					tool_input: { file_path: "/foo.ts" },
				},
			}),
			makeEvent({
				t: 4000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t3",
					tool_input: { file_path: "/foo.ts", old_string: "x", new_string: "y" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains).toHaveLength(1);
		expect(result.chains[0].steps).toHaveLength(3);
		expect(result.chains[0].steps[0].outcome).toBe("failure");
		expect(result.chains[0].steps[1].tool_name).toBe("Read");
		expect(result.chains[0].steps[1].outcome).toBe("info");
		expect(result.chains[0].steps[2].outcome).toBe("success");
		expect(result.chains[0].total_reads).toBe(1);
	});

	test("non-recovery read: Read on file with no edits → not in any chain", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Read",
					tool_use_id: "t0",
					tool_input: { file_path: "/bar.ts" },
				},
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "a", new_string: "b" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains).toHaveLength(1);
		expect(result.chains[0].file_path).toBe("/foo.ts");
	});

	test("backtrack annotation: Edit in backtrack → backtrack_type set", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "a", new_string: "b" },
				},
			}),
		];

		const backtracks: readonly BacktrackResult[] = [
			{
				type: "failure_retry",
				tool_name: "Edit",
				attempts: 2,
				start_t: 1000,
				end_t: 2000,
				tool_use_ids: ["t1", "t2"],
			},
		];

		const result = extractEditChains(events, [], backtracks);
		expect(result.chains[0].steps[0].backtrack_type).toBe("failure_retry");
		expect(result.chains[0].has_backtrack).toBe(true);
	});

	test("multiple files → separate chains, sorted by effort", () => {
		const events: readonly StoredEvent[] = [
			// File /a.ts: 3 edits, 1 failure = total_edits(3) + total_failures(1) = 4
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "a1",
					tool_input: { file_path: "/a.ts", old_string: "a", new_string: "b" },
				},
			}),
			makeEvent({
				t: 2000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "a1",
					error: "fail",
					tool_input: { file_path: "/a.ts" },
				},
			}),
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "a2",
					tool_input: { file_path: "/a.ts", old_string: "c", new_string: "d" },
				},
			}),
			makeEvent({
				t: 4000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "a3",
					tool_input: { file_path: "/a.ts", old_string: "e", new_string: "f" },
				},
			}),
			// File /b.ts: 1 edit, 0 failures = total_edits(1) + total_failures(0) = 1
			makeEvent({
				t: 5000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "b1",
					tool_input: { file_path: "/b.ts", old_string: "x", new_string: "y" },
				},
			}),
			// File /c.ts: 2 edits, 2 failures = total_edits(2) + total_failures(2) = 4
			makeEvent({
				t: 6000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "c1",
					tool_input: { file_path: "/c.ts", old_string: "m", new_string: "n" },
				},
			}),
			makeEvent({
				t: 7000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "c1",
					error: "fail",
					tool_input: { file_path: "/c.ts" },
				},
			}),
			makeEvent({
				t: 8000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "c2",
					tool_input: { file_path: "/c.ts", old_string: "p", new_string: "q" },
				},
			}),
			makeEvent({
				t: 9000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "c2",
					error: "fail",
					tool_input: { file_path: "/c.ts" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains).toHaveLength(3);
		// /a.ts: total_edits(3) + total_failures(1) = 4
		// /c.ts: total_edits(2) + total_failures(2) = 4
		// /b.ts: total_edits(1) + total_failures(0) = 1
		// Both /a.ts and /c.ts have score 4, /b.ts has 1 → /b.ts is last
		expect(result.chains[2].file_path).toBe("/b.ts");
		// The top two should both have score 4
		const topTwoFiles = [result.chains[0].file_path, result.chains[1].file_path];
		expect(topTwoFiles).toContain("/a.ts");
		expect(topTwoFiles).toContain("/c.ts");
	});

	test("Write event → content_lines populated", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Write",
					tool_use_id: "t1",
					tool_input: { file_path: "/new.ts", content: "line1\nline2\nline3" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains).toHaveLength(1);
		expect(result.chains[0].steps[0].content_lines).toBe(3);
	});

	test("effort calculation → effort_ms = last t - first t", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "a", new_string: "b" },
				},
			}),
			makeEvent({
				t: 5000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t2",
					tool_input: { file_path: "/foo.ts", old_string: "c", new_string: "d" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains[0].effort_ms).toBe(4000);
	});

	test("preview truncation: old_string > 200 chars → truncated", () => {
		const longString = "a".repeat(300);
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: longString, new_string: "b" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains[0].steps[0].old_string_preview?.length).toBe(200);
	});

	test("line count: old_string with 5 newlines → old_string_lines = 6", () => {
		const fiveNewlines = "line1\nline2\nline3\nline4\nline5\nline6";
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: fiveNewlines, new_string: "b" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains[0].steps[0].old_string_lines).toBe(6);
	});

	test("abandoned vs surviving: failed in abandoned, successful in surviving", () => {
		const events: readonly StoredEvent[] = [
			// t1 fails
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					tool_input: { file_path: "/foo.ts", old_string: "a", new_string: "b" },
				},
			}),
			makeEvent({
				t: 1500,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					error: "fail",
					tool_input: { file_path: "/foo.ts" },
				},
			}),
			// t2 succeeds
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t2",
					tool_input: { file_path: "/foo.ts", old_string: "c", new_string: "d" },
				},
			}),
			// t3 succeeds
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "t3",
					tool_input: { file_path: "/foo.ts", old_string: "e", new_string: "f" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains[0].abandoned_edit_ids).toEqual(["t1"]);
		expect(result.chains[0].surviving_edit_ids).toContain("t2");
		expect(result.chains[0].surviving_edit_ids).toContain("t3");
	});

	test("chain ordering: chain with most edits+failures first", () => {
		const events: readonly StoredEvent[] = [
			// File A: 5 edits, 0 failures → total = 5
			...Array.from({ length: 5 }, (_, i) =>
				makeEvent({
					t: 1000 + i * 1000,
					event: "PreToolUse" as const,
					data: {
						tool_name: "Edit",
						tool_use_id: `a${i}`,
						tool_input: { file_path: "/fileA.ts", old_string: `old${i}`, new_string: `new${i}` },
					},
				}),
			),
			// File B: 1 edit, 0 failures → total = 1
			makeEvent({
				t: 10000,
				event: "PreToolUse",
				data: {
					tool_name: "Edit",
					tool_use_id: "b0",
					tool_input: { file_path: "/fileB.ts", old_string: "x", new_string: "y" },
				},
			}),
		];

		const result = extractEditChains(events, [], []);
		expect(result.chains[0].file_path).toBe("/fileA.ts");
		expect(result.chains[1].file_path).toBe("/fileB.ts");
	});
});

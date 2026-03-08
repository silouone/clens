import { describe, expect, test } from "bun:test";
import { buildConversation } from "../src/session/conversation";
import type { DistilledSession, StoredEvent } from "../src/types";

const makeDistilled = (overrides: Partial<DistilledSession> = {}): DistilledSession => ({
	session_id: "test-session",
	stats: {
		total_events: 0,
		duration_ms: 0,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 0,
		failure_count: 0,
		failure_rate: 0,
		unique_files: [],
	},
	backtracks: [],
	decisions: [],
	file_map: { files: [] },
	git_diff: { commits: [], hunks: [] },
	complete: true,
	reasoning: [],
	user_messages: [],
	...overrides,
});

const makeEvent = (overrides: Partial<StoredEvent> & Pick<StoredEvent, "t" | "event">): StoredEvent => ({
	sid: "test-session",
	data: {},
	...overrides,
});

describe("buildConversation", () => {
	test("returns empty array for empty inputs", () => {
		const result = buildConversation(makeDistilled(), []);
		expect(result).toEqual([]);
	});

	test("maps user_messages to user_prompt entries", () => {
		const distilled = makeDistilled({
			user_messages: [
				{ t: 1000, content: "Hello", is_tool_result: false, message_type: "prompt" },
				{ t: 2000, content: "Fix bug", is_tool_result: false, message_type: "prompt" },
			],
		});
		const result = buildConversation(distilled, []);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ type: "user_prompt", t: 1000, text: "Hello", index: 0 });
		expect(result[1]).toMatchObject({ type: "user_prompt", t: 2000, text: "Fix bug", index: 1 });
	});

	test("filters out tool_result and system user_messages", () => {
		const distilled = makeDistilled({
			user_messages: [
				{ t: 1000, content: "Hello", is_tool_result: false, message_type: "prompt" },
				{ t: 1500, content: "tool output", is_tool_result: true },
				{ t: 1800, content: "system msg", is_tool_result: false, message_type: "system" },
			],
		});
		const result = buildConversation(distilled, []);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ type: "user_prompt", text: "Hello" });
	});

	test("maps reasoning to thinking entries with intent", () => {
		const distilled = makeDistilled({
			reasoning: [
				{ t: 1000, thinking: "Let me plan this", intent_hint: "planning" },
				{ t: 2000, thinking: "Investigating the bug", intent_hint: "debugging" },
				{ t: 3000, thinking: "Hmm what to do" },
			],
		});
		const result = buildConversation(distilled, []);
		expect(result).toHaveLength(3);
		expect(result[0]).toMatchObject({ type: "thinking", intent: "planning" });
		expect(result[1]).toMatchObject({ type: "thinking", intent: "debugging" });
		expect(result[2]).toMatchObject({ type: "thinking", intent: "general" });
	});

	test("maps PreToolUse events to tool_call entries", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Read",
					tool_use_id: "tu-1",
					tool_input: { file_path: "/src/index.ts" },
				},
			}),
		];
		const result = buildConversation(makeDistilled(), events);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "tool_call",
			tool_name: "Read",
			tool_use_id: "tu-1",
			file_path: "/src/index.ts",
		});
	});

	test("extracts file_path from tool_input.path fallback", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Glob",
					tool_use_id: "tu-2",
					tool_input: { path: "/src" },
				},
			}),
		];
		const result = buildConversation(makeDistilled(), events);
		expect(result[0]).toMatchObject({ type: "tool_call", file_path: "/src" });
	});

	test("maps PostToolUse to success tool_result", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUse",
				data: { tool_name: "Read", tool_use_id: "tu-1" },
			}),
		];
		const result = buildConversation(makeDistilled(), events);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "tool_result",
			outcome: "success",
			tool_name: "Read",
			tool_use_id: "tu-1",
		});
	});

	test("maps PostToolUseFailure to failure tool_result with error", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "tu-3",
					error: "old_string not found",
				},
			}),
		];
		const result = buildConversation(makeDistilled(), events);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "tool_result",
			outcome: "failure",
			error: "old_string not found",
		});
	});

	test("maps backtracks at start_t", () => {
		const distilled = makeDistilled({
			backtracks: [
				{
					type: "failure_retry",
					tool_name: "Edit",
					attempts: 3,
					start_t: 5000,
					end_t: 8000,
					tool_use_ids: ["tu-1", "tu-2", "tu-3"],
				},
			],
		});
		const result = buildConversation(distilled, []);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "backtrack",
			t: 5000,
			backtrack_type: "failure_retry",
			attempt: 3,
			reverted_tool_ids: ["tu-1", "tu-2", "tu-3"],
		});
	});

	test("maps summary phases to phase_boundary entries", () => {
		const distilled = makeDistilled({
			summary: {
				narrative: "Test session",
				phases: [
					{ name: "Setup", start_t: 1000, end_t: 3000, tool_types: ["Read"], description: "Reading files" },
					{ name: "Build", start_t: 3000, end_t: 7000, tool_types: ["Edit", "Write"], description: "Writing code" },
				],
				key_metrics: {
					duration_human: "6s",
					tool_calls: 5,
					failures: 0,
					files_modified: 2,
					backtrack_count: 0,
				},
			},
		});
		const result = buildConversation(distilled, []);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ type: "phase_boundary", t: 1000, phase_name: "Setup", phase_index: 0 });
		expect(result[1]).toMatchObject({ type: "phase_boundary", t: 3000, phase_name: "Build", phase_index: 1 });
	});

	test("handles missing summary gracefully", () => {
		const distilled = makeDistilled({ summary: undefined });
		const result = buildConversation(distilled, []);
		expect(result).toEqual([]);
	});

	test("sorts all entry types by t", () => {
		const distilled = makeDistilled({
			user_messages: [
				{ t: 1000, content: "Start", is_tool_result: false, message_type: "prompt" },
				{ t: 5000, content: "Next step", is_tool_result: false, message_type: "prompt" },
			],
			reasoning: [
				{ t: 2000, thinking: "Planning...", intent_hint: "planning" },
			],
			backtracks: [
				{
					type: "iteration_struggle",
					tool_name: "Edit",
					attempts: 2,
					start_t: 4000,
					end_t: 4500,
					tool_use_ids: ["tu-x"],
				},
			],
			summary: {
				narrative: "test",
				phases: [
					{ name: "Init", start_t: 500, end_t: 1000, tool_types: [], description: "init" },
				],
				key_metrics: {
					duration_human: "5s",
					tool_calls: 2,
					failures: 0,
					files_modified: 1,
					backtrack_count: 1,
				},
			},
		});

		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: { tool_name: "Read", tool_use_id: "tu-r", tool_input: {} },
			}),
			makeEvent({
				t: 3500,
				event: "PostToolUse",
				data: { tool_name: "Read", tool_use_id: "tu-r" },
			}),
		];

		const result = buildConversation(distilled, events);

		// Verify sorted by t
		const timestamps = result.map((e) => e.t);
		const sorted = [...timestamps].sort((a, b) => a - b);
		expect(timestamps).toEqual(sorted);

		// Verify all types present
		const types = new Set(result.map((e) => e.type));
		expect(types.has("phase_boundary")).toBe(true);
		expect(types.has("user_prompt")).toBe(true);
		expect(types.has("thinking")).toBe(true);
		expect(types.has("tool_call")).toBe(true);
		expect(types.has("tool_result")).toBe(true);
		expect(types.has("backtrack")).toBe(true);
	});

	test("skips events missing tool_use_id or tool_name", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: { tool_name: "Read" }, // missing tool_use_id
			}),
			makeEvent({
				t: 2000,
				event: "PostToolUse",
				data: { tool_use_id: "tu-1" }, // missing tool_name
			}),
		];
		const result = buildConversation(makeDistilled(), events);
		expect(result).toEqual([]);
	});

	test("generates args_preview truncated to ~100 chars", () => {
		const longInput = { file_path: "/a".repeat(200) };
		const events: readonly StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Read",
					tool_use_id: "tu-1",
					tool_input: longInput,
				},
			}),
		];
		const result = buildConversation(makeDistilled(), events);
		const entry = result[0];
		expect(entry.type).toBe("tool_call");
		if (entry.type === "tool_call") {
			expect(entry.args_preview.length).toBeLessThanOrEqual(104); // 100 + "..."
		}
	});
});

import { describe, expect, test } from "bun:test";
import { buildConversationFromTranscript } from "../src/session/conversation";
import type { AgentMessage, AgentNode, BacktrackResult, TranscriptEntry } from "../src/types";

// --- Factories ---

const makeTranscriptEntry = (
	overrides: Partial<TranscriptEntry> & Pick<TranscriptEntry, "type">,
): TranscriptEntry => ({
	uuid: "uuid-1",
	parentUuid: null,
	sessionId: "agent-1",
	timestamp: "2024-01-01T00:00:01.000Z",
	...overrides,
});

const makeAgentNode = (overrides: Partial<AgentNode> = {}): AgentNode => ({
	session_id: "agent-1",
	agent_type: "builder",
	duration_ms: 5000,
	tool_call_count: 0,
	children: [],
	...overrides,
});

const makeBacktrack = (overrides: Partial<BacktrackResult> = {}): BacktrackResult => ({
	type: "failure_retry",
	tool_name: "Edit",
	attempts: 2,
	start_t: 3000,
	end_t: 4000,
	tool_use_ids: ["tu-1", "tu-2"],
	...overrides,
});

const makeAgentMessage = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
	t: 2000,
	direction: "received",
	partner: "orchestrator",
	msg_type: "task_assign",
	...overrides,
});

// --- Tests ---

describe("buildConversationFromTranscript", () => {
	// 1. Empty transcript
	test("returns empty array for empty transcript with no agent", () => {
		const result = buildConversationFromTranscript([]);
		expect(result).toEqual([]);
	});

	test("returns empty array for empty transcript with empty agent node", () => {
		const result = buildConversationFromTranscript([], makeAgentNode());
		expect(result).toEqual([]);
	});

	// 2. User prompts from transcript
	test("extracts user prompt from transcript entry with string content", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: { role: "user", content: "Fix the bug" },
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "user_prompt",
			text: "Fix the bug",
			t: new Date("2024-01-01T00:00:01.000Z").getTime(),
		});
	});

	test("extracts user prompt from transcript entry with array content (text blocks)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "user",
					content: [
						{ type: "text", text: "Hello " },
						{ type: "text", text: "world" },
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "user_prompt",
			text: "Hello \nworld",
		});
	});

	test("skips user entries with no message content", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: { role: "user", content: "" },
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toEqual([]);
	});

	test("skips assistant entries when looking for user prompts", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: { role: "assistant", content: "Sure, I can help." },
			}),
		];
		const result = buildConversationFromTranscript(entries);
		// assistant entries with string content have no tool_use/thinking blocks — empty result
		expect(result).toEqual([]);
	});

	// 3. Tool calls from assistant entries
	test("extracts tool call entries from assistant transcript content blocks", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:05.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tu-123",
							name: "Read",
							input: { file_path: "/src/index.ts" },
						},
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "tool_call",
			tool_name: "Read",
			tool_use_id: "tu-123",
			file_path: "/src/index.ts",
			t: new Date("2024-01-01T00:00:05.000Z").getTime(),
		});
	});

	test("extracts file_path from tool_input.path fallback", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:06.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tu-456",
							name: "Glob",
							input: { path: "/src" },
						},
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "tool_call",
			tool_name: "Glob",
			file_path: "/src",
		});
	});

	test("handles tool_use with no file_path or path field", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:07.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tu-789",
							name: "Bash",
							input: { command: "ls -la" },
						},
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ type: "tool_call", tool_name: "Bash" });
		if (result[0].type === "tool_call") {
			expect(result[0].file_path).toBeUndefined();
		}
	});

	test("extracts multiple tool calls from a single assistant entry", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:08.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tu-a", name: "Read", input: { file_path: "/a.ts" } },
						{ type: "tool_use", id: "tu-b", name: "Edit", input: { file_path: "/b.ts" } },
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ type: "tool_call", tool_use_id: "tu-a" });
		expect(result[1]).toMatchObject({ type: "tool_call", tool_use_id: "tu-b" });
	});

	// 4. Tool results from user entries
	test("extracts tool_result success from user transcript content blocks", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:10.000Z",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tu-123",
							content: "File contents here",
						},
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "tu-123",
			outcome: "success",
			t: new Date("2024-01-01T00:00:10.000Z").getTime(),
		});
	});

	test("extracts tool_result failure with is_error and error message", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:11.000Z",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tu-456",
							content: "old_string not found",
							is_error: true,
						},
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "tu-456",
			outcome: "failure",
			error: "old_string not found",
		});
	});

	test("tool_result has tool_name 'unknown' (not extractable from transcript)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:12.000Z",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tu-789",
							content: "ok",
						},
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ type: "tool_result", tool_name: "unknown" });
	});

	// 5. Thinking blocks from assistant entries
	test("extracts thinking entries from assistant transcript content blocks", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Let me analyze the code first." },
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "thinking",
			text: "Let me analyze the code first.",
			intent: "general",
			t: new Date("2024-01-01T00:00:03.000Z").getTime(),
		});
	});

	test("extracts multiple thinking blocks from a single assistant entry", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:04.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "First thought." },
						{ type: "thinking", thinking: "Second thought." },
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ type: "thinking", text: "First thought." });
		expect(result[1]).toMatchObject({ type: "thinking", text: "Second thought." });
	});

	// 6. Agent reasoning from AgentNode — prefers over transcript thinking
	test("prefers agent reasoning over transcript thinking blocks", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:04.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Raw transcript thinking (less rich)." },
					],
				},
			}),
		];
		const agent = makeAgentNode({
			reasoning: [
				{
					t: 5000,
					thinking: "Agent reasoning with intent hint.",
					intent_hint: "planning",
				},
			],
		});
		const result = buildConversationFromTranscript(entries, agent);
		const thinkingEntries = result.filter((e) => e.type === "thinking");
		expect(thinkingEntries).toHaveLength(1);
		expect(thinkingEntries[0]).toMatchObject({
			type: "thinking",
			text: "Agent reasoning with intent hint.",
			intent: "planning",
			t: 5000,
		});
	});

	test("falls back to transcript thinking when agent has no reasoning", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "assistant",
				timestamp: "2024-01-01T00:00:04.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Transcript thinking used." },
					],
				},
			}),
		];
		const agent = makeAgentNode({ reasoning: [] });
		const result = buildConversationFromTranscript(entries, agent);
		const thinkingEntries = result.filter((e) => e.type === "thinking");
		expect(thinkingEntries).toHaveLength(1);
		expect(thinkingEntries[0]).toMatchObject({
			type: "thinking",
			text: "Transcript thinking used.",
		});
	});

	test("agent reasoning uses intent_hint with fallback to 'general'", () => {
		const agent = makeAgentNode({
			reasoning: [
				{ t: 1000, thinking: "No hint here." },
				{ t: 2000, thinking: "Debug thought.", intent_hint: "debugging" },
			],
		});
		const result = buildConversationFromTranscript([], agent);
		const thinkingEntries = result.filter((e) => e.type === "thinking");
		expect(thinkingEntries).toHaveLength(2);
		expect(thinkingEntries[0]).toMatchObject({ intent: "general" });
		expect(thinkingEntries[1]).toMatchObject({ intent: "debugging" });
	});

	// 7. Agent backtracks from AgentNode
	test("includes backtrack entries from agent node", () => {
		const agent = makeAgentNode({
			backtracks: [
				makeBacktrack({
					type: "iteration_struggle",
					tool_name: "Edit",
					attempts: 3,
					start_t: 6000,
					end_t: 7000,
					tool_use_ids: ["tu-x", "tu-y", "tu-z"],
				}),
			],
		});
		const result = buildConversationFromTranscript([], agent);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "backtrack",
			t: 6000,
			backtrack_type: "iteration_struggle",
			attempt: 3,
			reverted_tool_ids: ["tu-x", "tu-y", "tu-z"],
		});
	});

	test("includes multiple backtracks from agent node", () => {
		const agent = makeAgentNode({
			backtracks: [
				makeBacktrack({ start_t: 1000, type: "failure_retry" }),
				makeBacktrack({ start_t: 2000, type: "debugging_loop" }),
			],
		});
		const result = buildConversationFromTranscript([], agent);
		const backtracks = result.filter((e) => e.type === "backtrack");
		expect(backtracks).toHaveLength(2);
	});

	// 8. Agent messages from AgentNode
	test("includes inter-agent messages from agent node", () => {
		const agent = makeAgentNode({
			messages: [
				makeAgentMessage({
					t: 8000,
					direction: "sent",
					partner: "sub-agent",
					msg_type: "task_assign",
					summary: "Please fix the tests",
				}),
			],
		});
		const result = buildConversationFromTranscript([], agent);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: "agent_message",
			t: 8000,
			direction: "sent",
			partner: "sub-agent",
			msg_type: "task_assign",
			summary: "Please fix the tests",
		});
	});

	test("agent_message without summary omits summary field", () => {
		const agent = makeAgentNode({
			messages: [
				makeAgentMessage({ t: 9000, summary: undefined }),
			],
		});
		const result = buildConversationFromTranscript([], agent);
		expect(result).toHaveLength(1);
		expect(result[0].type).toBe("agent_message");
		if (result[0].type === "agent_message") {
			expect(result[0].summary).toBeUndefined();
		}
	});

	test("includes received and sent messages from agent node", () => {
		const agent = makeAgentNode({
			messages: [
				makeAgentMessage({ t: 1000, direction: "received", partner: "orchestrator" }),
				makeAgentMessage({ t: 2000, direction: "sent", partner: "sub-agent" }),
			],
		});
		const result = buildConversationFromTranscript([], agent);
		const agentMessages = result.filter((e) => e.type === "agent_message");
		expect(agentMessages).toHaveLength(2);
	});

	// 9. Task prompt injection
	test("inserts task_prompt before other entries using agent start time", () => {
		const agent = makeAgentNode({
			task_prompt: "Build the authentication module",
			messages: [
				makeAgentMessage({ t: 5000, direction: "received", partner: "orchestrator" }),
			],
		});
		const result = buildConversationFromTranscript([], agent);
		const taskPromptEntries = result.filter((e) => e.type === "user_prompt");
		expect(taskPromptEntries).toHaveLength(1);
		expect(taskPromptEntries[0]).toMatchObject({
			type: "user_prompt",
			text: "Build the authentication module",
		});
		// task prompt t should be before the earliest agent message (5000 - 1)
		expect(taskPromptEntries[0].t).toBe(4999);
	});

	test("inserts task_prompt at t=0-1 when no agent data to derive start time", () => {
		const agent = makeAgentNode({ task_prompt: "A task with no timing data" });
		const result = buildConversationFromTranscript([], agent);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ type: "user_prompt", text: "A task with no timing data", t: -1 });
	});

	test("does not insert task_prompt when agent has none", () => {
		const agent = makeAgentNode({ task_prompt: undefined });
		const result = buildConversationFromTranscript([], agent);
		expect(result).toEqual([]);
	});

	test("task_prompt is combined with transcript user prompts", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:05.000Z",
				message: { role: "user", content: "Subsequent user message" },
			}),
		];
		const agent = makeAgentNode({
			task_prompt: "Initial task prompt",
			task_events: [{ t: new Date("2024-01-01T00:00:05.000Z").getTime(), action: "create", task_id: "t-1" }],
		});
		const result = buildConversationFromTranscript(entries, agent);
		const prompts = result.filter((e) => e.type === "user_prompt");
		expect(prompts).toHaveLength(2);
	});

	// 10. Sorting — all entries sorted by timestamp
	test("sorts all entry types by timestamp", () => {
		const t5 = new Date("2024-01-01T00:00:05.000Z").getTime();
		const t3 = new Date("2024-01-01T00:00:03.000Z").getTime();
		const t1 = new Date("2024-01-01T00:00:01.000Z").getTime();

		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:05.000Z",
				message: { role: "user", content: "User message at t5" },
			}),
			makeTranscriptEntry({
				uuid: "uuid-2",
				type: "assistant",
				timestamp: "2024-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tu-a", name: "Read", input: { file_path: "/x.ts" } },
					],
				},
			}),
			makeTranscriptEntry({
				uuid: "uuid-3",
				type: "user",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "tu-a", content: "ok" },
					],
				},
			}),
		];

		const agent = makeAgentNode({
			reasoning: [{ t: t3 + 500, thinking: "Mid-point reasoning.", intent_hint: "deciding" }],
			backtracks: [makeBacktrack({ start_t: t5 + 1000 })],
			messages: [makeAgentMessage({ t: t1 - 500 })],
		});

		const result = buildConversationFromTranscript(entries, agent);
		const timestamps = result.map((e) => e.t);
		const sorted = [...timestamps].sort((a, b) => a - b);
		expect(timestamps).toEqual(sorted);
	});

	test("correctly sorts mixed entry types across multiple transcript entries", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				uuid: "uuid-user-1",
				type: "user",
				timestamp: "2024-01-01T00:00:10.000Z",
				message: { role: "user", content: "Second user message" },
			}),
			makeTranscriptEntry({
				uuid: "uuid-user-0",
				type: "user",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: { role: "user", content: "First user message" },
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ type: "user_prompt", text: "First user message" });
		expect(result[1]).toMatchObject({ type: "user_prompt", text: "Second user message" });
	});

	// Edge cases
	test("ignores non-user/assistant entry types (progress, file-history-snapshot)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "progress",
				timestamp: "2024-01-01T00:00:01.000Z",
				data: { progress: 50 },
			}),
			makeTranscriptEntry({
				uuid: "uuid-2",
				type: "file-history-snapshot",
				timestamp: "2024-01-01T00:00:02.000Z",
				data: { snapshot: {} },
			}),
		];
		const result = buildConversationFromTranscript(entries);
		expect(result).toEqual([]);
	});

	test("handles user entry with only tool_result blocks (no text), produces no user_prompt", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:05.000Z",
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "tu-x", content: "result text" },
					],
				},
			}),
		];
		const result = buildConversationFromTranscript(entries);
		// tool_result blocks do not produce user_prompt entries
		const prompts = result.filter((e) => e.type === "user_prompt");
		expect(prompts).toHaveLength(0);
		// but they do produce tool_result entries
		const results = result.filter((e) => e.type === "tool_result");
		expect(results).toHaveLength(1);
	});

	test("all agent data combined with transcript entries in single call", () => {
		const entries: readonly TranscriptEntry[] = [
			makeTranscriptEntry({
				type: "user",
				timestamp: "2024-01-01T00:00:02.000Z",
				message: { role: "user", content: "User input" },
			}),
			makeTranscriptEntry({
				uuid: "uuid-assistant",
				type: "assistant",
				timestamp: "2024-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tu-1", name: "Edit", input: { file_path: "/main.ts" } },
					],
				},
			}),
		];
		const agent = makeAgentNode({
			task_prompt: "Task: update the module",
			messages: [makeAgentMessage({ t: new Date("2024-01-01T00:00:02.000Z").getTime() })],
			backtracks: [makeBacktrack({ start_t: new Date("2024-01-01T00:00:04.000Z").getTime() })],
			reasoning: [
				{
					t: new Date("2024-01-01T00:00:01.000Z").getTime(),
					thinking: "Planning the approach.",
					intent_hint: "planning",
				},
			],
		});

		const result = buildConversationFromTranscript(entries, agent);

		// All entry types should be present
		const types = new Set(result.map((e) => e.type));
		expect(types.has("user_prompt")).toBe(true);
		expect(types.has("tool_call")).toBe(true);
		expect(types.has("thinking")).toBe(true);
		expect(types.has("agent_message")).toBe(true);
		expect(types.has("backtrack")).toBe(true);

		// Must be sorted
		const timestamps = result.map((e) => e.t);
		expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
	});
});

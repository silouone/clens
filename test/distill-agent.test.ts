import { describe, expect, test } from "bun:test";
import {
	distillAgent,
	extractAgentModel,
	extractTaskPrompt,
	extractTokenUsage,
	transcriptToEvents,
} from "../src/distill/agent-distill";
import { extractFileMap } from "../src/distill/file-map";
import { readTranscript } from "../src/session/transcript";
import type { TranscriptEntry } from "../src/types";

const makeAssistantEntry = (overrides: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
	uuid: "uuid-1",
	parentUuid: null,
	sessionId: "session-1",
	type: "assistant",
	timestamp: "2024-01-01T00:00:01.000Z",
	message: {
		role: "assistant",
		content: [],
	},
	...overrides,
});

const makeUserEntry = (overrides: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
	uuid: "uuid-u1",
	parentUuid: null,
	sessionId: "session-1",
	type: "user",
	timestamp: "2024-01-01T00:00:00.000Z",
	message: {
		role: "user",
		content: "Hello",
	},
	...overrides,
});

describe("transcriptToEvents", () => {
	test("converts tool_use blocks to StoredEvent with PreToolUse", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_01",
							name: "Read",
							input: { file_path: "/src/foo.ts" },
						},
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("PreToolUse");
		expect(events[0].data.tool_name).toBe("Read");
		expect(events[0].data.tool_use_id).toBe("toolu_01");
		expect(events[0].data.tool_input).toEqual({ file_path: "/src/foo.ts" });
	});

	test("sets sid from entry sessionId", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				sessionId: "agent-42",
				message: {
					role: "assistant",
					content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events[0].sid).toBe("agent-42");
	});

	test("sets timestamp from entry timestamp", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				timestamp: "2024-06-15T12:30:00.000Z",
				message: {
					role: "assistant",
					content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events[0].t).toBe(new Date("2024-06-15T12:30:00.000Z").getTime());
	});

	test("handles multiple tool_use blocks in a single entry", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
						{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/b.ts" } },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(2);
		expect(events[0].data.tool_name).toBe("Read");
		expect(events[1].data.tool_name).toBe("Edit");
	});

	test("filters out thinking blocks", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Let me think about this..." },
						{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(1);
		expect(events[0].data.tool_name).toBe("Read");
	});

	test("filters out text blocks", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "I'll read the file now." },
						{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(1);
	});

	test("skips user entries entirely", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry(),
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(1);
	});

	test("returns empty array for empty entries", () => {
		const events = transcriptToEvents([]);
		expect(events).toEqual([]);
	});

	test("handles entry with string content (no tool_use)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: "Just a text response",
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toEqual([]);
	});

	test("handles entry with no message", () => {
		const entries: readonly TranscriptEntry[] = [
			{
				uuid: "uuid-1",
				parentUuid: null,
				sessionId: "session-1",
				type: "assistant",
				timestamp: "2024-01-01T00:00:01.000Z",
			},
		];

		const events = transcriptToEvents(entries);
		expect(events).toEqual([]);
	});

	test("processes multiple assistant entries across a session", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "a1",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } }],
				},
			}),
			makeUserEntry({ uuid: "u1", timestamp: "2024-01-01T00:00:02.000Z" }),
			makeAssistantEntry({
				uuid: "a2",
				timestamp: "2024-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/a.ts" } },
						{ type: "tool_use", id: "t3", name: "Write", input: { file_path: "/b.ts" } },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(3);
		expect(events[0].data.tool_name).toBe("Read");
		expect(events[1].data.tool_name).toBe("Edit");
		expect(events[2].data.tool_name).toBe("Write");
	});
});

describe("transcriptToEvents - PostToolUseFailure synthesis", () => {
	test("emits PostToolUseFailure for user tool_result with is_error:true", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_01", name: "Bash", input: { command: "rm /nope" } },
					],
				},
			}),
			makeUserEntry({
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_01", content: "Permission denied", is_error: true },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(2);
		expect(events[1].event).toBe("PostToolUseFailure");
		expect(events[1].data.tool_name).toBe("Bash");
		expect(events[1].data.tool_use_id).toBe("toolu_01");
		expect(events[1].data.error).toBe("Permission denied");
	});

	test("does NOT emit PostToolUseFailure for tool_result without is_error", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: "/a.ts" } },
					],
				},
			}),
			makeUserEntry({
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_01", content: "file contents..." },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("PreToolUse");
	});

	test("handles tool_result content as array (JSON-stringifies)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_02", name: "Bash", input: { command: "test" } },
					],
				},
			}),
			makeUserEntry({
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_02",
							content: [{ type: "text", text: "error happened" }] as unknown as string,
							is_error: true,
						},
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const failure = events.find((e) => e.event === "PostToolUseFailure");
		expect(failure).toBeDefined();
		expect(failure?.data.error).toBe(JSON.stringify([{ type: "text", text: "error happened" }]));
	});

	test("uses 'unknown' tool_name when tool_use_id not in map", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry({
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_orphan", content: "error", is_error: true },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe("PostToolUseFailure");
		expect(events[0].data.tool_name).toBe("unknown");
	});

	test("events are sorted by timestamp", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				timestamp: "2024-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_late", name: "Read", input: { file_path: "/b.ts" } },
					],
				},
			}),
			makeAssistantEntry({
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_early", name: "Bash", input: { command: "ls" } },
					],
				},
			}),
			makeUserEntry({
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_early", content: "fail", is_error: true },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		expect(events).toHaveLength(3);
		// Should be sorted: toolu_early (t=1), failure (t=2), toolu_late (t=3)
		expect(events[0].data.tool_use_id).toBe("toolu_early");
		expect(events[1].event).toBe("PostToolUseFailure");
		expect(events[2].data.tool_use_id).toBe("toolu_late");
	});
});

describe("extractTokenUsage", () => {
	test("sums usage across multiple assistant entries", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						cache_read_input_tokens: 10,
						cache_creation_input_tokens: 5,
					},
				},
			}),
			makeAssistantEntry({
				uuid: "uuid-2",
				message: {
					role: "assistant",
					content: [],
					usage: {
						input_tokens: 200,
						output_tokens: 80,
						cache_read_input_tokens: 20,
						cache_creation_input_tokens: 15,
					},
				},
			}),
		];

		const usage = extractTokenUsage(entries);
		expect(usage.input_tokens).toBe(300);
		expect(usage.output_tokens).toBe(130);
		expect(usage.cache_read_tokens).toBe(30);
		expect(usage.cache_creation_tokens).toBe(20);
	});

	test("returns zeros for entries without usage", () => {
		const entries: readonly TranscriptEntry[] = [makeAssistantEntry()];

		const usage = extractTokenUsage(entries);
		expect(usage.input_tokens).toBe(0);
		expect(usage.output_tokens).toBe(0);
		expect(usage.cache_read_tokens).toBe(0);
		expect(usage.cache_creation_tokens).toBe(0);
	});

	test("returns zeros for empty entries", () => {
		const usage = extractTokenUsage([]);
		expect(usage.input_tokens).toBe(0);
		expect(usage.output_tokens).toBe(0);
		expect(usage.cache_read_tokens).toBe(0);
		expect(usage.cache_creation_tokens).toBe(0);
	});

	test("ignores user entries", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry(),
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			}),
		];

		const usage = extractTokenUsage(entries);
		expect(usage.input_tokens).toBe(100);
		expect(usage.output_tokens).toBe(50);
	});

	test("handles partial usage fields gracefully", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [],
					usage: { input_tokens: 100 },
				},
			}),
		];

		const usage = extractTokenUsage(entries);
		expect(usage.input_tokens).toBe(100);
		expect(usage.output_tokens).toBe(0);
		expect(usage.cache_read_tokens).toBe(0);
		expect(usage.cache_creation_tokens).toBe(0);
	});
});

describe("extractAgentModel", () => {
	test("returns model from first assistant entry", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [],
					model: "claude-sonnet-4-20250514",
				},
			}),
		];

		const model = extractAgentModel(entries);
		expect(model).toBe("claude-sonnet-4-20250514");
	});

	test("returns undefined when no assistant entries", () => {
		const entries: readonly TranscriptEntry[] = [makeUserEntry()];
		const model = extractAgentModel(entries);
		expect(model).toBeUndefined();
	});

	test("returns undefined when message has no model", () => {
		const entries: readonly TranscriptEntry[] = [makeAssistantEntry()];

		const model = extractAgentModel(entries);
		expect(model).toBeUndefined();
	});

	test("returns empty array for entries with no content", () => {
		const entries: readonly TranscriptEntry[] = [makeAssistantEntry()];
		const events = transcriptToEvents(entries);
		expect(events).toEqual([]);
	});

	test("uses first assistant entry model, not later ones", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "a1",
				message: { role: "assistant", content: [], model: "claude-opus-4-20250514" },
			}),
			makeAssistantEntry({
				uuid: "a2",
				message: { role: "assistant", content: [], model: "claude-haiku-4-20250414" },
			}),
		];

		const model = extractAgentModel(entries);
		expect(model).toBe("claude-opus-4-20250514");
	});
});

describe("distillAgent", () => {
	test("returns undefined for empty entries", () => {
		const result = distillAgent([]);
		expect(result).toBeUndefined();
	});

	test("returns AgentDistillResult for valid transcript fixture", () => {
		const fixturePath = `${import.meta.dir}/fixtures/transcripts/simple-session.jsonl`;
		const entries = readTranscript(fixturePath);
		const result = distillAgent(entries);
		expect(result).toBeDefined();
		expect(result?.stats.tool_call_count).toBeGreaterThanOrEqual(0);
		expect(result?.token_usage).toBeDefined();
		expect(result?.file_map).toBeDefined();
	});
});

describe("file attribution via transcriptToEvents + extractFileMap", () => {
	// These tests verify the end-to-end path: transcript entries -> events -> file_map

	test("Read tool_use appears in file_map with reads count", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/src/config.ts" } },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find(
			(f: { file_path: string }) => f.file_path === "/src/config.ts",
		);
		expect(entry).toBeDefined();
		expect(entry?.reads).toBe(1);
		expect(entry?.edits).toBe(0);
		expect(entry?.writes).toBe(0);
	});

	test("Edit tool_use appears in file_map with edits count", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "e1",
							name: "Edit",
							input: { file_path: "/src/app.ts", old_string: "foo", new_string: "bar" },
						},
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f: { file_path: string }) => f.file_path === "/src/app.ts");
		expect(entry).toBeDefined();
		expect(entry?.edits).toBe(1);
		expect(entry?.reads).toBe(0);
	});

	test("Write tool_use appears in file_map with writes count", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "w1",
							name: "Write",
							input: { file_path: "/src/new-file.ts", content: "export const x = 1;" },
						},
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find(
			(f: { file_path: string }) => f.file_path === "/src/new-file.ts",
		);
		expect(entry).toBeDefined();
		expect(entry?.writes).toBe(1);
	});

	test("Grep tool_use appears in file_map (tracked as file operation)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "g1",
							name: "Grep",
							input: { path: "/src", pattern: "TODO" },
						},
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f: { file_path: string }) => f.file_path === "/src");
		expect(entry).toBeDefined();
	});

	test("Glob tool_use appears in file_map (tracked as file operation)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "gl1",
							name: "Glob",
							input: { path: "/project", pattern: "**/*.ts" },
						},
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f: { file_path: string }) => f.file_path === "/project");
		expect(entry).toBeDefined();
	});

	test("multiple file operations across entries aggregate correctly", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "a1",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/src/index.ts" } },
					],
				},
			}),
			makeAssistantEntry({
				uuid: "a2",
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "e1",
							name: "Edit",
							input: { file_path: "/src/index.ts", old_string: "a", new_string: "b" },
						},
					],
				},
			}),
			makeAssistantEntry({
				uuid: "a3",
				timestamp: "2024-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "e2",
							name: "Edit",
							input: { file_path: "/src/index.ts", old_string: "c", new_string: "d" },
						},
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f: { file_path: string }) => f.file_path === "/src/index.ts");
		expect(entry).toBeDefined();
		expect(entry?.reads).toBe(1);
		expect(entry?.edits).toBe(2);
	});

	test("non-file tools (Bash, Task) do not appear as file entries", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "b1", name: "Bash", input: { command: "echo hello" } },
						{ type: "tool_use", id: "t1", name: "Task", input: { prompt: "do something" } },
					],
				},
			}),
		];

		const events = transcriptToEvents(entries);
		const fileMap = extractFileMap(events);
		expect(fileMap.files).toHaveLength(0);
	});
});

describe("extractTaskPrompt", () => {
	test("returns string content from first user entry", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry({
				message: { role: "user", content: "Fix the login bug" },
			}),
		];

		expect(extractTaskPrompt(entries)).toBe("Fix the login bug");
	});

	test("returns text block content from array content", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry({
				message: {
					role: "user",
					content: [
						{ type: "text", text: "Implement feature X" },
					],
				},
			}),
		];

		expect(extractTaskPrompt(entries)).toBe("Implement feature X");
	});

	test("returns undefined for empty entries", () => {
		expect(extractTaskPrompt([])).toBeUndefined();
	});

	test("returns undefined when no user entries exist", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: { role: "assistant", content: "I will help you." },
			}),
		];

		expect(extractTaskPrompt(entries)).toBeUndefined();
	});

	test("preserves full content without truncation", () => {
		const longContent = "x".repeat(5000);
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry({
				message: { role: "user", content: longContent },
			}),
		];

		const result = extractTaskPrompt(entries);
		expect(result).toHaveLength(5000);
		expect(result).toBe(longContent);
	});

	test("skips assistant entries, picks first user", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "a1",
				timestamp: "2024-01-01T00:00:00.000Z",
				message: { role: "assistant", content: "Hello!" },
			}),
			makeUserEntry({
				uuid: "u1",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: { role: "user", content: "First user message" },
			}),
			makeUserEntry({
				uuid: "u2",
				timestamp: "2024-01-01T00:00:02.000Z",
				message: { role: "user", content: "Second user message" },
			}),
		];

		expect(extractTaskPrompt(entries)).toBe("First user message");
	});

	test("skips tool_result blocks in array content", () => {
		const entries: readonly TranscriptEntry[] = [
			makeUserEntry({
				message: {
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "t1", content: "some result" },
					],
				},
			}),
		];

		expect(extractTaskPrompt(entries)).toBeUndefined();
	});
});

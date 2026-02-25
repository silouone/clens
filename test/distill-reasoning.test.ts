import { describe, expect, test } from "bun:test";
import { extractReasoning } from "../src/distill/reasoning";
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

describe("extractReasoning", () => {
	test("correlates thinking with tool_use in same message", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "I should read the file" },
						{ type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: "/foo.ts" } },
					],
				},
			}),
		];

		const result = extractReasoning(entries);
		expect(result).toHaveLength(1);
		expect(result[0].tool_use_id).toBe("toolu_01");
		expect(result[0].tool_name).toBe("Read");
		expect(result[0].intent_hint).toBe("research");
	});

	test("correlates thinking with tool_use in NEXT assistant entry (standalone thinking)", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "uuid-think",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "Let me search for the bug" }],
				},
			}),
			makeAssistantEntry({
				uuid: "uuid-tool",
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_02", name: "Grep", input: { pattern: "bug" } },
					],
				},
			}),
		];

		const result = extractReasoning(entries);
		expect(result).toHaveLength(1);
		expect(result[0].tool_use_id).toBe("toolu_02");
		expect(result[0].tool_name).toBe("Grep");
		expect(result[0].intent_hint).toBe("debugging");
	});

	test("skips non-assistant entries when scanning forward", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "uuid-think",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "I need to plan the approach" }],
				},
			}),
			{
				uuid: "uuid-user",
				parentUuid: null,
				sessionId: "session-1",
				type: "user",
				timestamp: "2024-01-01T00:00:02.000Z",
				message: { role: "user", content: "some user message" },
			},
			makeAssistantEntry({
				uuid: "uuid-tool",
				timestamp: "2024-01-01T00:00:03.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_03", name: "Bash", input: { command: "ls" } },
					],
				},
			}),
		];

		const result = extractReasoning(entries);
		expect(result).toHaveLength(1);
		expect(result[0].tool_use_id).toBe("toolu_03");
		expect(result[0].tool_name).toBe("Bash");
		expect(result[0].intent_hint).toBe("planning");
	});

	test("returns undefined correlation when no subsequent tool_use exists", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "Just thinking about things" }],
				},
			}),
		];

		const result = extractReasoning(entries);
		expect(result).toHaveLength(1);
		expect(result[0].tool_use_id).toBeUndefined();
		expect(result[0].tool_name).toBeUndefined();
	});

	test("truncates long thinking text", () => {
		const longThinking = "x".repeat(6000);
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: longThinking }],
				},
			}),
		];

		const result = extractReasoning(entries);
		expect(result).toHaveLength(1);
		expect(result[0].thinking.length).toBe(5000);
		expect(result[0].truncated).toBe(true);
	});

	test("classifies intent correctly", () => {
		const makeThinkingEntry = (thinking: string): TranscriptEntry =>
			makeAssistantEntry({
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking }],
				},
			});

		const entries: readonly TranscriptEntry[] = [
			makeThinkingEntry("I should decide between option A and option B"),
			makeThinkingEntry("Let me explore and find the relevant code"),
			makeThinkingEntry("There is a bug, let me fix this error"),
			makeThinkingEntry("My plan is to approach this in phases"),
			makeThinkingEntry("The weather is nice today"),
		];

		const result = extractReasoning(entries);
		expect(result[0].intent_hint).toBe("deciding");
		expect(result[1].intent_hint).toBe("research");
		expect(result[2].intent_hint).toBe("debugging");
		expect(result[3].intent_hint).toBe("planning");
		expect(result[4].intent_hint).toBe("general");
	});

	test("picks first tool_use from next assistant when multiple exist", () => {
		const entries: readonly TranscriptEntry[] = [
			makeAssistantEntry({
				uuid: "uuid-think",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [{ type: "thinking", thinking: "Let me investigate the issue" }],
				},
			}),
			makeAssistantEntry({
				uuid: "uuid-tools",
				timestamp: "2024-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_first", name: "Read", input: { file_path: "/a.ts" } },
						{ type: "tool_use", id: "toolu_second", name: "Grep", input: { pattern: "x" } },
					],
				},
			}),
		];

		const result = extractReasoning(entries);
		expect(result).toHaveLength(1);
		expect(result[0].tool_use_id).toBe("toolu_first");
		expect(result[0].tool_name).toBe("Read");
	});
});

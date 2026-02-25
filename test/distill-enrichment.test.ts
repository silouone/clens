import { describe, expect, test } from "bun:test";
import { extractReasoning } from "../src/distill/reasoning";
import { extractUserMessages } from "../src/distill/user-messages";
import type { TranscriptEntry } from "../src/types";

const makeAssistantEntry = (
	// biome-ignore lint/suspicious/noExplicitAny: test helper with dynamic content shapes
	content: any[],
	timestamp = "2024-01-01T00:00:01.000Z",
): TranscriptEntry => ({
	uuid: "test-uuid",
	parentUuid: null,
	sessionId: "test",
	type: "assistant",
	timestamp,
	message: { role: "assistant", content },
});

// biome-ignore lint/suspicious/noExplicitAny: test helper with dynamic content shapes
const makeUserEntry = (content: any, timestamp = "2024-01-01T00:00:01.000Z"): TranscriptEntry => ({
	uuid: "test-uuid",
	parentUuid: null,
	sessionId: "test",
	type: "user",
	timestamp,
	message: { role: "user", content },
});

describe("extractReasoning", () => {
	test("finds thinking blocks", () => {
		const entries = [
			makeAssistantEntry([
				{ type: "thinking", thinking: "Let me analyze this..." },
				{ type: "tool_use", id: "toolu_01", name: "Read", input: {} },
			]),
		];
		const result = extractReasoning(entries);
		expect(result.length).toBe(1);
		expect(result[0].thinking).toBe("Let me analyze this...");
	});

	test("correlates thinking with next tool_use", () => {
		const entries = [
			makeAssistantEntry([
				{ type: "thinking", thinking: "Need to read the file" },
				{ type: "tool_use", id: "toolu_01", name: "Read", input: {} },
			]),
		];
		const result = extractReasoning(entries);
		expect(result[0].tool_use_id).toBe("toolu_01");
		expect(result[0].tool_name).toBe("Read");
	});

	test("caps thinking at 5000 chars", () => {
		const longThinking = "x".repeat(6000);
		const entries = [makeAssistantEntry([{ type: "thinking", thinking: longThinking }])];
		const result = extractReasoning(entries);
		expect(result[0].thinking.length).toBe(5000);
	});

	test("returns empty array for empty input", () => {
		expect(extractReasoning([])).toEqual([]);
	});

	describe("intent classification", () => {
		test("classifies debugging intent", () => {
			const entries = [
				makeAssistantEntry([
					{ type: "thinking", thinking: "There is an error in the code, I need to fix it" },
				]),
			];
			const result = extractReasoning(entries);
			expect(result[0].intent_hint).toBe("debugging");
		});

		test("classifies planning intent", () => {
			const entries = [
				makeAssistantEntry([
					{
						type: "thinking",
						thinking: "Let me plan my approach for this feature step by step",
					},
				]),
			];
			const result = extractReasoning(entries);
			expect(result[0].intent_hint).toBe("planning");
		});

		test("classifies research intent", () => {
			const entries = [
				makeAssistantEntry([
					{
						type: "thinking",
						thinking: "I need to search for the file and investigate the structure",
					},
				]),
			];
			const result = extractReasoning(entries);
			expect(result[0].intent_hint).toBe("research");
		});

		test("classifies deciding intent", () => {
			const entries = [
				makeAssistantEntry([
					{
						type: "thinking",
						thinking: "I should decide between option A and the alternative method",
					},
				]),
			];
			const result = extractReasoning(entries);
			expect(result[0].intent_hint).toBe("deciding");
		});

		test("classifies general intent for unmatched content", () => {
			const entries = [
				makeAssistantEntry([{ type: "thinking", thinking: "Here is my response to the user" }]),
			];
			const result = extractReasoning(entries);
			expect(result[0].intent_hint).toBe("general");
		});

		test("classifies empty thinking as general", () => {
			const entries = [makeAssistantEntry([{ type: "thinking", thinking: "" }])];
			const result = extractReasoning(entries);
			expect(result[0].intent_hint).toBe("general");
		});

		test("debugging takes priority over planning when both present", () => {
			const entries = [
				makeAssistantEntry([
					{
						type: "thinking",
						thinking: "My plan is to fix this error in the code",
					},
				]),
			];
			const result = extractReasoning(entries);
			expect(result[0].intent_hint).toBe("debugging");
		});
	});

	describe("truncated flag", () => {
		test("sets truncated to true when thinking exceeds 5000 chars", () => {
			const longThinking = "x".repeat(6000);
			const entries = [makeAssistantEntry([{ type: "thinking", thinking: longThinking }])];
			const result = extractReasoning(entries);
			expect(result[0].truncated).toBe(true);
		});

		test("sets truncated to false when thinking is within limit", () => {
			const entries = [makeAssistantEntry([{ type: "thinking", thinking: "Short thinking" }])];
			const result = extractReasoning(entries);
			expect(result[0].truncated).toBe(false);
		});

		test("sets truncated to false for exactly 5000 chars", () => {
			const exactThinking = "x".repeat(5000);
			const entries = [makeAssistantEntry([{ type: "thinking", thinking: exactThinking }])];
			const result = extractReasoning(entries);
			expect(result[0].truncated).toBe(false);
		});
	});
});

describe("extractUserMessages", () => {
	test("extracts text prompts", () => {
		const entries = [makeUserEntry("Hello, please help me")];
		const result = extractUserMessages(entries);
		expect(result.length).toBe(1);
		expect(result[0].content).toBe("Hello, please help me");
		expect(result[0].is_tool_result).toBe(false);
	});

	test("skips tool_result entries", () => {
		const entries = [
			makeUserEntry([{ type: "tool_result", tool_use_id: "toolu_01", content: "file contents" }]),
		];
		const result = extractUserMessages(entries);
		expect(result.length).toBe(0);
	});

	test("returns empty array for empty input", () => {
		expect(extractUserMessages([])).toEqual([]);
	});

	describe("message_type classification", () => {
		test("classifies command messages with command-name tag", () => {
			const entries = [makeUserEntry("Run this <command-name>build</command-name>")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("command");
		});

		test("classifies command messages with command-message tag", () => {
			const entries = [makeUserEntry("Execute <command-message>deploy now</command-message>")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("command");
		});

		test("classifies teammate messages", () => {
			const entries = [
				makeUserEntry('<teammate-message name="researcher">Found the bug</teammate-message>'),
			];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("teammate");
		});

		test("classifies image messages with Image tag", () => {
			const entries = [makeUserEntry("Here is [Image: /tmp/screenshot.png] the error")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("image");
		});

		test("classifies image messages with screenshot keyword", () => {
			const entries = [makeUserEntry("Please look at this screenshot of the error")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("image");
		});

		test("classifies system messages with local-command", () => {
			const entries = [makeUserEntry("<local-command>git status</local-command>")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("system");
		});

		test("classifies system messages with system-reminder", () => {
			const entries = [makeUserEntry("<system-reminder>Remember the rules</system-reminder>")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("system");
		});

		test("classifies plain text as prompt", () => {
			const entries = [makeUserEntry("Please refactor this function")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("prompt");
		});

		test("classifies empty content as prompt", () => {
			const entries = [makeUserEntry("")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("prompt");
		});
	});

	describe("teammate name extraction", () => {
		test("extracts teammate name from tag", () => {
			const entries = [
				makeUserEntry('<teammate-message name="builder">Task complete</teammate-message>'),
			];
			const result = extractUserMessages(entries);
			expect(result[0].teammate_name).toBe("builder");
		});

		test("handles teammate message without name attribute", () => {
			const entries = [makeUserEntry("<teammate-message>Some message</teammate-message>")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("teammate");
			expect(result[0].teammate_name).toBeUndefined();
		});
	});

	describe("image path extraction", () => {
		test("extracts image file path from Image tag", () => {
			const entries = [makeUserEntry("Check [Image: /tmp/error.png] this out")];
			const result = extractUserMessages(entries);
			expect(result[0].image_path).toBe("/tmp/error.png");
		});

		test("does not set image_path for screenshot keyword without Image tag", () => {
			const entries = [makeUserEntry("Look at the screenshot I shared")];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("image");
			expect(result[0].image_path).toBeUndefined();
		});
	});

	describe("edge cases", () => {
		test("handles array content with text blocks", () => {
			const entries = [makeUserEntry([{ type: "text", text: "Array text content" }])];
			const result = extractUserMessages(entries);
			expect(result.length).toBe(1);
			expect(result[0].content).toBe("Array text content");
			expect(result[0].message_type).toBe("prompt");
		});

		test("classifies array text block with command tag", () => {
			const entries = [
				makeUserEntry([{ type: "text", text: "Run <command-name>test</command-name>" }]),
			];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("command");
		});

		test("handles mixed signals - first match wins", () => {
			const entries = [
				makeUserEntry(
					"<command-name>fix</command-name> the screenshot <teammate-message>hi</teammate-message>",
				),
			];
			const result = extractUserMessages(entries);
			expect(result[0].message_type).toBe("command");
		});
	});
});

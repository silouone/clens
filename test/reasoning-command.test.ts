import { describe, expect, test } from "bun:test";
import { renderReasoningSummary, renderReasoningFull } from "../src/commands/reasoning";
import type { DistilledSession } from "../src/types";
import type { TranscriptReasoning } from "../src/types/transcript";

// -- ANSI stripping helper --

const stripAnsi = (s: string): string =>
	s.replace(/\x1b\[[0-9;]*m/g, "");

// -- Fixture factories --

const makeReasoning = (
	overrides: Partial<TranscriptReasoning> = {},
): TranscriptReasoning => ({
	t: 1000000,
	thinking: "I need to analyze the error and determine the root cause",
	tool_use_id: "tool-123",
	tool_name: "Read",
	intent_hint: "debugging",
	truncated: false,
	...overrides,
});

const makeDistilled = (
	overrides: Partial<DistilledSession> = {},
): DistilledSession => ({
	session_id: "test1234-5678-uuid",
	stats: {
		duration_ms: 60000,
		total_events: 100,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 50,
		failure_count: 5,
		failure_rate: 0.1,
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

// =============================================================================
// renderReasoningSummary
// =============================================================================

describe("renderReasoningSummary", () => {
	test("empty reasoning shows block count 0", () => {
		const distilled = makeDistilled({ reasoning: [] });
		const output = stripAnsi(renderReasoningSummary(distilled));
		expect(output).toContain("Block count: 0");
	});

	test("intent distribution shows correct counts for different intents", () => {
		const reasoning = [
			makeReasoning({ intent_hint: "debugging" }),
			makeReasoning({ intent_hint: "debugging" }),
			makeReasoning({ intent_hint: "planning" }),
			makeReasoning({ intent_hint: "research" }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningSummary(distilled));
		expect(output).toContain("debugging");
		expect(output).toContain("planning");
		expect(output).toContain("research");
		// debugging: 2/4 = 50.0%
		expect(output).toContain("50.0%");
		// planning: 1/4 = 25.0%
		expect(output).toContain("25.0%");
	});

	test("tool correlation: blocks with/without tool_use_id show correct counts", () => {
		const reasoning = [
			makeReasoning({ tool_use_id: "t1" }),
			makeReasoning({ tool_use_id: "t2" }),
			makeReasoning({ tool_use_id: undefined }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningSummary(distilled));
		expect(output).toContain("with tool");
		expect(output).toContain("standalone");
		// 2 with tool, 1 standalone - look for the count in context
		// The format is: "with tool     2" and "standalone    1"
		expect(output).toMatch(/with tool\s+2/);
		expect(output).toMatch(/standalone\s+1/);
	});

	test("truncated count is shown correctly", () => {
		const reasoning = [
			makeReasoning({ truncated: true }),
			makeReasoning({ truncated: true }),
			makeReasoning({ truncated: false }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningSummary(distilled));
		expect(output).toContain("Truncated: 2");
	});

	test("shows unknown intent for blocks without intent", () => {
		const reasoning = [
			makeReasoning({ intent_hint: undefined }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningSummary(distilled));
		expect(output).toContain("unknown");
	});
});

// =============================================================================
// renderReasoningFull
// =============================================================================

describe("renderReasoningFull", () => {
	test("full output contains thinking text", () => {
		const reasoning = [
			makeReasoning({ thinking: "Analyzing the build failure carefully" }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled));
		expect(output).toContain("Analyzing the build failure carefully");
	});

	test("intent filter only shows matching blocks", () => {
		const reasoning = [
			makeReasoning({ intent_hint: "debugging", thinking: "Debug thought" }),
			makeReasoning({ intent_hint: "planning", thinking: "Planning thought" }),
			makeReasoning({ intent_hint: "debugging", thinking: "More debugging" }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled, "debugging"));
		expect(output).toContain("Debug thought");
		expect(output).toContain("More debugging");
		expect(output).not.toContain("Planning thought");
		expect(output).toContain("intent: debugging");
	});

	test("truncated block contains [truncated] marker", () => {
		const reasoning = [
			makeReasoning({ truncated: true, thinking: "Partial thought" }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled));
		expect(output).toContain("[truncated]");
	});

	test("non-truncated block does not contain [truncated] marker", () => {
		const reasoning = [
			makeReasoning({ truncated: false, thinking: "Complete thought" }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled));
		expect(output).not.toContain("[truncated]");
	});

	test("empty reasoning returns 'No reasoning blocks found' message", () => {
		const distilled = makeDistilled({ reasoning: [] });
		const output = stripAnsi(renderReasoningFull(distilled));
		expect(output).toContain("No reasoning blocks found");
	});

	test("empty filtered result returns intent-specific message", () => {
		const reasoning = [
			makeReasoning({ intent_hint: "debugging" }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled, "planning"));
		expect(output).toContain("No reasoning blocks found with intent");
		expect(output).toContain("planning");
	});

	test("header shows correct block count", () => {
		const reasoning = [
			makeReasoning({}),
			makeReasoning({}),
			makeReasoning({}),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled));
		expect(output).toContain("3 reasoning blocks");
	});

	test("single block uses singular form", () => {
		const reasoning = [makeReasoning({})];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled));
		expect(output).toContain("1 reasoning block");
		expect(output).not.toContain("1 reasoning blocks");
	});

	test("shows tool name when present, 'standalone' when absent", () => {
		const reasoning = [
			makeReasoning({ tool_name: "Edit", thinking: "With tool" }),
			makeReasoning({ tool_name: undefined, tool_use_id: undefined, thinking: "Without tool" }),
		];
		const distilled = makeDistilled({ reasoning });
		const output = stripAnsi(renderReasoningFull(distilled));
		expect(output).toContain("tool: Edit");
		expect(output).toContain("standalone");
	});
});


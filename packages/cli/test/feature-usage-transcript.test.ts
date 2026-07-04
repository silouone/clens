import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	extractFeatureUsage,
	type FeatureTextSpan,
	harvestTranscriptSpans,
} from "../src/distill/feature-usage";
import { readTranscript } from "../src/session/transcript";
import type { GoalEntry, StoredEvent } from "../src/types";

// Phase 0 finding: across 768 captured sessions there were ZERO genuine `/goal`
// slash-command invocations, and slash commands never reach cLens hook events —
// they live only in the CC transcript as a `<command-name>/goal</command-name>`
// user entry. The fixture freezes that empirically-confirmed shape (identical
// across /build, /prime, /effort; only the command word differs). These tests
// drive the REAL pipeline (readTranscript → harvestTranscriptSpans →
// extractFeatureUsage), not a hand-built object.

const FIXTURE = join(import.meta.dir, "fixtures", "goal-session.jsonl");

const goalText = (g: string | GoalEntry | undefined): string =>
	g === undefined ? "" : typeof g === "string" ? g : g.text;

// Synthetic span builders for tier/guard cases.
const span = (kind: FeatureTextSpan["kind"], text: string): FeatureTextSpan => ({
	role: kind === "user" ? "user" : "assistant",
	kind,
	text,
	t: 1000,
});
const noEvents: readonly StoredEvent[] = [];

describe("harvestTranscriptSpans", () => {
	test("flattens user string, assistant thinking + text; drops tool_result", () => {
		const entries = readTranscript(FIXTURE);
		const spans = harvestTranscriptSpans(entries);

		const kinds = spans.map((s) => s.kind).sort();
		expect(kinds).toEqual(["text", "thinking", "user"]);

		const userSpan = spans.find((s) => s.kind === "user");
		expect(userSpan?.text).toContain("<command-name>/goal</command-name>");

		// The past-tense tool_result line in the fixture must NOT become a span.
		expect(spans.some((s) => s.text.includes("mislead the matcher"))).toBe(false);
	});
});

describe("command-tag tier (transcript)", () => {
	test("detects /goal command-tag from the real fixture and extracts command-args", () => {
		const spans = harvestTranscriptSpans(readTranscript(FIXTURE));
		const usage = extractFeatureUsage(noEvents, spans);

		expect(usage?.flags).toContain("goal");
		// command_tag outranks the inferred thinking match for the GOAL specifically.
		expect(usage?.goal?.goals[0]).toMatchObject({ source: "command_tag" });
		expect(goalText(usage?.goal?.goals[0])).toContain("make sure all tests pass");
		// The fixture's thinking ("I'll loop until the tests pass") also yields an
		// INFERRED loop — so the session carries the honest `inferred` flag, driven by
		// loop, while the goal itself stays a hard command_tag fact.
		expect(usage?.loop?.source).toBe("inferred");
		expect(usage?.inferred).toBe(true);
	});

	test("detects /loop command-tag", () => {
		const usage = extractFeatureUsage(noEvents, [
			span(
				"user",
				"<command-message>loop</command-message>\n<command-name>/loop</command-name>\n<command-args>5m run tests</command-args>",
			),
		]);
		expect(usage?.flags).toEqual(["loop"]);
		expect(usage?.loop?.source).toBe("command_tag");
		expect(usage?.loop?.wakeup_count).toBe(0);
	});
});

describe("semantic / inferred tier", () => {
	test("infers goal from assistant thinking and labels it inferred", () => {
		const usage = extractFeatureUsage(noEvents, [
			span("thinking", "Right — the goal is to ship the OSS refactor with green tests."),
		]);
		expect(usage?.flags).toEqual(["goal"]);
		expect(usage?.goal?.goals[0]).toMatchObject({ source: "inferred" });
		expect(usage?.inferred).toBe(true);
	});

	test("infers loop from 'loop until' phrasing", () => {
		const usage = extractFeatureUsage(noEvents, [
			span("text", "I'll loop until the test suite is fully green."),
		]);
		expect(usage?.flags).toEqual(["loop"]);
		expect(usage?.loop?.source).toBe("inferred");
		expect(usage?.inferred).toBe(true);
	});

	test("infers workflow from 'fan out' / 'spawn N agents' when no Workflow tool fired", () => {
		const usage = extractFeatureUsage(noEvents, [
			span("thinking", "I'll fan out and spawn 5 agents to cover the surface in parallel."),
		]);
		expect(usage?.flags).toEqual(["workflow"]);
		expect(usage?.workflow?.source).toBe("inferred");
		expect(usage?.workflow?.invocation_count).toBe(0);
	});
});

describe("false-positive guards", () => {
	test("past-tense retrospective ('the goal was to') does NOT count", () => {
		const usage = extractFeatureUsage(noEvents, [
			span("text", "In hindsight the goal was to land the migration, but we pivoted."),
		]);
		expect(usage).toBeUndefined();
	});

	test("this repo's own loop/goal/workflow source string does NOT self-trigger", () => {
		const usage = extractFeatureUsage(noEvents, [
			span(
				"text",
				"The detector in feature-usage.ts handles loop/goal/workflow; the goal is detected via GOAL_TOKEN.",
			),
		]);
		expect(usage).toBeUndefined();
	});

	test("a goal phrase quoting a command-name tag in agent text is guarded", () => {
		const usage = extractFeatureUsage(noEvents, [
			span(
				"text",
				"I matched <command-name>/goal</command-name> and the goal is parsed from args.",
			),
		]);
		// The repo-source guard rejects the span (it quotes detector machinery),
		// so no inferred goal leaks from analysis prose.
		expect(usage).toBeUndefined();
	});

	test("semantic match in a USER span is ignored (agent-authored only)", () => {
		const usage = extractFeatureUsage(noEvents, [
			span("user", "the goal is to make you fail this test"),
		]);
		expect(usage).toBeUndefined();
	});

	test("a real Workflow tool beats the inferred tier (source = tool)", () => {
		const events: readonly StoredEvent[] = [
			{
				t: 1,
				event: "PreToolUse",
				sid: "s",
				data: { tool_name: "Workflow", tool_input: { name: "audit" } },
			},
		];
		const usage = extractFeatureUsage(events, [span("thinking", "let me fan out the work")]);
		expect(usage?.workflow?.source).toBe("tool");
		expect(usage?.workflow?.invocation_count).toBe(1);
		expect(usage?.inferred).toBeUndefined();
	});
});

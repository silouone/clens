import { describe, expect, test } from "bun:test";
import { detectFeatureFlags, extractFeatureUsage } from "../src/distill/feature-usage";
import type { GoalEntry, StoredEvent } from "../src/types";

const SID = "test-session";

// GoalUsage.goals is a (string | GoalEntry)[] union (back-compat); freshly
// extracted goals are always GoalEntry. Read `.text` regardless of shape.
const goalText = (g: string | GoalEntry | undefined): string =>
	g === undefined ? "" : typeof g === "string" ? g : g.text;

const event = (eventType: string, data: Record<string, unknown>, t = 1000): StoredEvent => ({
	t,
	event: eventType as StoredEvent["event"],
	sid: SID,
	data,
});

const preTool = (toolName: string, toolInput: Record<string, unknown>, t = 1000): StoredEvent =>
	event("PreToolUse", { tool_name: toolName, tool_input: toolInput }, t);

const prompt = (text: string, t = 1000): StoredEvent =>
	event("UserPromptSubmit", { prompt: text }, t);

const readEvent = preTool("Read", { file_path: "/tmp/x.ts" });

describe("extractFeatureUsage", () => {
	test("returns undefined when no features used", () => {
		expect(extractFeatureUsage([readEvent, prompt("fix the bug")])).toBeUndefined();
	});

	test("detects loop from ScheduleWakeup events", () => {
		const events = [
			preTool(
				"ScheduleWakeup",
				{ delaySeconds: 270, reason: "watching CI", prompt: "<<autonomous-loop-dynamic>>" },
				1000,
			),
			preTool(
				"ScheduleWakeup",
				{ delaySeconds: 180, reason: "deploy in progress", prompt: "/loop check status" },
				2000,
			),
		];
		const usage = extractFeatureUsage(events);
		expect(usage?.flags).toEqual(["loop"]);
		expect(usage?.loop?.wakeup_count).toBe(2);
		expect(usage?.loop?.total_scheduled_wait_s).toBe(450);
		expect(usage?.loop?.autonomous).toBe(true);
		expect(usage?.loop?.wakeups[0]).toEqual({ t: 1000, delay_seconds: 270, reason: "watching CI" });
	});

	test("detects loop from Skill invocation and /loop prompt", () => {
		const usage = extractFeatureUsage([
			preTool("Skill", { skill: "loop", args: "5m /test" }),
			prompt("/loop 5m run tests"),
		]);
		expect(usage?.flags).toEqual(["loop"]);
		expect(usage?.loop?.skill_invocations).toBe(2);
		expect(usage?.loop?.autonomous).toBe(false);
	});

	test("detects autonomous loop from CronCreate sentinel", () => {
		const usage = extractFeatureUsage([
			preTool("CronCreate", { schedule: "0 * * * *", prompt: "<<autonomous-loop>>" }),
		]);
		expect(usage?.flags).toEqual(["loop"]);
		expect(usage?.loop?.autonomous).toBe(true);
	});

	test("detects goal from /goal token in prompts", () => {
		const usage = extractFeatureUsage([
			prompt("fix the doc limit. /goal make sure tests pass and the biome check is green"),
		]);
		expect(usage?.flags).toEqual(["goal"]);
		expect(usage?.goal?.goals[0]).toMatchObject({ source: "command" });
		expect(goalText(usage?.goal?.goals[0])).toStartWith("/goal make sure tests pass");
	});

	test("does not flag goal for paths containing /goal", () => {
		const usage = extractFeatureUsage([
			prompt("read src/goals/index.ts and refactor"),
			preTool("Read", { file_path: "/app/goal/config.ts" }),
		]);
		expect(usage).toBeUndefined();
	});

	test("truncates long goal text", () => {
		const usage = extractFeatureUsage([prompt(`/goal ${"x".repeat(500)}`)]);
		const goal = goalText(usage?.goal?.goals[0]);
		expect(goal.length).toBeLessThanOrEqual(201);
		expect(goal.endsWith("…")).toBe(true);
	});

	test("detects workflow and extracts meta from script", () => {
		const script =
			"export const meta = {\n  name: 'pr-audit',\n  description: 'Audit the PR',\n  phases: [],\n}\nconst x = await agent('go')";
		const usage = extractFeatureUsage([preTool("Workflow", { script }, 5000)]);
		expect(usage?.flags).toEqual(["workflow"]);
		expect(usage?.workflow?.invocation_count).toBe(1);
		expect(usage?.workflow?.runs[0]).toEqual({
			t: 5000,
			name: "pr-audit",
			description: "Audit the PR",
		});
	});

	test("workflow run from named workflow and scriptPath", () => {
		const usage = extractFeatureUsage([
			preTool("Workflow", { name: "review-changes" }),
			preTool("Workflow", { scriptPath: "/tmp/session/wf-find-bugs.mjs" }),
		]);
		expect(usage?.workflow?.runs.map((r) => r.name)).toEqual(["review-changes", "wf-find-bugs"]);
	});

	test("combines multiple features with stable flag order", () => {
		const usage = extractFeatureUsage([
			preTool("Workflow", { name: "audit" }),
			prompt("/goal ship it"),
			preTool("ScheduleWakeup", { delaySeconds: 60, reason: "poll" }),
		]);
		expect(usage?.flags).toEqual(["loop", "goal", "workflow"]);
	});

	test("ignores PostToolUse duplicates for counts", () => {
		const usage = extractFeatureUsage([
			preTool("Workflow", { name: "audit" }),
			event("PostToolUse", { tool_name: "Workflow", tool_input: { name: "audit" } }),
		]);
		expect(usage?.workflow?.invocation_count).toBe(1);
	});
});

describe("detectFeatureFlags", () => {
	const line = (e: StoredEvent): string => JSON.stringify(e);

	test("empty content has no flags", () => {
		expect(detectFeatureFlags("")).toEqual([]);
		expect(detectFeatureFlags(line(readEvent))).toEqual([]);
	});

	test("detects loop from ScheduleWakeup marker", () => {
		const content = line(preTool("ScheduleWakeup", { delaySeconds: 60, reason: "poll" }));
		expect(detectFeatureFlags(content)).toEqual(["loop"]);
	});

	test("detects loop from loop skill marker", () => {
		const content = line(preTool("Skill", { skill: "loop" }));
		expect(detectFeatureFlags(content)).toEqual(["loop"]);
	});

	test("detects workflow from tool marker", () => {
		const content = line(preTool("Workflow", { name: "audit" }));
		expect(detectFeatureFlags(content)).toEqual(["workflow"]);
	});

	test("detects goal only in UserPromptSubmit prompts", () => {
		const goalContent = line(prompt("please /goal finish the migration"));
		expect(detectFeatureFlags(goalContent)).toEqual(["goal"]);

		// /goal inside a file path in a tool event must NOT flag
		const pathContent = line(preTool("Read", { file_path: "/app/goal/config.ts" }));
		expect(detectFeatureFlags(pathContent)).toEqual([]);

		// /goal inside a non-prompt string field of another event must NOT flag
		const bashContent = line(preTool("Bash", { command: "cat docs/goal notes.md" }));
		expect(detectFeatureFlags(bashContent)).toEqual([]);
	});

	test("multi-line content combines flags", () => {
		const content = [
			line(preTool("ScheduleWakeup", { delaySeconds: 60 })),
			line(prompt("/goal all tests green")),
			line(preTool("Workflow", { name: "audit" })),
		].join("\n");
		expect(detectFeatureFlags(content)).toEqual(["loop", "goal", "workflow"]);
	});

	test("autonomous-loop sentinel inside read file content does NOT flag loop", () => {
		// Regression (feature-flag-substring-false-positive):
		// The <<autonomous-loop sentinel appears only as escaped text inside a file the
		// agent read (e.g. this very source). There is no ScheduleWakeup/CronCreate call,
		// so 'loop' must NOT be flagged.
		const content = line(
			preTool("Read", {
				file_path: "/repo/feature-usage.ts",
				// Simulated file content that mentions the sentinel as a literal string.
				content: 'const AUTONOMOUS_SENTINEL = "<<autonomous-loop";',
			}),
		);
		expect(detectFeatureFlags(content)).toEqual([]);
	});

	test("autonomous-loop sentinel inside a ScheduleWakeup call DOES flag loop", () => {
		// Counterpart: the sentinel riding inside an actual loop tool call is a real signal.
		const content = line(
			preTool("ScheduleWakeup", { delaySeconds: 0, reason: "<<autonomous-loop-dynamic>>" }),
		);
		expect(detectFeatureFlags(content)).toEqual(["loop"]);
	});
});

import { describe, expect, test } from "bun:test";
import { extractTimeline } from "../src/distill/timeline";
import type {
	BacktrackResult,
	LinkEvent,
	PhaseInfo,
	StoredEvent,
	TaskLink,
	TranscriptReasoning,
	TranscriptUserMessage,
} from "../src/types";

// --- Factories ---

const makeEvent = (
	t: number,
	eventType: string,
	data: Record<string, unknown> = {},
): StoredEvent => ({
	t,
	event: eventType as StoredEvent["event"],
	sid: "test-session",
	data,
});

const makePhase = (name: string, start_t: number, end_t: number): PhaseInfo => ({
	name,
	start_t,
	end_t,
	tool_types: ["Read"],
	description: `${name} phase`,
});

const makeReasoning = (t: number, thinking: string, intent?: string): TranscriptReasoning => ({
	t,
	thinking,
	intent: (intent as TranscriptReasoning["intent"]) ?? "general",
});

const makeUserMessage = (
	t: number,
	content: string,
	message_type: TranscriptUserMessage["message_type"] = "prompt",
): TranscriptUserMessage => ({
	t,
	content,
	is_tool_result: false,
	message_type,
});

const makeBacktrack = (start_t: number): BacktrackResult => ({
	type: "failure_retry",
	tool_name: "Bash",
	attempts: 2,
	start_t,
	end_t: start_t + 1000,
	tool_use_ids: ["t1", "t2"],
});

// --- Tests ---

describe("extractTimeline", () => {
	test("produces chronologically ordered entries", () => {
		const events = [
			makeEvent(1000, "PreToolUse", { tool_name: "Read", tool_use_id: "t1" }),
			makeEvent(3000, "PreToolUse", { tool_name: "Edit", tool_use_id: "t2" }),
		];
		const reasoning = [makeReasoning(2000, "Thinking about the approach")];

		const result = extractTimeline(events, reasoning, [], [], [makePhase("General", 0, 5000)]);

		expect(result.length).toBe(4); // 2 events + 1 reasoning + 1 phase_boundary
		expect(result[0].t).toBeLessThanOrEqual(result[1].t);
		expect(result[1].t).toBeLessThanOrEqual(result[2].t);
		expect(result[2].t).toBeLessThanOrEqual(result[3].t);
	});

	test("includes all source types", () => {
		const events = [
			makeEvent(1000, "PreToolUse", { tool_name: "Read", tool_use_id: "t1" }),
			makeEvent(2000, "PostToolUseFailure", {
				tool_name: "Bash",
				tool_use_id: "t2",
				error: "Command failed",
			}),
		];
		const reasoning = [makeReasoning(1500, "Analyzing...")];
		const user_messages = [makeUserMessage(500, "Fix the bug")];
		const backtracks = [makeBacktrack(2000)];
		const phases = [makePhase("Debugging", 0, 3000)];

		const result = extractTimeline(events, reasoning, user_messages, backtracks, phases);

		const types = result.map((e) => e.type);
		expect(types).toContain("tool_call");
		expect(types).toContain("failure");
		expect(types).toContain("thinking");
		expect(types).toContain("user_prompt");
		expect(types).toContain("backtrack");
		expect(types).toContain("phase_boundary");
	});

	test("maps PreToolUse to tool_call with tool_name and tool_use_id", () => {
		const events = [makeEvent(1000, "PreToolUse", { tool_name: "Grep", tool_use_id: "t42" })];

		const result = extractTimeline(events, [], [], [], []);

		const toolCall = result.find((e) => e.type === "tool_call");
		expect(toolCall).toBeDefined();
		expect(toolCall?.tool_name).toBe("Grep");
		expect(toolCall?.tool_use_id).toBe("t42");
	});

	test("maps PostToolUseFailure to failure entry", () => {
		const events = [
			makeEvent(1000, "PostToolUseFailure", {
				tool_name: "Bash",
				tool_use_id: "t5",
				error: "Exit code 1: command not found",
			}),
		];

		const result = extractTimeline(events, [], [], [], []);

		const failure = result.find((e) => e.type === "failure");
		expect(failure).toBeDefined();
		expect(failure?.tool_name).toBe("Bash");
		expect(failure?.content_preview).toContain("Exit code 1");
	});

	test("maps reasoning to thinking with content_preview capped at 200 chars", () => {
		const longThinking = "x".repeat(500);
		const reasoning = [makeReasoning(1000, longThinking)];

		const result = extractTimeline([], reasoning, [], [], []);

		const thinking = result.find((e) => e.type === "thinking");
		expect(thinking).toBeDefined();
		expect(thinking?.content_preview?.length).toBe(200);
	});

	test("filters user_messages to only prompt type", () => {
		const user_messages = [
			makeUserMessage(500, "Fix the bug", "prompt"),
			makeUserMessage(600, "<system-reminder>rules</system-reminder>", "system"),
			makeUserMessage(700, "teammate msg", "teammate"),
		];

		const result = extractTimeline([], [], user_messages, [], []);

		const prompts = result.filter((e) => e.type === "user_prompt");
		expect(prompts).toHaveLength(1);
		expect(prompts[0].content_preview).toBe("Fix the bug");
	});

	test("assigns phase_index based on phase time ranges", () => {
		const events = [
			makeEvent(500, "PreToolUse", { tool_name: "Read", tool_use_id: "t1" }),
			makeEvent(1500, "PreToolUse", { tool_name: "Edit", tool_use_id: "t2" }),
		];
		const phases = [makePhase("Exploration", 0, 1000), makePhase("Modification", 1001, 2000)];

		const result = extractTimeline(events, [], [], [], phases);

		const toolCalls = result.filter((e) => e.type === "tool_call");
		expect(toolCalls[0].phase_index).toBe(0);
		expect(toolCalls[1].phase_index).toBe(1);
	});

	test("phase_boundary entries get correct phase_index", () => {
		const phases = [
			makePhase("Phase A", 0, 1000),
			makePhase("Phase B", 1001, 2000),
			makePhase("Phase C", 2001, 3000),
		];

		const result = extractTimeline([], [], [], [], phases);

		const boundaries = result.filter((e) => e.type === "phase_boundary");
		expect(boundaries).toHaveLength(3);
		expect(boundaries[0].phase_index).toBe(0);
		expect(boundaries[1].phase_index).toBe(1);
		expect(boundaries[2].phase_index).toBe(2);
	});

	test("returns empty array for all empty inputs", () => {
		const result = extractTimeline([], [], [], [], []);
		expect(result).toEqual([]);
	});

	test("ignores non-PreToolUse and non-PostToolUseFailure events", () => {
		const events = [
			makeEvent(1000, "SessionStart", {}),
			makeEvent(2000, "PostToolUse", { tool_name: "Read" }),
			makeEvent(3000, "Notification", {}),
		];

		const result = extractTimeline(events, [], [], [], []);
		expect(result).toEqual([]);
	});

	describe("team events", () => {
		test("maps TeammateIdle to teammate_idle with agent_name", () => {
			const events = [
				makeEvent(1000, "TeammateIdle", { agent_name: "builder-1", agent_id: "abc-123" }),
			];

			const result = extractTimeline(events, [], [], [], []);

			const idle = result.find((e) => e.type === "teammate_idle");
			expect(idle).toBeDefined();
			expect(idle?.teammate_name).toBe("builder-1");
			expect(idle?.content_preview).toBe("builder-1 idle");
		});

		test("maps TeammateIdle falling back to agent_id when agent_name missing", () => {
			const events = [makeEvent(1000, "TeammateIdle", { agent_id: "abc-123" })];

			const result = extractTimeline(events, [], [], [], []);

			const idle = result.find((e) => e.type === "teammate_idle");
			expect(idle).toBeDefined();
			expect(idle?.teammate_name).toBe("abc-123");
			expect(idle?.content_preview).toBe("abc-123 idle");
		});

		test("maps TaskCompleted to task_complete with task_id and subject", () => {
			const events = [
				makeEvent(2000, "TaskCompleted", { task_id: "t-42", subject: "Fix login bug" }),
			];

			const result = extractTimeline(events, [], [], [], []);

			const taskComplete = result.find((e) => e.type === "task_complete");
			expect(taskComplete).toBeDefined();
			expect(taskComplete?.task_id).toBe("t-42");
			expect(taskComplete?.task_subject).toBe("Fix login bug");
			expect(taskComplete?.content_preview).toBe("Task completed: Fix login bug");
		});

		test("maps TaskCompleted with missing subject gracefully", () => {
			const events = [makeEvent(2000, "TaskCompleted", { task_id: "t-99" })];

			const result = extractTimeline(events, [], [], [], []);

			const taskComplete = result.find((e) => e.type === "task_complete");
			expect(taskComplete).toBeDefined();
			expect(taskComplete?.task_id).toBe("t-99");
			expect(taskComplete?.task_subject).toBeUndefined();
			expect(taskComplete?.content_preview).toBe("Task completed: unknown");
		});

		test("team events appear in chronological order with other entries", () => {
			const events = [
				makeEvent(1000, "PreToolUse", { tool_name: "Read", tool_use_id: "t1" }),
				makeEvent(2000, "TeammateIdle", { agent_name: "researcher" }),
				makeEvent(3000, "TaskCompleted", { task_id: "t-1", subject: "Research done" }),
				makeEvent(4000, "PreToolUse", { tool_name: "Edit", tool_use_id: "t2" }),
			];

			const result = extractTimeline(events, [], [], [], []);

			expect(result).toHaveLength(4);
			expect(result[0].type).toBe("tool_call");
			expect(result[1].type).toBe("teammate_idle");
			expect(result[2].type).toBe("task_complete");
			expect(result[3].type).toBe("tool_call");
		});
	});

	describe("agent lifecycle events", () => {
		test("maps SubagentStart to agent_spawn with name and type", () => {
			const events = [
				makeEvent(1000, "SubagentStart", {
					agent_id: "uuid-abc-123",
					agent_name: "builder-types",
					agent_type: "builder",
				}),
			];

			const result = extractTimeline(events, [], [], [], []);

			const spawn = result.find((e) => e.type === "agent_spawn");
			expect(spawn).toBeDefined();
			expect(spawn?.agent_id).toBe("uuid-abc-123");
			expect(spawn?.agent_name).toBe("builder-types");
			expect(spawn?.content_preview).toBe("Spawned builder-types (builder)");
		});

		test("maps SubagentStop to agent_stop", () => {
			const events = [
				makeEvent(2000, "SubagentStop", {
					agent_id: "uuid-abc-123",
				}),
			];
			const nameMap = new Map([["uuid-abc-123", "builder-types"]]);

			const result = extractTimeline(events, [], [], [], [], undefined, nameMap);

			const stop = result.find((e) => e.type === "agent_stop");
			expect(stop).toBeDefined();
			expect(stop?.agent_id).toBe("uuid-abc-123");
			expect(stop?.agent_name).toBe("builder-types");
			expect(stop?.content_preview).toBe("Stopped builder-types");
		});

		test("resolves names via nameMap when agent_name not in event data", () => {
			const events = [
				makeEvent(1000, "SubagentStart", {
					agent_id: "uuid-xyz-789",
					agent_type: "researcher",
				}),
			];
			const nameMap = new Map([["uuid-xyz-789", "researcher-1"]]);

			const result = extractTimeline(events, [], [], [], [], undefined, nameMap);

			const spawn = result.find((e) => e.type === "agent_spawn");
			expect(spawn?.agent_name).toBe("researcher-1");
		});

		test("falls back to truncated agent_id when no nameMap entry", () => {
			const events = [
				makeEvent(1000, "SubagentStart", {
					agent_id: "abcdefgh-long-uuid",
					agent_type: "builder",
				}),
			];

			const result = extractTimeline(events, [], [], [], []);

			const spawn = result.find((e) => e.type === "agent_spawn");
			expect(spawn?.content_preview).toBe("Spawned abcdefgh (builder)");
		});

		test("agent_spawn and agent_stop are structural (preserved when capping)", () => {
			const toolEvents = Array.from({ length: 600 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);
			const agentEvents = [
				makeEvent(500, "SubagentStart", {
					agent_id: "a1",
					agent_name: "builder-1",
					agent_type: "builder",
				}),
				makeEvent(50000, "SubagentStop", { agent_id: "a1" }),
			];

			const result = extractTimeline([...toolEvents, ...agentEvents], [], [], [], []);

			const spawns = result.filter((e) => e.type === "agent_spawn");
			const stops = result.filter((e) => e.type === "agent_stop");
			expect(spawns).toHaveLength(1);
			expect(stops).toHaveLength(1);
		});
	});

	describe("task link events", () => {
		const makeTaskLink = (
			overrides: Partial<TaskLink> & { action: TaskLink["action"]; task_id: string },
		): TaskLink => ({
			t: Date.now(),
			type: "task",
			session_id: "test-session",
			...overrides,
		});

		test("maps task create links to task_create entries", () => {
			const links: readonly LinkEvent[] = [
				makeTaskLink({
					t: 1000,
					action: "create",
					task_id: "t-1",
					subject: "Implement auth",
					agent: "uuid-lead",
				}),
			];
			const nameMap = new Map([["uuid-lead", "team-lead"]]);

			const result = extractTimeline([], [], [], [], [], links, nameMap);

			const create = result.find((e) => e.type === "task_create");
			expect(create).toBeDefined();
			expect(create?.agent_name).toBe("team-lead");
			expect(create?.content_preview).toBe("Task created: Implement auth");
		});

		test("maps task assign links to task_assign entries", () => {
			const links: readonly LinkEvent[] = [
				makeTaskLink({
					t: 2000,
					action: "assign",
					task_id: "t-1",
					subject: "Implement auth",
					owner: "builder-1",
				}),
			];

			const result = extractTimeline([], [], [], [], [], links);

			const assign = result.find((e) => e.type === "task_assign");
			expect(assign).toBeDefined();
			expect(assign?.agent_name).toBe("builder-1");
			expect(assign?.content_preview).toBe("Task assigned to builder-1: Implement auth");
		});

		test("falls back to task_id when subject missing", () => {
			const links: readonly LinkEvent[] = [
				makeTaskLink({ t: 1000, action: "create", task_id: "t-42" }),
			];

			const result = extractTimeline([], [], [], [], [], links);

			const create = result.find((e) => e.type === "task_create");
			expect(create?.content_preview).toBe("Task created: t-42");
		});

		test("ignores non-create/assign task actions", () => {
			const links: readonly LinkEvent[] = [
				makeTaskLink({ t: 1000, action: "status_change", task_id: "t-1", status: "completed" }),
			];

			const result = extractTimeline([], [], [], [], [], links);

			expect(
				result.filter((e) => e.type === "task_create" || e.type === "task_assign"),
			).toHaveLength(0);
		});

		test("task link entries appear in chronological order", () => {
			const events = [makeEvent(1000, "PreToolUse", { tool_name: "Read", tool_use_id: "t1" })];
			const links: readonly LinkEvent[] = [
				makeTaskLink({ t: 500, action: "create", task_id: "t-1", subject: "Setup" }),
				makeTaskLink({ t: 1500, action: "assign", task_id: "t-1", owner: "builder" }),
			];

			const result = extractTimeline(events, [], [], [], [], links);

			expect(result[0].type).toBe("task_create");
			expect(result[1].type).toBe("tool_call");
			expect(result[2].type).toBe("task_assign");
		});
	});

	describe("capping strategy", () => {
		test("caps at 500 entries for large sessions", () => {
			// Generate 600 PreToolUse events
			const events = Array.from({ length: 600 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);

			const phases = [makePhase("General", 0, 60000)];

			const result = extractTimeline(events, [], [], [], phases);

			expect(result.length).toBeLessThanOrEqual(500);
		});

		test("preserves all phase_boundary entries when capping", () => {
			// Generate 600 tool events + 5 phases
			const events = Array.from({ length: 600 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);

			const phases = Array.from({ length: 5 }, (_, i) =>
				makePhase(`Phase ${i}`, i * 12000, (i + 1) * 12000 - 1),
			);

			const result = extractTimeline(events, [], [], [], phases);

			const boundaries = result.filter((e) => e.type === "phase_boundary");
			expect(boundaries).toHaveLength(5);
		});

		test("preserves all user_prompt entries when capping", () => {
			// Generate 600 tool events + 10 user prompts
			const events = Array.from({ length: 600 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);

			const user_messages = Array.from({ length: 10 }, (_, i) =>
				makeUserMessage(i * 6000, `User prompt ${i}`),
			);

			const result = extractTimeline(events, [], user_messages, [], []);

			const prompts = result.filter((e) => e.type === "user_prompt");
			expect(prompts).toHaveLength(10);
		});

		test("preserves all teammate_idle entries when capping", () => {
			const toolEvents = Array.from({ length: 600 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);
			const idleEvents = Array.from({ length: 8 }, (_, i) =>
				makeEvent(i * 7500, "TeammateIdle", { agent_name: `agent-${i}` }),
			);

			const result = extractTimeline([...toolEvents, ...idleEvents], [], [], [], []);

			const idles = result.filter((e) => e.type === "teammate_idle");
			expect(idles).toHaveLength(8);
		});

		test("preserves all task_complete entries when capping", () => {
			const toolEvents = Array.from({ length: 600 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);
			const taskEvents = Array.from({ length: 6 }, (_, i) =>
				makeEvent(i * 10000, "TaskCompleted", {
					task_id: `task-${i}`,
					subject: `Task ${i}`,
				}),
			);

			const result = extractTimeline([...toolEvents, ...taskEvents], [], [], [], []);

			const tasks = result.filter((e) => e.type === "task_complete");
			expect(tasks).toHaveLength(6);
		});

		test("does not cap when under 500 entries", () => {
			const events = Array.from({ length: 100 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);

			const result = extractTimeline(events, [], [], [], []);

			expect(result).toHaveLength(100);
		});

		test("maintains chronological order after capping", () => {
			const events = Array.from({ length: 600 }, (_, i) =>
				makeEvent(i * 100, "PreToolUse", { tool_name: "Read", tool_use_id: `t${i}` }),
			);

			const phases = [makePhase("General", 0, 60000)];

			const result = extractTimeline(events, [], [], [], phases);

			const isSorted = result.every((entry, i) => i === 0 || entry.t >= result[i - 1].t);
			expect(isSorted).toBe(true);
		});
	});

	describe("agent_id attribution", () => {
		test("agent_spawn entries carry agent_id from event data", () => {
			const events = [
				makeEvent(1000, "SubagentStart", {
					agent_id: "uuid-abc-123",
					agent_name: "builder-types",
					agent_type: "builder",
				}),
			];

			const result = extractTimeline(events, [], [], [], []);

			const spawn = result.find((e) => e.type === "agent_spawn");
			expect(spawn?.agent_id).toBe("uuid-abc-123");
		});

		test("agent_stop entries carry agent_id", () => {
			const events = [
				makeEvent(2000, "SubagentStop", { agent_id: "uuid-abc-123" }),
			];

			const result = extractTimeline(events, [], [], [], []);

			const stop = result.find((e) => e.type === "agent_stop");
			expect(stop?.agent_id).toBe("uuid-abc-123");
		});

		test("task_create entries from links carry agent_name resolved via nameMap", () => {
			const links: readonly LinkEvent[] = [
				{
					t: 1000,
					type: "task",
					action: "create",
					task_id: "t-1",
					session_id: "s1",
					subject: "Build it",
					agent: "uuid-lead",
				} as TaskLink,
			];
			const nameMap = new Map([["uuid-lead", "team-lead"]]);

			const result = extractTimeline([], [], [], [], [], links, nameMap);

			const create = result.find((e) => e.type === "task_create");
			expect(create?.agent_name).toBe("team-lead");
		});

		test("task_assign entries carry owner as agent_name", () => {
			const links: readonly LinkEvent[] = [
				{
					t: 2000,
					type: "task",
					action: "assign",
					task_id: "t-1",
					session_id: "s1",
					owner: "builder-types",
					subject: "Build it",
				} as TaskLink,
			];

			const result = extractTimeline([], [], [], [], [], links);

			const assign = result.find((e) => e.type === "task_assign");
			expect(assign?.agent_name).toBe("builder-types");
		});
	});

	describe("message entries in timeline", () => {
		test("maps SubagentStart with agent_type to content_preview", () => {
			const events = [
				makeEvent(1000, "SubagentStart", {
					agent_id: "uuid-1",
					agent_name: "researcher-1",
					agent_type: "researcher",
				}),
			];

			const result = extractTimeline(events, [], [], [], []);

			const spawn = result.find((e) => e.type === "agent_spawn");
			expect(spawn?.content_preview).toBe("Spawned researcher-1 (researcher)");
		});

		test("maps SubagentStop with nameMap to content_preview", () => {
			const events = [
				makeEvent(5000, "SubagentStop", { agent_id: "uuid-1" }),
			];
			const nameMap = new Map([["uuid-1", "researcher-1"]]);

			const result = extractTimeline(events, [], [], [], [], undefined, nameMap);

			const stop = result.find((e) => e.type === "agent_stop");
			expect(stop?.content_preview).toBe("Stopped researcher-1");
		});

		test("task link entries include subject in content_preview", () => {
			const links: readonly LinkEvent[] = [
				{
					t: 1000,
					type: "task",
					action: "create",
					task_id: "t-1",
					session_id: "s1",
					subject: "Implement auth",
				} as TaskLink,
				{
					t: 2000,
					type: "task",
					action: "assign",
					task_id: "t-1",
					session_id: "s1",
					owner: "builder",
					subject: "Implement auth",
				} as TaskLink,
			];

			const result = extractTimeline([], [], [], [], [], links);

			const create = result.find((e) => e.type === "task_create");
			expect(create?.content_preview).toBe("Task created: Implement auth");

			const assign = result.find((e) => e.type === "task_assign");
			expect(assign?.content_preview).toBe("Task assigned to builder: Implement auth");
		});
	});
});

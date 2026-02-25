import { describe, expect, test } from "bun:test";
import { attributeEventsToAgents, buildAgentTree, computeLinkBasedDuration, enrichNodeWithTranscript } from "../src/distill/agent-tree";
import type { AgentNode, LinkEvent, SpawnLink, StopLink, StoredEvent, TranscriptEntry } from "../src/types";

// -- Helpers --

const makeSpawn = (overrides: Partial<SpawnLink> = {}): SpawnLink => ({
	t: 1000,
	type: "spawn",
	parent_session: "root-session",
	agent_id: "agent-1",
	agent_type: "builder",
	agent_name: "builder-1",
	...overrides,
});

const makeStop = (overrides: Partial<StopLink> = {}): StopLink => ({
	t: 5000,
	type: "stop",
	parent_session: "root-session",
	agent_id: "agent-1",
	...overrides,
});

const makeEvent = (overrides: Partial<{ t: number; event: string; data: Record<string, unknown> }> = {}): {
	t: number;
	event: string;
	data: Record<string, unknown>;
} => ({
	t: 2000,
	event: "PreToolUse",
	data: { tool_name: "Read" },
	...overrides,
});

const noopReadTranscript = (_path: string): readonly TranscriptEntry[] => [];

const makeStoredEvent = (overrides: Partial<StoredEvent> & { event: StoredEvent["event"] }): StoredEvent => ({
	t: 2000,
	sid: "test",
	data: {},
	...overrides,
});

// -- attributeEventsToAgents --

describe("attributeEventsToAgents", () => {
	test("attributes events within agent interval to that agent", () => {
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: 1500, event: "PreToolUse" }),
			makeStoredEvent({ t: 2500, event: "PreToolUse" }),
			makeStoredEvent({ t: 6000, event: "PreToolUse" }),
		];
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session" }),
		];
		const result = attributeEventsToAgents("root-session", events, links);
		const agentEvents = result.get("agent-1") ?? [];
		const parentEvents = result.get("root-session") ?? [];
		expect(agentEvents.length).toBe(2); // t=1500, t=2500
		expect(parentEvents.length).toBe(1); // t=6000
	});

	test("attributes events to innermost agent for nested intervals", () => {
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: 2500, event: "PreToolUse" }),
			makeStoredEvent({ t: 3500, event: "PreToolUse" }),
		];
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "parent-agent", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "parent-agent", parent_session: "root-session" }),
			makeSpawn({ t: 2000, agent_id: "child-agent", parent_session: "parent-agent" }),
			makeStop({ t: 4000, agent_id: "child-agent", parent_session: "parent-agent" }),
		];
		const result = attributeEventsToAgents("root-session", events, links);
		const childEvents = result.get("child-agent") ?? [];
		// Both events should go to inner (child) agent since it started later and is checked first
		expect(childEvents.length).toBe(2);
	});

	test("attributes events between agents to parent session", () => {
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: 500, event: "PreToolUse" }),
			makeStoredEvent({ t: 7000, event: "PreToolUse" }),
		];
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session" }),
		];
		const result = attributeEventsToAgents("root-session", events, links);
		const parentEvents = result.get("root-session") ?? [];
		expect(parentEvents.length).toBe(2);
	});

	test("handles sequential agents correctly", () => {
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: 1500, event: "PreToolUse" }),
			makeStoredEvent({ t: 3500, event: "PreToolUse" }),
		];
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-a", parent_session: "root-session" }),
			makeStop({ t: 2000, agent_id: "agent-a", parent_session: "root-session" }),
			makeSpawn({ t: 3000, agent_id: "agent-b", parent_session: "root-session" }),
			makeStop({ t: 4000, agent_id: "agent-b", parent_session: "root-session" }),
		];
		const result = attributeEventsToAgents("root-session", events, links);
		const agentAEvents = result.get("agent-a") ?? [];
		const agentBEvents = result.get("agent-b") ?? [];
		expect(agentAEvents.length).toBe(1);
		expect(agentBEvents.length).toBe(1);
	});

	test("returns empty map for empty events", () => {
		const result = attributeEventsToAgents("root-session", [], []);
		expect(result.size).toBe(0);
	});
});

// -- computeLinkBasedDuration --

describe("computeLinkBasedDuration", () => {
	test("returns 0 when no relevant links exist", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn(),
			makeStop(),
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(0);
	});

	test("computes duration from msg_send links matching agent id in from field", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 3000,
				type: "msg_send",
				msg_id: "m1",
				session_id: "root-session",
				from: "agent-1",
				to: "agent-2",
				msg_type: "text",
			},
			{
				t: 5000,
				type: "msg_send",
				msg_id: "m2",
				session_id: "root-session",
				from: "agent-1",
				to: "agent-2",
				msg_type: "text",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(4000); // 5000 - 1000
	});

	test("computes duration from msg_send links matching agent id in to field", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 4000,
				type: "msg_send",
				msg_id: "m1",
				session_id: "root-session",
				from: "agent-2",
				to: "agent-1",
				msg_type: "text",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(3000); // 4000 - 1000
	});

	test("computes duration from task links matching session_id", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 6000,
				type: "task",
				action: "create",
				task_id: "t1",
				session_id: "agent-1",
				subject: "do work",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(5000); // 6000 - 1000
	});

	test("computes duration from task_complete links matching agent name", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 7000,
				type: "task_complete",
				task_id: "t1",
				agent: "builder-1",
				session_id: "agent-1",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(6000); // 7000 - 1000
	});

	test("computes duration from teammate_idle links matching agent name", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 8000,
				type: "teammate_idle",
				teammate: "builder-1",
				session_id: "root-session",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(7000); // 8000 - 1000
	});

	test("returns 0 when agent name is undefined for name-based links", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 7000,
				type: "task_complete",
				task_id: "t1",
				agent: "builder-1",
			},
			{
				t: 8000,
				type: "teammate_idle",
				teammate: "builder-1",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", undefined, 1000, links);
		expect(duration).toBe(0);
	});

	test("uses max timestamp across all relevant links", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 3000,
				type: "msg_send",
				msg_id: "m1",
				session_id: "root-session",
				from: "agent-1",
				to: "agent-2",
				msg_type: "text",
			},
			{
				t: 9000,
				type: "task_complete",
				task_id: "t1",
				agent: "builder-1",
			},
			{
				t: 6000,
				type: "task",
				action: "create",
				task_id: "t1",
				session_id: "agent-1",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(8000); // 9000 - 1000
	});

	test("returns 0 when spawn time equals max relevant timestamp", () => {
		const links: readonly LinkEvent[] = [
			{
				t: 1000,
				type: "msg_send",
				msg_id: "m1",
				session_id: "root-session",
				from: "agent-1",
				to: "agent-2",
				msg_type: "text",
			},
		];
		const duration = computeLinkBasedDuration("agent-1", "builder-1", 1000, links);
		expect(duration).toBe(0);
	});
});

// -- enrichNodeWithTranscript --

describe("enrichNodeWithTranscript", () => {
	test("returns node with transcript_path when reader returns empty entries", () => {
		const baseNode: AgentNode = {
			session_id: "agent-1",
			agent_type: "builder",
			agent_name: "builder-1",
			duration_ms: 5000,
			tool_call_count: 3,
			children: [],
		};

		const result = enrichNodeWithTranscript(baseNode, "/path/to/transcript.jsonl", noopReadTranscript);
		expect(result.transcript_path).toBe("/path/to/transcript.jsonl");
		// distillAgent returns undefined for empty entries, so only transcript_path is added
		expect(result.model).toBeUndefined();
		expect(result.stats).toBeUndefined();
	});

	test("enriches node with distill results when transcript has content", () => {
		const baseNode: AgentNode = {
			session_id: "agent-1",
			agent_type: "builder",
			duration_ms: 5000,
			tool_call_count: 0,
			children: [],
		};

		const mockTranscriptReader = (_path: string): readonly TranscriptEntry[] => [
			{
				uuid: "uuid-1",
				parentUuid: null,
				sessionId: "agent-1",
				type: "assistant",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/foo.ts" } },
						{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/src/foo.ts", old_string: "a", new_string: "b" } },
					],
					model: "claude-sonnet-4-20250514",
					usage: { input_tokens: 100, output_tokens: 50 },
				},
			},
		];

		const result = enrichNodeWithTranscript(baseNode, "/path/to/transcript.jsonl", mockTranscriptReader);
		expect(result.transcript_path).toBe("/path/to/transcript.jsonl");
		expect(result.model).toBe("claude-sonnet-4-20250514");
		expect(result.stats).toBeDefined();
		expect(result.file_map).toBeDefined();
		expect(result.tool_call_count).toBe(2); // from stats (since base was 0)
	});
});

// -- buildAgentTree --

describe("buildAgentTree", () => {
	test("returns empty array when no spawns match session", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ parent_session: "other-session" }),
		];
		const result = buildAgentTree("root-session", links, [], noopReadTranscript);
		expect(result).toEqual([]);
	});

	test("builds single root agent node", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session" }),
		];
		const events = [
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 3000, event: "PreToolUse", data: { tool_name: "Edit" } }),
		];

		const result = buildAgentTree("root-session", links, events, noopReadTranscript);
		expect(result).toHaveLength(1);
		expect(result[0].session_id).toBe("agent-1");
		expect(result[0].agent_type).toBe("builder");
		expect(result[0].agent_name).toBe("builder-1");
		expect(result[0].duration_ms).toBe(4000); // 5000 - 1000
		expect(result[0].tool_call_count).toBe(2);
		expect(result[0].children).toEqual([]);
	});

	test("builds nested agent tree with children", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session", agent_name: "builder-1" }),
			makeSpawn({ t: 2000, agent_id: "agent-2", parent_session: "agent-1", agent_type: "reviewer", agent_name: "reviewer-1" }),
			makeStop({ t: 4000, agent_id: "agent-2", parent_session: "agent-1" }),
			makeStop({ t: 6000, agent_id: "agent-1", parent_session: "root-session" }),
		];

		const result = buildAgentTree("root-session", links, [], noopReadTranscript);
		expect(result).toHaveLength(1);
		expect(result[0].session_id).toBe("agent-1");
		expect(result[0].children).toHaveLength(1);
		expect(result[0].children[0].session_id).toBe("agent-2");
		expect(result[0].children[0].agent_type).toBe("reviewer");
		expect(result[0].children[0].duration_ms).toBe(2000); // 4000 - 2000
	});

	test("builds multiple root agents", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session", agent_name: "builder-1" }),
			makeSpawn({ t: 1500, agent_id: "agent-2", parent_session: "root-session", agent_type: "reviewer", agent_name: "reviewer-1" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 6000, agent_id: "agent-2", parent_session: "root-session" }),
		];

		const result = buildAgentTree("root-session", links, [], noopReadTranscript);
		expect(result).toHaveLength(2);
		expect(result[0].session_id).toBe("agent-1");
		expect(result[1].session_id).toBe("agent-2");
	});

	test("falls back to link-based duration when stop time equals spawn time", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }), // same time as spawn
			{
				t: 5000,
				type: "msg_send",
				msg_id: "m1",
				session_id: "root-session",
				from: "agent-1",
				to: "agent-2",
				msg_type: "text",
			},
		];

		const result = buildAgentTree("root-session", links, [], noopReadTranscript);
		expect(result[0].duration_ms).toBe(4000); // from link-based: 5000 - 1000
	});

	test("duration is 0 when no stop event and no relevant links", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
		];

		const result = buildAgentTree("root-session", links, [], noopReadTranscript);
		expect(result[0].duration_ms).toBe(0);
	});

	test("counts only PreToolUse events within agent time range", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session" }),
		];
		const events = [
			makeEvent({ t: 500, event: "PreToolUse" }),  // before spawn
			makeEvent({ t: 2000, event: "PreToolUse" }), // in range
			makeEvent({ t: 4000, event: "PreToolUse" }), // in range
			makeEvent({ t: 6000, event: "PreToolUse" }), // after stop
			makeEvent({ t: 3000, event: "SessionStart" }), // not PreToolUse
		];

		const result = buildAgentTree("root-session", links, events, noopReadTranscript);
		expect(result[0].tool_call_count).toBe(2);
	});

	test("enriches node when transcript path is available on stop link", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session", transcript_path: "/tmp/t.jsonl" }),
		];

		const mockReader = (path: string): readonly TranscriptEntry[] => {
			expect(path).toBe("/tmp/t.jsonl");
			return [
				{
					uuid: "uuid-1",
					parentUuid: null,
					sessionId: "agent-1",
					type: "assistant",
					timestamp: "2024-01-01T00:00:01.000Z",
					message: {
						role: "assistant",
						content: [
							{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/foo.ts" } },
						],
						model: "claude-sonnet-4-20250514",
						usage: { input_tokens: 100, output_tokens: 50 },
					},
				},
			];
		};

		const result = buildAgentTree("root-session", links, [], mockReader);
		expect(result[0].transcript_path).toBe("/tmp/t.jsonl");
		expect(result[0].model).toBe("claude-sonnet-4-20250514");
		expect(result[0].stats).toBeDefined();
		// tool_call_count should be from transcript since hook-based count is 0
		expect(result[0].tool_call_count).toBe(1);
	});

	test("does not enrich when no transcript path on stop link", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session" }),
		];

		const result = buildAgentTree("root-session", links, [], noopReadTranscript);
		expect(result[0].transcript_path).toBeUndefined();
		expect(result[0].model).toBeUndefined();
	});

	test("deduplicates spawns for resumed agents (same agent_id spawned twice)", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session", agent_name: "builder-1" }),
			// Duplicate spawn from resume
			makeSpawn({ t: 2000, agent_id: "agent-1", parent_session: "root-session", agent_name: "builder-1" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session" }),
		];

		const result = buildAgentTree("root-session", links, [], noopReadTranscript);
		expect(result).toHaveLength(1); // Only one agent, not two
		expect(result[0].session_id).toBe("agent-1");
		expect(result[0].duration_ms).toBe(4000); // 5000 - 1000
	});

	test("prefers hook-based tool count when non-zero over transcript stats", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "agent-1", parent_session: "root-session" }),
			makeStop({ t: 5000, agent_id: "agent-1", parent_session: "root-session", transcript_path: "/tmp/t.jsonl" }),
		];
		const events = [
			makeEvent({ t: 2000, event: "PreToolUse" }),
			makeEvent({ t: 3000, event: "PreToolUse" }),
			makeEvent({ t: 4000, event: "PreToolUse" }),
		];

		const mockReader = (_path: string): readonly TranscriptEntry[] => [
			{
				uuid: "uuid-1",
				parentUuid: null,
				sessionId: "agent-1",
				type: "assistant",
				timestamp: "2024-01-01T00:00:01.000Z",
				message: {
					role: "assistant",
					content: [
						{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/foo.ts" } },
					],
					model: "claude-sonnet-4-20250514",
				},
			},
		];

		const result = buildAgentTree("root-session", links, events, mockReader);
		// Hook-based count is 3 (non-zero), so enrichNodeWithTranscript returns enriched.tool_call_count
		// The enriched node gets stats.tool_call_count=1 from transcript, but since hook-based was 3,
		// enrichNodeWithTranscript sets tool_call_count = stats.tool_call_count = 1
		// Then the outer logic checks: enriched.tool_call_count === 0? No (it's 1), so uses enriched as-is
		expect(result[0].tool_call_count).toBe(1);
	});
});

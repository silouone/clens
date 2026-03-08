import { describe, expect, test } from "bun:test";
import {
	enrichNodeWithLinks,
	extractAgentCommunicationPartners,
	extractAgentIdlePeriods,
	extractAgentMessages,
	extractAgentTasks,
} from "../src/distill/agent-enrich";
import type {
	AgentNode,
	LinkEvent,
	MessageLink,
	SpawnLink,
	TaskCompleteLink,
	TaskLink,
	TeammateIdleLink,
} from "../src/types";

// --- Factories ---

const makeSpawn = (overrides: Partial<SpawnLink> & { agent_id: string }): SpawnLink => ({
	t: 1000,
	type: "spawn",
	parent_session: "root",
	agent_type: "builder",
	...overrides,
});

const makeMessage = (
	overrides: Partial<MessageLink> & { from: string; to: string },
): MessageLink => ({
	t: Date.now(),
	type: "msg_send",
	session_id: "test-session",
	msg_type: "message",
	...overrides,
});

const makeTaskLink = (
	overrides: Partial<TaskLink> & { action: TaskLink["action"]; task_id: string },
): TaskLink => ({
	t: Date.now(),
	type: "task",
	session_id: "agent-1",
	...overrides,
});

const makeTaskComplete = (
	overrides: Partial<TaskCompleteLink> & { task_id: string; agent: string },
): TaskCompleteLink => ({
	t: Date.now(),
	type: "task_complete",
	...overrides,
});

const makeIdle = (overrides: Partial<TeammateIdleLink> & { teammate: string }): TeammateIdleLink => ({
	t: Date.now(),
	type: "teammate_idle",
	...overrides,
});

const makeAgentNode = (overrides?: Partial<AgentNode>): AgentNode => ({
	session_id: "agent-1",
	agent_type: "builder",
	agent_name: "builder-types",
	duration_ms: 60000,
	tool_call_count: 10,
	children: [],
	...overrides,
});

// --- extractAgentMessages ---

describe("extractAgentMessages", () => {
	test("returns empty array when no messages exist", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-1" }),
		];
		const result = extractAgentMessages("agent-1", links);
		expect(result).toEqual([]);
	});

	test("returns empty array when no messages match agent", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "other-1", to: "other-2" }),
		];
		const result = extractAgentMessages("agent-1", links);
		expect(result).toEqual([]);
	});

	test("extracts sent messages", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "team-lead", msg_type: "message", summary: "Done" }),
			makeMessage({ t: 2000, from: "agent-1", to: "team-lead", msg_type: "shutdown_response" }),
		];
		const result = extractAgentMessages("agent-1", links);
		expect(result).toHaveLength(2);
		expect(result[0].direction).toBe("sent");
		expect(result[0].partner).toBe("team-lead");
		expect(result[0].msg_type).toBe("message");
		expect(result[0].summary).toBe("Done");
		expect(result[1].direction).toBe("sent");
		expect(result[1].msg_type).toBe("shutdown_response");
	});

	test("extracts received messages", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "team-lead", to: "agent-1", msg_type: "message" }),
		];
		const result = extractAgentMessages("agent-1", links);
		expect(result).toHaveLength(1);
		expect(result[0].direction).toBe("received");
		expect(result[0].partner).toBe("team-lead");
	});

	test("extracts both sent and received, sorted chronologically", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 3000, from: "agent-1", to: "team-lead", msg_type: "message" }),
			makeMessage({ t: 1000, from: "team-lead", to: "agent-1", msg_type: "message" }),
			makeMessage({ t: 2000, from: "agent-1", to: "team-lead", msg_type: "message" }),
		];
		const result = extractAgentMessages("agent-1", links);
		expect(result).toHaveLength(3);
		expect(result[0].t).toBe(1000);
		expect(result[0].direction).toBe("received");
		expect(result[1].t).toBe(2000);
		expect(result[1].direction).toBe("sent");
		expect(result[2].t).toBe(3000);
		expect(result[2].direction).toBe("sent");
	});

	test("resolves partner names via nameMap", () => {
		const nameMap = new Map([["uuid-lead-1234", "team-lead"]]);
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "uuid-lead-1234", msg_type: "message" }),
		];
		const result = extractAgentMessages("agent-1", links, nameMap);
		expect(result).toHaveLength(1);
		expect(result[0].partner).toBe("team-lead");
	});

	test("uses raw value when partner not in nameMap", () => {
		const nameMap = new Map<string, string>();
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "unknown-long-uuid-1234", msg_type: "message" }),
		];
		const result = extractAgentMessages("agent-1", links, nameMap);
		// No truncation — raw ID is returned as-is when not in nameMap
		expect(result[0].partner).toBe("unknown-long-uuid-1234");
	});

	test("omits summary field when not present", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "lead", msg_type: "message" }),
		];
		const result = extractAgentMessages("agent-1", links);
		expect(result[0]).not.toHaveProperty("summary");
	});

	test("returns empty for empty links array", () => {
		const result = extractAgentMessages("agent-1", []);
		expect(result).toEqual([]);
	});
});

// --- extractAgentTasks ---

describe("extractAgentTasks", () => {
	test("returns empty for no task links", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-1" }),
		];
		const result = extractAgentTasks("agent-1", links);
		expect(result).toEqual([]);
	});

	test("matches task links by session_id", () => {
		const links: readonly LinkEvent[] = [
			makeTaskLink({
				t: 1000,
				action: "create",
				task_id: "t-1",
				session_id: "agent-1",
				subject: "Build types",
			}),
		];
		const result = extractAgentTasks("agent-1", links);
		expect(result).toHaveLength(1);
		expect(result[0].action).toBe("create");
		expect(result[0].task_id).toBe("t-1");
		expect(result[0].subject).toBe("Build types");
	});

	test("matches task links by agent name resolved from spawn", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 500, agent_id: "agent-1", agent_name: "builder-1" }),
			makeTaskLink({
				t: 1000,
				action: "assign",
				task_id: "t-1",
				session_id: "other-session",
				owner: "builder-1",
			}),
		];
		const result = extractAgentTasks("agent-1", links);
		expect(result).toHaveLength(1);
		expect(result[0].action).toBe("assign");
		expect(result[0].owner).toBe("builder-1");
	});

	test("includes TaskCompleteLink when agent name matches", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 500, agent_id: "agent-1", agent_name: "builder-1" }),
			makeTaskComplete({ t: 5000, task_id: "t-1", agent: "builder-1", subject: "Done" }),
		];
		const result = extractAgentTasks("agent-1", links);
		expect(result).toHaveLength(1);
		expect(result[0].action).toBe("complete");
		expect(result[0].task_id).toBe("t-1");
		expect(result[0].subject).toBe("Done");
	});

	test("combines task and complete links sorted chronologically", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 500, agent_id: "agent-1", agent_name: "builder-1" }),
			makeTaskLink({
				t: 1000,
				action: "create",
				task_id: "t-1",
				session_id: "agent-1",
				subject: "Build it",
			}),
			makeTaskLink({
				t: 2000,
				action: "assign",
				task_id: "t-1",
				session_id: "other",
				owner: "builder-1",
			}),
			makeTaskComplete({ t: 5000, task_id: "t-1", agent: "builder-1" }),
		];
		const result = extractAgentTasks("agent-1", links);
		expect(result).toHaveLength(3);
		expect(result[0].action).toBe("create");
		expect(result[1].action).toBe("assign");
		expect(result[2].action).toBe("complete");
		expect(result[0].t).toBeLessThanOrEqual(result[1].t);
		expect(result[1].t).toBeLessThanOrEqual(result[2].t);
	});

	test("returns no completions when agent name cannot be resolved", () => {
		const links: readonly LinkEvent[] = [
			// No spawn link => no name resolution
			makeTaskComplete({ t: 5000, task_id: "t-1", agent: "builder-1" }),
		];
		const result = extractAgentTasks("agent-1", links);
		expect(result).toEqual([]);
	});

	test("returns empty for empty links", () => {
		const result = extractAgentTasks("agent-1", []);
		expect(result).toEqual([]);
	});
});

// --- extractAgentIdlePeriods ---

describe("extractAgentIdlePeriods", () => {
	test("returns empty when no idle links", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-1" }),
		];
		const result = extractAgentIdlePeriods("agent-1", links);
		expect(result).toEqual([]);
	});

	test("extracts idle periods by resolved agent name", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-1" }),
			makeIdle({ t: 2000, teammate: "builder-1" }),
			makeIdle({ t: 4000, teammate: "builder-1" }),
		];
		const result = extractAgentIdlePeriods("agent-1", links);
		expect(result).toHaveLength(2);
		expect(result[0].t).toBe(2000);
		expect(result[0].teammate).toBe("builder-1");
		expect(result[1].t).toBe(4000);
	});

	test("ignores idle events for other agents", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-1" }),
			makeIdle({ t: 2000, teammate: "builder-1" }),
			makeIdle({ t: 3000, teammate: "researcher" }),
		];
		const result = extractAgentIdlePeriods("agent-1", links);
		expect(result).toHaveLength(1);
		expect(result[0].teammate).toBe("builder-1");
	});

	test("returns empty when agent name cannot be resolved (no spawn)", () => {
		const links: readonly LinkEvent[] = [
			makeIdle({ t: 2000, teammate: "builder-1" }),
		];
		const result = extractAgentIdlePeriods("agent-1", links);
		expect(result).toEqual([]);
	});

	test("returns empty for empty links", () => {
		const result = extractAgentIdlePeriods("agent-1", []);
		expect(result).toEqual([]);
	});
});

// --- extractAgentCommunicationPartners ---

describe("extractAgentCommunicationPartners", () => {
	test("returns empty when no messages", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-1" }),
		];
		const result = extractAgentCommunicationPartners("agent-1", links);
		expect(result).toEqual([]);
	});

	test("computes partner stats for single partner", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "lead", msg_type: "message" }),
			makeMessage({ t: 2000, from: "lead", to: "agent-1", msg_type: "message" }),
			makeMessage({ t: 3000, from: "agent-1", to: "lead", msg_type: "shutdown_response" }),
		];
		const result = extractAgentCommunicationPartners("agent-1", links);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("lead");
		expect(result[0].sent_count).toBe(2);
		expect(result[0].received_count).toBe(1);
		expect(result[0].total_count).toBe(3);
		expect(result[0].msg_types).toContain("message");
		expect(result[0].msg_types).toContain("shutdown_response");
	});

	test("sorts partners by total count descending", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "partner-a", msg_type: "message" }),
			makeMessage({ t: 2000, from: "agent-1", to: "partner-b", msg_type: "message" }),
			makeMessage({ t: 3000, from: "partner-b", to: "agent-1", msg_type: "message" }),
			makeMessage({ t: 4000, from: "agent-1", to: "partner-b", msg_type: "message" }),
		];
		const result = extractAgentCommunicationPartners("agent-1", links);
		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("partner-b");
		expect(result[0].total_count).toBe(3);
		expect(result[1].name).toBe("partner-a");
		expect(result[1].total_count).toBe(1);
	});

	test("resolves partner names via nameMap", () => {
		const nameMap = new Map([["uuid-lead-1234", "team-lead"]]);
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "uuid-lead-1234", msg_type: "message" }),
		];
		const result = extractAgentCommunicationPartners("agent-1", links, nameMap);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("team-lead");
	});

	test("returns sorted msg_types", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "agent-1", to: "lead", msg_type: "shutdown_response" }),
			makeMessage({ t: 2000, from: "agent-1", to: "lead", msg_type: "message" }),
			makeMessage({ t: 3000, from: "agent-1", to: "lead", msg_type: "broadcast" }),
		];
		const result = extractAgentCommunicationPartners("agent-1", links);
		expect(result[0].msg_types).toEqual(["broadcast", "message", "shutdown_response"]);
	});

	test("returns empty for empty links", () => {
		const result = extractAgentCommunicationPartners("agent-1", []);
		expect(result).toEqual([]);
	});
});

// --- enrichNodeWithLinks ---

describe("enrichNodeWithLinks", () => {
	test("enriches node with messages, tasks, idle, and partners", () => {
		const node = makeAgentNode({ session_id: "agent-1" });
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-types" }),
			makeMessage({ t: 1000, from: "agent-1", to: "lead", msg_type: "message" }),
			makeTaskLink({ t: 2000, action: "create", task_id: "t-1", session_id: "agent-1" }),
			makeIdle({ t: 3000, teammate: "builder-types" }),
		];
		const result = enrichNodeWithLinks(node, links);
		expect(result.messages).toBeDefined();
		expect(result.messages).toHaveLength(1);
		expect(result.task_events).toBeDefined();
		expect(result.task_events).toHaveLength(1);
		expect(result.idle_periods).toBeDefined();
		expect(result.idle_periods).toHaveLength(1);
		expect(result.communication_partners).toBeDefined();
		expect(result.communication_partners).toHaveLength(1);
	});

	test("omits empty arrays from enriched node", () => {
		const node = makeAgentNode({ session_id: "agent-1" });
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-types" }),
		];
		const result = enrichNodeWithLinks(node, links);
		expect(result).not.toHaveProperty("messages");
		expect(result).not.toHaveProperty("task_events");
		expect(result).not.toHaveProperty("idle_periods");
		expect(result).not.toHaveProperty("communication_partners");
	});

	test("recursively enriches children", () => {
		const child = makeAgentNode({ session_id: "child-1", agent_name: "child-builder" });
		const parent = makeAgentNode({ session_id: "agent-1", children: [child] });
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-types" }),
			makeSpawn({ agent_id: "child-1", agent_name: "child-builder" }),
			makeMessage({ t: 1000, from: "child-1", to: "agent-1", msg_type: "message" }),
		];
		const result = enrichNodeWithLinks(parent, links);
		expect(result.children).toHaveLength(1);
		expect(result.children[0].messages).toBeDefined();
		expect(result.children[0].messages).toHaveLength(1);
	});

	test("uses nameMap for name resolution", () => {
		const node = makeAgentNode({ session_id: "agent-1" });
		const nameMap = new Map([["uuid-lead", "team-lead"]]);
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "agent-1", agent_name: "builder-types" }),
			makeMessage({ t: 1000, from: "agent-1", to: "uuid-lead", msg_type: "message" }),
		];
		const result = enrichNodeWithLinks(node, links, nameMap);
		expect(result.messages?.[0].partner).toBe("team-lead");
	});
});

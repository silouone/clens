import { describe, expect, test } from "bun:test";
import { buildCommGraph } from "../src/distill/comm-graph";
import type { LinkEvent, MessageLink } from "../src/types";

const makeMessageLink = (
	overrides: Partial<MessageLink> & { from: string; to: string },
): MessageLink => ({
	t: Date.now(),
	type: "msg_send",
	session_id: "test-session",
	msg_type: "message",
	...overrides,
});

describe("buildCommGraph", () => {
	test("returns empty array for empty links", () => {
		const result = buildCommGraph([]);
		expect(result).toEqual([]);
	});

	test("returns empty array when no msg_send links exist", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "child", agent_type: "builder" },
			{ t: 2000, type: "stop", parent_session: "root", agent_id: "child" },
		];
		const result = buildCommGraph(links);
		expect(result).toEqual([]);
	});

	test("groups messages by (from, to) pair", () => {
		const links: readonly LinkEvent[] = [
			makeMessageLink({ t: 1000, from: "team-lead", to: "builder-a", msg_type: "message" }),
			makeMessageLink({ t: 2000, from: "team-lead", to: "builder-a", msg_type: "message" }),
			makeMessageLink({ t: 3000, from: "team-lead", to: "builder-b", msg_type: "message" }),
		];
		const result = buildCommGraph(links);
		expect(result.length).toBe(2);
		const tlToA = result.find((e) => e.to === "builder-a");
		expect(tlToA?.count).toBe(2);
		const tlToB = result.find((e) => e.to === "builder-b");
		expect(tlToB?.count).toBe(1);
	});

	test("sorts by count descending", () => {
		const links: readonly LinkEvent[] = [
			makeMessageLink({ t: 1000, from: "a", to: "b", msg_type: "message" }),
			makeMessageLink({ t: 2000, from: "c", to: "d", msg_type: "message" }),
			makeMessageLink({ t: 3000, from: "c", to: "d", msg_type: "message" }),
			makeMessageLink({ t: 4000, from: "c", to: "d", msg_type: "message" }),
		];
		const result = buildCommGraph(links);
		expect(result[0].from).toBe("c");
		expect(result[0].to).toBe("d");
		expect(result[0].count).toBe(3);
		expect(result[1].from).toBe("a");
		expect(result[1].count).toBe(1);
	});

	test("collects unique msg_types per edge", () => {
		const links: readonly LinkEvent[] = [
			makeMessageLink({ t: 1000, from: "lead", to: "worker", msg_type: "message" }),
			makeMessageLink({ t: 2000, from: "lead", to: "worker", msg_type: "shutdown_request" }),
			makeMessageLink({ t: 3000, from: "lead", to: "worker", msg_type: "message" }),
		];
		const result = buildCommGraph(links);
		expect(result.length).toBe(1);
		expect(result[0].count).toBe(3);
		expect(result[0].msg_types).toContain("message");
		expect(result[0].msg_types).toContain("shutdown_request");
		expect(result[0].msg_types.length).toBe(2);
	});

	test("differentiates direction (a->b vs b->a)", () => {
		const links: readonly LinkEvent[] = [
			makeMessageLink({ t: 1000, from: "lead", to: "worker", msg_type: "message" }),
			makeMessageLink({ t: 2000, from: "worker", to: "lead", msg_type: "message" }),
		];
		const result = buildCommGraph(links);
		expect(result.length).toBe(2);
		const leadToWorker = result.find((e) => e.from === "lead" && e.to === "worker");
		const workerToLead = result.find((e) => e.from === "worker" && e.to === "lead");
		expect(leadToWorker?.count).toBe(1);
		expect(workerToLead?.count).toBe(1);
	});

	test("includes task_complete alongside message edges", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "child", agent_type: "builder", agent_name: "worker" },
			makeMessageLink({ t: 2000, from: "lead", to: "worker", msg_type: "message" }),
			{ t: 3000, type: "task_complete", task_id: "t1", agent: "worker", subject: "Done" },
		];
		const result = buildCommGraph(links);
		// Should have 2 edges: 1 message + 1 task_complete
		expect(result.length).toBe(2);
		const msgEdge = result.find((e) => e.edge_type === "message");
		expect(msgEdge?.from).toBe("lead");
		expect(msgEdge?.count).toBe(1);
		const tcEdge = result.find((e) => e.edge_type === "task_complete");
		expect(tcEdge).toBeDefined();
		expect(tcEdge?.from).toBe("worker");
		expect(tcEdge?.count).toBe(1);
	});
});

describe("buildCommGraph with nameMap", () => {
	test("resolves UUIDs to names when nameMap provided", () => {
		const nameMap = new Map([
			["uuid-lead-1234", "team-lead"],
			["uuid-builder-5678", "builder-types"],
		]);
		// from is the sender's session UUID; to is the recipient's agent name
		const links: readonly LinkEvent[] = [
			makeMessageLink({
				t: 1000,
				from: "uuid-lead-1234",
				to: "builder-types",
				msg_type: "message",
			}),
			makeMessageLink({
				t: 2000,
				from: "uuid-builder-5678",
				to: "team-lead",
				msg_type: "message",
			}),
		];
		const result = buildCommGraph(links, nameMap);
		expect(result.length).toBe(2);
		const leadToBuilder = result.find((e) => e.from === "team-lead");
		expect(leadToBuilder).toBeDefined();
		expect(leadToBuilder?.from_id).toBe("uuid-lead-1234");
		expect(leadToBuilder?.from_name).toBe("team-lead");
		expect(leadToBuilder?.to).toBe("builder-types");
		expect(leadToBuilder?.to_name).toBe("builder-types");
		expect(leadToBuilder?.to_id).toBe("uuid-builder-5678");
		const builderToLead = result.find((e) => e.from === "builder-types");
		expect(builderToLead).toBeDefined();
		expect(builderToLead?.from_id).toBe("uuid-builder-5678");
		expect(builderToLead?.from_name).toBe("builder-types");
		expect(builderToLead?.to).toBe("team-lead");
		expect(builderToLead?.to_name).toBe("team-lead");
		expect(builderToLead?.to_id).toBe("uuid-lead-1234");
	});

	test("uses raw value when recipient not in nameMap", () => {
		const nameMap = new Map([["uuid-lead-1234", "team-lead"]]);
		const links: readonly LinkEvent[] = [
			makeMessageLink({
				t: 1000,
				from: "uuid-lead-1234",
				to: "unknown-agent-uuid-9999",
				msg_type: "message",
			}),
		];
		const result = buildCommGraph(links, nameMap);
		expect(result.length).toBe(1);
		expect(result[0].from_id).toBe("uuid-lead-1234");
		expect(result[0].from_name).toBe("team-lead");
		expect(result[0].from).toBe("team-lead");
		// to is the raw recipient name — no truncation
		expect(result[0].to_name).toBe("unknown-agent-uuid-9999");
		expect(result[0].to).toBe("unknown-agent-uuid-9999");
	});

	test("leaves names unchanged when no nameMap provided", () => {
		const links: readonly LinkEvent[] = [
			makeMessageLink({ t: 1000, from: "raw-uuid-from", to: "raw-uuid-to", msg_type: "message" }),
		];
		const result = buildCommGraph(links);
		expect(result[0].from_id).toBe("raw-uuid-from");
		expect(result[0].from_name).toBe("raw-uuid-from");
		expect(result[0].from).toBe("raw-uuid-from");
		expect(result[0].to_name).toBe("raw-uuid-to");
		expect(result[0].to_id).toBe("raw-uuid-to");
		expect(result[0].to).toBe("raw-uuid-to");
	});
});

describe("buildCommGraph with task-based coordination", () => {
	test("creates task_complete edges from task_complete links", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "child-1", agent_type: "builder", agent_name: "builder-a" },
			{ t: 2000, type: "task_complete", task_id: "t1", agent: "builder-a", subject: "Done" },
			{ t: 3000, type: "task_complete", task_id: "t2", agent: "builder-a", subject: "Also done" },
		];
		const result = buildCommGraph(links);
		const tcEdges = result.filter((e) => e.edge_type === "task_complete");
		expect(tcEdges.length).toBe(1);
		expect(tcEdges[0].from).toBe("builder-a");
		expect(tcEdges[0].to).toBe("root");
		expect(tcEdges[0].count).toBe(2);
	});

	test("creates idle_notify edges from teammate_idle links", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "child-1", agent_type: "builder", agent_name: "builder-a" },
			{ t: 2000, type: "teammate_idle", teammate: "builder-a" },
			{ t: 3000, type: "teammate_idle", teammate: "builder-a" },
		];
		const result = buildCommGraph(links);
		const idleEdges = result.filter((e) => e.edge_type === "idle_notify");
		expect(idleEdges.length).toBe(1);
		expect(idleEdges[0].from).toBe("builder-a");
		expect(idleEdges[0].count).toBe(2);
	});

	test("creates task_assign edges from task links with assign action", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "child-1", agent_type: "builder", agent_name: "builder-a" },
			{ t: 2000, type: "task", action: "assign", task_id: "t1", session_id: "root", agent: "leader", owner: "builder-a" },
		];
		const result = buildCommGraph(links);
		const assignEdges = result.filter((e) => e.edge_type === "task_assign");
		expect(assignEdges.length).toBe(1);
		expect(assignEdges[0].from).toBe("leader");
		expect(assignEdges[0].to).toBe("builder-a");
		expect(assignEdges[0].count).toBe(1);
	});

	test("ignores task links with create action (not assign)", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "task", action: "create", task_id: "t1", session_id: "root", subject: "Work" },
		];
		const result = buildCommGraph(links);
		expect(result.length).toBe(0);
	});

	test("combines message and task-based edges together", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "child-1", agent_type: "builder", agent_name: "builder-a" },
			makeMessageLink({ t: 2000, from: "root", to: "builder-a", msg_type: "message" }),
			{ t: 3000, type: "task_complete", task_id: "t1", agent: "builder-a", subject: "Done" },
			{ t: 4000, type: "teammate_idle", teammate: "builder-a" },
		];
		const result = buildCommGraph(links);
		// Should have message, task_complete, and idle_notify edges
		const edgeTypes = result.map((e) => e.edge_type);
		expect(edgeTypes).toContain("message");
		expect(edgeTypes).toContain("task_complete");
		expect(edgeTypes).toContain("idle_notify");
	});

	test("handles null agent_name gracefully by using agent_id", () => {
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "uuid-abc", agent_type: "builder" },
			{ t: 2000, type: "task_complete", task_id: "t1", agent: "uuid-abc" },
		];
		const result = buildCommGraph(links);
		const tcEdge = result.find((e) => e.edge_type === "task_complete");
		expect(tcEdge).toBeDefined();
		expect(tcEdge?.from).toBe("uuid-abc");
	});

	test("buildNameMap generates fallback names for agents without agent_name", () => {
		const { buildNameMap } = require("../src/utils");
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "abcd1234-5678", agent_type: "builder" },
			{ t: 2000, type: "spawn", parent_session: "root", agent_id: "efgh5678-9abc", agent_type: "reviewer", agent_name: "my-reviewer" },
		];
		const nameMap = buildNameMap(links);
		// Agent without name gets fallback: agent_type
		expect(nameMap.get("abcd1234-5678")).toBe("builder");
		// Agent with name keeps its name
		expect(nameMap.get("efgh5678-9abc")).toBe("my-reviewer");
	});

	test("nameMap with generated fallback names resolves comm graph edges", () => {
		const { buildNameMap } = require("../src/utils");
		const links: readonly LinkEvent[] = [
			{ t: 1000, type: "spawn", parent_session: "root", agent_id: "uuid-nona", agent_type: "builder" },
			makeMessageLink({ t: 2000, from: "root", to: "builder-uuid", msg_type: "message" }),
			{ t: 3000, type: "task_complete", task_id: "t1", agent: "builder-uuid" },
		];
		const nameMap = buildNameMap(links);
		const result = buildCommGraph(links, nameMap);
		// Should have edges even with unnamed agents
		expect(result.length).toBeGreaterThan(0);
	});
});


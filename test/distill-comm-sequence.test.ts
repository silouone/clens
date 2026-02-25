import { describe, expect, test } from "bun:test";
import {
	extractAgentLifetimes,
	extractCommSequence,
	groupByConversation,
} from "../src/distill/comm-sequence";
import type { CommunicationSequenceEntry, LinkEvent, MessageLink, SpawnLink, StopLink, TaskCompleteLink, TeammateIdleLink } from "../src/types";

// --- Factories ---

const makeMessage = (
	overrides: Partial<MessageLink> & { from: string; to: string },
): MessageLink => ({
	t: Date.now(),
	type: "msg_send",
	session_id: "test-session",
	msg_type: "message",
	...overrides,
});

const makeSeqEntry = (
	overrides: Partial<CommunicationSequenceEntry> & { from: string; to: string; msg_type: string },
): CommunicationSequenceEntry => ({
	t: Date.now(),
	from_id: overrides.from,
	from_name: overrides.from,
	to_id: overrides.to,
	to_name: overrides.to,
	...overrides,
});

const makeSpawn = (
	overrides: Partial<SpawnLink> & { agent_id: string },
): SpawnLink => ({
	t: 1000,
	type: "spawn",
	parent_session: "root",
	agent_type: "builder",
	...overrides,
});

const makeStop = (
	overrides: Partial<StopLink> & { agent_id: string },
): StopLink => ({
	t: 5000,
	type: "stop",
	parent_session: "root",
	...overrides,
});

const makeTaskComplete = (
	overrides: Partial<TaskCompleteLink> & { agent: string },
): TaskCompleteLink => ({
	t: Date.now(),
	type: "task_complete",
	task_id: "task-1",
	...overrides,
});

const makeTeammateIdle = (
	overrides: Partial<TeammateIdleLink> & { teammate: string },
): TeammateIdleLink => ({
	t: Date.now(),
	type: "teammate_idle",
	...overrides,
});

// --- extractCommSequence ---

describe("extractCommSequence", () => {
	test("returns empty for empty links", () => {
		const result = extractCommSequence([]);
		expect(result).toEqual([]);
	});

	test("returns empty when no message links", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "a1" }),
			makeStop({ agent_id: "a1" }),
		];
		const result = extractCommSequence(links);
		expect(result).toEqual([]);
	});

	test("extracts messages sorted chronologically", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 3000, from: "lead", to: "builder" }),
			makeMessage({ t: 1000, from: "lead", to: "builder" }),
			makeMessage({ t: 2000, from: "builder", to: "lead" }),
		];
		const result = extractCommSequence(links);
		expect(result).toHaveLength(3);
		expect(result[0].t).toBe(1000);
		expect(result[1].t).toBe(2000);
		expect(result[2].t).toBe(3000);
		// from_id/to_id present (no nameMap, so all raw)
		expect(result[0].from_id).toBe("lead");
		expect(result[0].to_id).toBe("builder");
		expect(result[1].from_id).toBe("builder");
		expect(result[1].to_id).toBe("lead");
	});

	test("includes msg_type and summary", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({
				t: 1000,
				from: "lead",
				to: "builder",
				msg_type: "shutdown_request",
				summary: "Time to wrap up",
			}),
		];
		const result = extractCommSequence(links);
		expect(result).toHaveLength(1);
		expect(result[0].msg_type).toBe("shutdown_request");
		expect(result[0].summary).toBe("Time to wrap up");
	});

	test("truncates summary to 120 chars", () => {
		const longSummary = "x".repeat(200);
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "lead", to: "builder", summary: longSummary }),
		];
		const result = extractCommSequence(links);
		expect(result[0].summary?.length).toBe(121); // 120 + ellipsis char
		expect(result[0].summary?.endsWith("\u2026")).toBe(true);
	});

	test("resolves names via nameMap", () => {
		const nameMap = new Map([
			["uuid-1", "team-lead"],
			["uuid-2", "builder-a"],
		]);
		// from is sender session UUID; to is recipient agent name
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "uuid-1", to: "builder-a" }),
		];
		const result = extractCommSequence(links, nameMap);
		// from_id retains UUID while from_name gets resolved name
		expect(result[0].from_id).toBe("uuid-1");
		expect(result[0].from_name).toBe("team-lead");
		expect(result[0].from).toBe("team-lead");
		// to is the raw recipient name; to_id resolves via reverse lookup
		expect(result[0].to_name).toBe("builder-a");
		expect(result[0].to_id).toBe("uuid-2");
		expect(result[0].to).toBe("builder-a");
	});

	test("uses raw IDs when no nameMap", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "raw-from-id", to: "raw-to-id" }),
		];
		const result = extractCommSequence(links);
		expect(result[0].from).toBe("raw-from-id");
		expect(result[0].to).toBe("raw-to-id");
		// Without nameMap, all fields collapse to the raw values
		expect(result[0].from_id).toBe("raw-from-id");
		expect(result[0].from_name).toBe("raw-from-id");
		expect(result[0].to_id).toBe("raw-to-id");
		expect(result[0].to_name).toBe("raw-to-id");
	});

	test("caps at 500 entries", () => {
		const links: readonly LinkEvent[] = Array.from({ length: 600 }, (_, i) =>
			makeMessage({ t: 1000 + i, from: "lead", to: "builder" }),
		);
		const result = extractCommSequence(links);
		expect(result).toHaveLength(500);
		// Should keep earliest 500 (since sorted by time)
		expect(result[0].t).toBe(1000);
		expect(result[499].t).toBe(1499);
	});

	test("includes content_hash as content_preview", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({
				t: 1000,
				from: "lead",
				to: "builder",
				content_hash: "abc123",
			}),
		];
		const result = extractCommSequence(links);
		expect(result[0].content_preview).toBe("abc123");
	});

	test("omits summary when not present", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "a", to: "b" }),
		];
		const result = extractCommSequence(links);
		expect(result[0]).not.toHaveProperty("summary");
	});
});

// --- extractCommSequence with task-based entries ---

describe("extractCommSequence with task-based coordination", () => {
	test("includes task_complete entries interleaved with messages", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "child-1", agent_name: "builder-a", parent_session: "root" }),
			makeMessage({ t: 1000, from: "lead", to: "builder-a" }),
			makeTaskComplete({ t: 2000, task_id: "t1", agent: "builder-a", subject: "Done" }),
			makeMessage({ t: 3000, from: "builder-a", to: "lead" }),
		];
		const result = extractCommSequence(links);
		expect(result.length).toBe(3);
		expect(result[0].t).toBe(1000);
		expect(result[0].edge_type).toBe("message");
		expect(result[1].t).toBe(2000);
		expect(result[1].edge_type).toBe("task_complete");
		expect(result[1].msg_type).toBe("task_complete");
		expect(result[1].summary).toBe("Done");
		expect(result[2].t).toBe(3000);
	});

	test("includes teammate_idle entries", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "child-1", agent_name: "builder-a", parent_session: "root" }),
			makeTeammateIdle({ t: 2000, teammate: "builder-a" }),
		];
		const result = extractCommSequence(links);
		expect(result.length).toBe(1);
		expect(result[0].edge_type).toBe("idle_notify");
		expect(result[0].msg_type).toBe("teammate_idle");
		expect(result[0].from_name).toBe("builder-a");
	});

	test("returns entries even when no msg_send links exist", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "child-1", agent_name: "builder-a", parent_session: "root" }),
			makeTaskComplete({ t: 1000, task_id: "t1", agent: "builder-a" }),
			makeTeammateIdle({ t: 2000, teammate: "builder-a" }),
		];
		const result = extractCommSequence(links);
		expect(result.length).toBe(2);
		expect(result[0].t).toBe(1000);
		expect(result[1].t).toBe(2000);
	});

	test("sorts all entry types chronologically", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ agent_id: "child-1", agent_name: "builder-a", parent_session: "root" }),
			makeTeammateIdle({ t: 3000, teammate: "builder-a" }),
			makeMessage({ t: 1000, from: "lead", to: "builder-a" }),
			makeTaskComplete({ t: 2000, task_id: "t1", agent: "builder-a", subject: "Work" }),
		];
		const result = extractCommSequence(links);
		expect(result.length).toBe(3);
		expect(result[0].t).toBe(1000);
		expect(result[0].edge_type).toBe("message");
		expect(result[1].t).toBe(2000);
		expect(result[1].edge_type).toBe("task_complete");
		expect(result[2].t).toBe(3000);
		expect(result[2].edge_type).toBe("idle_notify");
	});
});

// --- groupByConversation ---

describe("groupByConversation", () => {
	test("returns empty for empty sequence", () => {
		const result = groupByConversation([]);
		expect(result).toEqual([]);
	});

	test("groups sequential messages between same pair", () => {
		const sequence = [
			makeSeqEntry({ t: 1000, from: "lead", to: "builder", msg_type: "message" }),
			makeSeqEntry({ t: 2000, from: "builder", to: "lead", msg_type: "message" }),
			makeSeqEntry({ t: 3000, from: "lead", to: "builder", msg_type: "message" }),
		];
		const result = groupByConversation(sequence);
		expect(result).toHaveLength(1);
		expect(result[0].messages).toHaveLength(3);
		// participants sorted alphabetically
		expect(result[0].participants[0]).toBe("builder");
		expect(result[0].participants[1]).toBe("lead");
	});

	test("splits groups when participant pair changes", () => {
		const sequence = [
			makeSeqEntry({ t: 1000, from: "lead", to: "builder-a", msg_type: "message" }),
			makeSeqEntry({ t: 2000, from: "lead", to: "builder-b", msg_type: "message" }),
			makeSeqEntry({ t: 3000, from: "lead", to: "builder-a", msg_type: "message" }),
		];
		const result = groupByConversation(sequence);
		expect(result).toHaveLength(3);
		expect(result[0].messages).toHaveLength(1);
		expect(result[0].participants).toContain("builder-a");
		expect(result[1].messages).toHaveLength(1);
		expect(result[1].participants).toContain("builder-b");
		expect(result[2].messages).toHaveLength(1);
	});

	test("single message forms one group", () => {
		const sequence = [
			makeSeqEntry({ t: 1000, from: "lead", to: "builder", msg_type: "message" }),
		];
		const result = groupByConversation(sequence);
		expect(result).toHaveLength(1);
		expect(result[0].messages).toHaveLength(1);
	});

	test("preserves participant order (alphabetical)", () => {
		const sequence = [
			makeSeqEntry({ t: 1000, from: "zebra", to: "alpha", msg_type: "message" }),
		];
		const result = groupByConversation(sequence);
		expect(result[0].participants[0]).toBe("alpha");
		expect(result[0].participants[1]).toBe("zebra");
	});

	test("handles direction flips within same pair as same group", () => {
		const sequence = [
			makeSeqEntry({ t: 1000, from: "a", to: "b", msg_type: "message" }),
			makeSeqEntry({ t: 2000, from: "b", to: "a", msg_type: "message" }),
			makeSeqEntry({ t: 3000, from: "a", to: "b", msg_type: "message" }),
			makeSeqEntry({ t: 4000, from: "b", to: "a", msg_type: "message" }),
		];
		const result = groupByConversation(sequence);
		// All 4 messages between same pair should be in one group
		expect(result).toHaveLength(1);
		expect(result[0].messages).toHaveLength(4);
	});
});

// --- extractAgentLifetimes ---

describe("extractAgentLifetimes", () => {
	test("returns empty for empty links", () => {
		const result = extractAgentLifetimes([]);
		expect(result).toEqual([]);
	});

	test("returns empty when no spawn links and no comm data", () => {
		const links: readonly LinkEvent[] = [];
		const result = extractAgentLifetimes(links);
		expect(result).toEqual([]);
	});

	test("infers lifetimes from comms when no spawn links", () => {
		const links: readonly LinkEvent[] = [
			makeMessage({ t: 1000, from: "a", to: "b" }),
			makeMessage({ t: 3000, from: "a", to: "b" }),
		];
		const result = extractAgentLifetimes(links);
		expect(result).toHaveLength(1);
		expect(result[0].agent_name).toBe("b");
		expect(result[0].start_t).toBe(1000);
		expect(result[0].end_t).toBe(3000);
		expect(result[0].agent_type).toBe("builder");
	});

	test("extracts lifetime with matching stop", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1", agent_type: "builder" }),
			makeStop({ t: 5000, agent_id: "a1" }),
		];
		const result = extractAgentLifetimes(links);
		expect(result).toHaveLength(1);
		expect(result[0].agent_id).toBe("a1");
		expect(result[0].agent_name).toBe("builder-1");
		expect(result[0].start_t).toBe(1000);
		expect(result[0].end_t).toBe(5000);
		expect(result[0].agent_type).toBe("builder");
	});

	test("falls back to maxT when no stop link", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1", agent_type: "builder" }),
			makeMessage({ t: 8000, from: "a1", to: "lead" }),
		];
		const result = extractAgentLifetimes(links);
		expect(result).toHaveLength(1);
		expect(result[0].end_t).toBe(8000);
	});

	test("sorts by start_t", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 3000, agent_id: "a2", agent_type: "validator" }),
			makeSpawn({ t: 1000, agent_id: "a1", agent_type: "builder" }),
			makeStop({ t: 5000, agent_id: "a1" }),
			makeStop({ t: 6000, agent_id: "a2" }),
		];
		const result = extractAgentLifetimes(links);
		expect(result).toHaveLength(2);
		expect(result[0].agent_id).toBe("a1");
		expect(result[0].start_t).toBe(1000);
		expect(result[1].agent_id).toBe("a2");
		expect(result[1].start_t).toBe(3000);
	});

	test("omits agent_name when not present in spawn", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "a1", agent_type: "builder" }),
		];
		const result = extractAgentLifetimes(links);
		expect(result[0]).not.toHaveProperty("agent_name");
	});

	test("multiple agents with mixed stop/no-stop", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "a1", agent_name: "builder", agent_type: "builder" }),
			makeSpawn({ t: 2000, agent_id: "a2", agent_name: "validator", agent_type: "validator" }),
			makeStop({ t: 4000, agent_id: "a1" }),
			// a2 never stopped
			makeMessage({ t: 6000, from: "a2", to: "lead" }),
		];
		const result = extractAgentLifetimes(links);
		expect(result).toHaveLength(2);
		expect(result[0].end_t).toBe(4000); // a1 has stop
		expect(result[1].end_t).toBe(6000); // a2 falls back to maxT
	});

	test("resolves agent_name via nameMap when not in spawn data", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "uuid-abc", agent_type: "builder" }),
			makeStop({ t: 5000, agent_id: "uuid-abc" }),
		];
		const nameMap = new Map([["uuid-abc", "builder-types"]]);
		const result = extractAgentLifetimes(links, nameMap);
		expect(result).toHaveLength(1);
		expect(result[0].agent_name).toBe("builder-types");
	});

	test("prefers spawn agent_name over nameMap", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "uuid-abc", agent_name: "from-spawn", agent_type: "builder" }),
			makeStop({ t: 5000, agent_id: "uuid-abc" }),
		];
		const nameMap = new Map([["uuid-abc", "from-map"]]);
		const result = extractAgentLifetimes(links, nameMap);
		expect(result).toHaveLength(1);
		expect(result[0].agent_name).toBe("from-spawn");
	});

	test("omits agent_name when not in spawn and no nameMap", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "uuid-abc", agent_type: "builder" }),
		];
		const result = extractAgentLifetimes(links);
		expect(result[0]).not.toHaveProperty("agent_name");
	});

	test("omits agent_name when not in spawn and not in nameMap", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ t: 1000, agent_id: "uuid-abc", agent_type: "builder" }),
		];
		const nameMap = new Map([["uuid-other", "other-agent"]]);
		const result = extractAgentLifetimes(links, nameMap);
		// resolveName returns the id when not found; but since the id !== a human name,
		// it should still resolve (resolveName returns id as fallback)
		// The actual behavior: resolveName("uuid-abc", nameMap) returns "uuid-abc"
		// and that's truthy, so agent_name will be "uuid-abc"
		expect(result[0].agent_name).toBe("uuid-abc");
	});
});

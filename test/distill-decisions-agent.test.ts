import { describe, expect, test } from "bun:test";
import { extractAgentDecisions, extractDecisions } from "../src/distill/decisions";
import type { LinkEvent, SpawnLink, StoredEvent, TaskCompleteLink, TaskLink } from "../src/types";

// -- Fixture factories --

const makeSpawnLink = (overrides: Partial<SpawnLink> = {}): SpawnLink => ({
	type: "spawn",
	t: 1000000,
	parent_session: "parent-session-id",
	agent_id: "agent-001",
	agent_type: "builder",
	agent_name: "builder-types",
	...overrides,
});

const makeTaskAssignLink = (overrides: Partial<TaskLink> = {}): TaskLink => ({
	type: "task",
	t: 1001000,
	action: "assign",
	task_id: "task-001",
	session_id: "parent-session-id",
	owner: "builder-types",
	subject: "Implement type definitions",
	...overrides,
});

const makeTaskCompleteLink = (overrides: Partial<TaskCompleteLink> = {}): TaskCompleteLink => ({
	type: "task_complete",
	t: 1005000,
	task_id: "task-001",
	agent: "builder-types",
	subject: "Implement type definitions",
	...overrides,
});

const makeEvent = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
	t: 1000000,
	session_id: "test-session",
	event: "PreToolUse",
	data: { tool_name: "Read" },
	...overrides,
});

// =============================================================================
// extractAgentDecisions
// =============================================================================

describe("extractAgentDecisions", () => {
	test("spawn links produce agent_spawn decisions", () => {
		const links: readonly LinkEvent[] = [
			makeSpawnLink({ agent_id: "a1", agent_name: "builder-types", agent_type: "builder", t: 100 }),
			makeSpawnLink({ agent_id: "a2", agent_name: "validator-lint", agent_type: "validator", t: 200 }),
		];

		const decisions = extractAgentDecisions(links);

		expect(decisions).toHaveLength(2);
		expect(decisions[0]).toMatchObject({
			type: "agent_spawn",
			t: 100,
			agent_id: "a1",
			agent_name: "builder-types",
			agent_type: "builder",
		});
		expect(decisions[1]).toMatchObject({
			type: "agent_spawn",
			t: 200,
			agent_id: "a2",
			agent_name: "validator-lint",
			agent_type: "validator",
		});
	});

	test("task assign links produce task_delegation decisions", () => {
		const links: readonly LinkEvent[] = [
			makeTaskAssignLink({ task_id: "t1", owner: "builder-types", subject: "Fix bug", t: 300 }),
		];

		const decisions = extractAgentDecisions(links);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			type: "task_delegation",
			t: 300,
			task_id: "t1",
			agent_name: "builder-types",
			subject: "Fix bug",
		});
	});

	test("task complete links produce task_completion decisions", () => {
		const links: readonly LinkEvent[] = [
			makeTaskCompleteLink({ task_id: "t1", agent: "builder-types", subject: "Fix bug", t: 500 }),
		];

		const decisions = extractAgentDecisions(links);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			type: "task_completion",
			t: 500,
			task_id: "t1",
			agent_name: "builder-types",
			subject: "Fix bug",
		});
	});

	test("non-assign task links are excluded", () => {
		const links: readonly LinkEvent[] = [
			{
				type: "task",
				t: 100,
				action: "create",
				task_id: "t1",
				session_id: "s1",
				subject: "Created task",
			} satisfies TaskLink,
			{
				type: "task",
				t: 200,
				action: "status_change",
				task_id: "t1",
				session_id: "s1",
				status: "in_progress",
			} satisfies TaskLink,
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions).toHaveLength(0);
	});

	test("empty links produce empty decisions", () => {
		const decisions = extractAgentDecisions([]);
		expect(decisions).toHaveLength(0);
	});

	test("mixed link types produce all three decision kinds", () => {
		const links: readonly LinkEvent[] = [
			makeSpawnLink({ t: 100 }),
			makeTaskAssignLink({ t: 200 }),
			makeTaskCompleteLink({ t: 300 }),
		];

		const decisions = extractAgentDecisions(links);
		const types = decisions.map((d) => d.type);

		expect(types).toContain("agent_spawn");
		expect(types).toContain("task_delegation");
		expect(types).toContain("task_completion");
		expect(decisions).toHaveLength(3);
	});

	test("spawn link without agent_name falls back to agent_type", () => {
		const links: readonly LinkEvent[] = [
			makeSpawnLink({ agent_name: undefined, agent_type: "builder" }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions[0]).toMatchObject({
			type: "agent_spawn",
			agent_name: "builder",
		});
	});

	test("task delegation without subject omits subject field", () => {
		const links: readonly LinkEvent[] = [
			makeTaskAssignLink({ subject: undefined }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions[0]).not.toHaveProperty("subject");
	});

	test("task completion without subject omits subject field", () => {
		const links: readonly LinkEvent[] = [
			makeTaskCompleteLink({ subject: undefined }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions[0]).not.toHaveProperty("subject");
	});

	test("task delegation uses owner, then agent, then 'unknown' for agent_name", () => {
		const withOwner: readonly LinkEvent[] = [
			makeTaskAssignLink({ owner: "my-owner", agent: "my-agent" }),
		];
		expect(extractAgentDecisions(withOwner)[0]).toMatchObject({ agent_name: "my-owner" });

		const withAgent: readonly LinkEvent[] = [
			makeTaskAssignLink({ owner: undefined, agent: "my-agent" }),
		];
		expect(extractAgentDecisions(withAgent)[0]).toMatchObject({ agent_name: "my-agent" });

		const withNeither: readonly LinkEvent[] = [
			makeTaskAssignLink({ owner: undefined, agent: undefined }),
		];
		expect(extractAgentDecisions(withNeither)[0]).toMatchObject({ agent_name: "unknown" });
	});
});

// =============================================================================
// extractDecisions integration: events + links merged and sorted
// =============================================================================

describe("extractDecisions with links", () => {
	test("merges event-based and link-based decisions, sorted by timestamp", () => {
		// Create events with a timing gap > 30s
		const events: readonly StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 200_000, event: "PreToolUse", data: { tool_name: "Read" } }),
		];

		const links: readonly LinkEvent[] = [
			makeSpawnLink({ t: 50_000 }),
		];

		const decisions = extractDecisions(events, links);

		// Should contain both timing_gap (from the >30s gap) and agent_spawn
		const types = decisions.map((d) => d.type);
		expect(types).toContain("timing_gap");
		expect(types).toContain("agent_spawn");

		// Sorted chronologically
		const timestamps = decisions.map((d) => d.t);
		const sorted = [...timestamps].sort((a, b) => a - b);
		expect(timestamps).toEqual(sorted);
	});

	test("without links, behavior is identical to single-agent", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 200_000, event: "PreToolUse", data: { tool_name: "Read" } }),
		];

		const withoutLinks = extractDecisions(events);
		const withEmptyLinks = extractDecisions(events, []);
		const withUndefinedLinks = extractDecisions(events, undefined);

		expect(withoutLinks).toEqual(withEmptyLinks);
		expect(withoutLinks).toEqual(withUndefinedLinks);
	});

	test("agent decisions do not appear when links is undefined", () => {
		const events: readonly StoredEvent[] = [
			makeEvent({ t: 1000 }),
		];

		const decisions = extractDecisions(events);
		const agentTypes = decisions.filter((d) =>
			d.type === "agent_spawn" || d.type === "task_delegation" || d.type === "task_completion",
		);
		expect(agentTypes).toHaveLength(0);
	});
});

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
	test("spawn links produce 0 decision points", () => {
		const links: readonly LinkEvent[] = [
			makeSpawnLink({ agent_id: "a1", agent_name: "builder-types", agent_type: "builder", t: 100 }),
			makeSpawnLink({ agent_id: "a2", agent_name: "validator-lint", agent_type: "validator", t: 200 }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions).toHaveLength(0);
	});

	test("task_complete links produce 0 decision points", () => {
		const links: readonly LinkEvent[] = [
			makeTaskCompleteLink({ task_id: "t1", agent: "builder-types", subject: "Fix bug", t: 500 }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions).toHaveLength(0);
	});

	test("task_delegation with subject produces decision point", () => {
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

	test("task_delegation without subject produces 0 decision points", () => {
		const links: readonly LinkEvent[] = [
			makeTaskAssignLink({ subject: undefined }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions).toHaveLength(0);
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

	test("mixed link types only produce task_delegation with subject", () => {
		const links: readonly LinkEvent[] = [
			makeSpawnLink({ t: 100 }),
			makeTaskAssignLink({ t: 200, subject: "Do work" }),
			makeTaskCompleteLink({ t: 300 }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions).toHaveLength(1);
		expect(decisions[0].type).toBe("task_delegation");
	});

	test("task delegation uses owner, then agent, then 'unknown' for agent_name", () => {
		const withOwner: readonly LinkEvent[] = [
			makeTaskAssignLink({ owner: "my-owner", agent: "my-agent", subject: "Work" }),
		];
		expect(extractAgentDecisions(withOwner)[0]).toMatchObject({ agent_name: "my-owner" });

		const withAgent: readonly LinkEvent[] = [
			makeTaskAssignLink({ owner: undefined, agent: "my-agent", subject: "Work" }),
		];
		expect(extractAgentDecisions(withAgent)[0]).toMatchObject({ agent_name: "my-agent" });

		const withNeither: readonly LinkEvent[] = [
			makeTaskAssignLink({ owner: undefined, agent: undefined, subject: "Work" }),
		];
		expect(extractAgentDecisions(withNeither)[0]).toMatchObject({ agent_name: "unknown" });
	});

	test("task_delegation with empty string subject produces 0 decision points", () => {
		const links: readonly LinkEvent[] = [
			makeTaskAssignLink({ subject: "" }),
		];

		const decisions = extractAgentDecisions(links);
		expect(decisions).toHaveLength(0);
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
			makeTaskAssignLink({ t: 50_000, subject: "Do something" }),
		];

		const decisions = extractDecisions(events, links);

		// Should contain both timing_gap and task_delegation
		const types = decisions.map((d) => d.type);
		expect(types).toContain("timing_gap");
		expect(types).toContain("task_delegation");

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

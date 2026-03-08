import { describe, expect, test } from "bun:test";
import { extractTeamMetrics } from "../src/distill/team";
import type {
	LinkEvent,
	MessageLink,
	SpawnLink,
	StopLink,
	TaskCompleteLink,
	TeamLink,
	TeammateIdleLink,
} from "../src/types";

const mkSpawn = (overrides: Partial<SpawnLink> = {}): SpawnLink => ({
	t: 1000,
	type: "spawn",
	parent_session: "leader-session",
	agent_id: "agent-1",
	agent_type: "builder",
	agent_name: "builder-1",
	...overrides,
});

const mkStop = (overrides: Partial<StopLink> = {}): StopLink => ({
	t: 5000,
	type: "stop",
	parent_session: "leader-session",
	agent_id: "agent-1",
	...overrides,
});

const mkTaskComplete = (overrides: Partial<TaskCompleteLink> = {}): TaskCompleteLink => ({
	t: 3000,
	type: "task_complete",
	task_id: "task-1",
	agent: "builder-1",
	subject: "Implement feature X",
	...overrides,
});

const mkTeammateIdle = (overrides: Partial<TeammateIdleLink> = {}): TeammateIdleLink => ({
	t: 4000,
	type: "teammate_idle",
	teammate: "builder-1",
	...overrides,
});

const mkMessage = (overrides: Partial<MessageLink> = {}): MessageLink => ({
	t: 2000,
	type: "msg_send",
	session_id: "session-1",
	from: "leader",
	to: "builder-1",
	msg_type: "message",
	...overrides,
});

const mkTeam = (overrides: Partial<TeamLink> = {}): TeamLink => ({
	t: 500,
	type: "team",
	team_name: "my-team",
	leader_session: "leader-session",
	...overrides,
});

describe("extractTeamMetrics", () => {
	test("empty links returns zero metrics", () => {
		const result = extractTeamMetrics([]);

		expect(result.agent_count).toBe(0);
		expect(result.task_completed_count).toBe(0);
		expect(result.idle_event_count).toBe(0);
		expect(result.teammate_names).toEqual([]);
		expect(result.tasks).toEqual([]);
		expect(result.idle_transitions).toEqual([]);
		expect(result.utilization_ratio).toBeUndefined();
	});

	test("single agent with no team events", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ agent_id: "a1", agent_name: "worker-1" }),
			mkStop({ agent_id: "a1" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.agent_count).toBe(1);
		expect(result.task_completed_count).toBe(0);
		expect(result.idle_event_count).toBe(0);
		expect(result.teammate_names).toEqual(["worker-1"]);
		expect(result.tasks).toEqual([]);
		expect(result.idle_transitions).toEqual([]);
	});

	test("multi-agent with tasks and idles", () => {
		const links: readonly LinkEvent[] = [
			mkTeam(),
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkSpawn({ t: 1100, agent_id: "a2", agent_name: "builder-2" }),
			mkTaskComplete({ t: 3000, task_id: "t1", agent: "builder-1", subject: "Task A" }),
			mkTeammateIdle({ t: 3500, teammate: "builder-1" }),
			mkTaskComplete({ t: 4000, task_id: "t2", agent: "builder-2", subject: "Task B" }),
			mkTeammateIdle({ t: 4500, teammate: "builder-2" }),
			mkStop({ t: 5000, agent_id: "a1" }),
			mkStop({ t: 5500, agent_id: "a2" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.agent_count).toBe(2);
		expect(result.task_completed_count).toBe(2);
		expect(result.idle_event_count).toBe(2);
		expect(result.teammate_names).toEqual(["builder-1", "builder-2"]);
		expect(result.tasks).toHaveLength(2);
		expect(result.tasks[0]).toEqual({
			task_id: "t1",
			agent: "builder-1",
			subject: "Task A",
			t: 3000,
		});
		expect(result.tasks[1]).toEqual({
			task_id: "t2",
			agent: "builder-2",
			subject: "Task B",
			t: 4000,
		});
		expect(result.idle_transitions).toHaveLength(2);
		expect(result.idle_transitions[0]).toEqual({ teammate: "builder-1", t: 3500 });
		expect(result.idle_transitions[1]).toEqual({ teammate: "builder-2", t: 4500 });
	});

	test("deduplicates teammate names across link types", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ agent_id: "a1", agent_name: "builder-1" }),
			mkTaskComplete({ agent: "builder-1" }),
			mkTeammateIdle({ teammate: "builder-1" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.teammate_names).toEqual(["builder-1"]);
	});

	test("handles spawn without agent_name", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ agent_id: "a1", agent_name: undefined }),
			// task_complete using agent ID "a1" matches the spawn by ID fallback
			mkTaskComplete({ agent: "a1" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.agent_count).toBe(1);
		expect(result.task_completed_count).toBe(1);
		expect(result.teammate_names).toEqual(["a1"]);
	});

	test("filters out unrelated link types", () => {
		const links: readonly LinkEvent[] = [
			mkTeam(),
			mkMessage(),
			mkSpawn({ agent_id: "a1", agent_name: "builder-1" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.agent_count).toBe(1);
		expect(result.task_completed_count).toBe(0);
		expect(result.idle_event_count).toBe(0);
	});

	test("task_complete without subject", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ agent_id: "a1", agent_name: "builder-1" }),
			mkTaskComplete({ task_id: "t1", agent: "builder-1", subject: undefined }),
		];

		const result = extractTeamMetrics(links);

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].subject).toBeUndefined();
		expect(result.tasks[0].task_id).toBe("t1");
	});

	test("utilization_ratio computed when spawn/stop pairs exist", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkTeammateIdle({ t: 2000, teammate: "builder-1" }),
			mkTaskComplete({ t: 3000, agent: "builder-1", task_id: "t1" }),
			mkStop({ t: 4000, agent_id: "a1" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.utilization_ratio).toBeDefined();
		expect(typeof result.utilization_ratio).toBe("number");
		expect(result.utilization_ratio).toBeGreaterThanOrEqual(0);
		expect(result.utilization_ratio).toBeLessThanOrEqual(1);
	});
});

describe("extractTeamMetrics - knownAgentIds filtering", () => {
	test("with knownAgentIds returns only matching agents", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkSpawn({ t: 1100, agent_id: "a2", agent_name: "builder-2" }),
			mkSpawn({ t: 1200, agent_id: "a3", agent_name: "builder-3" }),
			mkTaskComplete({ t: 3000, agent: "builder-1", task_id: "t1" }),
			mkTaskComplete({ t: 3500, agent: "builder-2", task_id: "t2" }),
			mkTaskComplete({ t: 4000, agent: "builder-3", task_id: "t3" }),
			mkTeammateIdle({ t: 4500, teammate: "builder-1" }),
			mkTeammateIdle({ t: 4600, teammate: "builder-3" }),
			mkStop({ t: 5000, agent_id: "a1" }),
			mkStop({ t: 5100, agent_id: "a2" }),
			mkStop({ t: 5200, agent_id: "a3" }),
		];

		// Only include a1 and a3
		const knownAgentIds = new Set(["a1", "a3"]);
		const result = extractTeamMetrics(links, knownAgentIds);

		expect(result.agent_count).toBe(2);
		expect(result.task_completed_count).toBe(2);
		expect(result.tasks.map((t) => t.agent)).toEqual(["builder-1", "builder-3"]);
		expect(result.idle_event_count).toBe(2);
		expect(result.idle_transitions.map((i) => i.teammate)).toEqual(["builder-1", "builder-3"]);
	});

	test("task_complete links with agent names NOT in spawn set are excluded", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkTaskComplete({ t: 3000, agent: "builder-1", task_id: "t1" }),
			mkTaskComplete({ t: 3500, agent: "unknown-agent", task_id: "t2" }),
			mkStop({ t: 5000, agent_id: "a1" }),
		];

		const knownAgentIds = new Set(["a1"]);
		const result = extractTeamMetrics(links, knownAgentIds);

		expect(result.task_completed_count).toBe(1);
		expect(result.tasks[0].agent).toBe("builder-1");
	});

	test("teammate_idle links scoped to known agents only", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkSpawn({ t: 1100, agent_id: "a2", agent_name: "builder-2" }),
			mkTeammateIdle({ t: 2000, teammate: "builder-1" }),
			mkTeammateIdle({ t: 2500, teammate: "builder-2" }),
			mkTeammateIdle({ t: 3000, teammate: "external-agent" }),
		];

		const knownAgentIds = new Set(["a1"]);
		const result = extractTeamMetrics(links, knownAgentIds);

		expect(result.idle_event_count).toBe(1);
		expect(result.idle_transitions[0].teammate).toBe("builder-1");
	});

	test("spawns without agent_name match task_complete by agent ID fallback", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: undefined }),
			mkSpawn({ t: 1100, agent_id: "a2", agent_name: undefined }),
			// task_complete using agent IDs instead of names
			mkTaskComplete({ t: 3000, agent: "a1", task_id: "t1" }),
			mkTaskComplete({ t: 3500, agent: "a2", task_id: "t2" }),
			mkStop({ t: 5000, agent_id: "a1" }),
			mkStop({ t: 5100, agent_id: "a2" }),
		];

		const knownAgentIds = new Set(["a1", "a2"]);
		const result = extractTeamMetrics(links, knownAgentIds);

		expect(result.task_completed_count).toBe(2);
		expect(result.tasks.map((t) => t.agent)).toEqual(["a1", "a2"]);
	});

	test("without knownAgentIds defaults to all spawned agents", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkSpawn({ t: 1100, agent_id: "a2", agent_name: "builder-2" }),
			mkTaskComplete({ t: 3000, agent: "builder-1", task_id: "t1" }),
			mkTaskComplete({ t: 3500, agent: "builder-2", task_id: "t2" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.agent_count).toBe(2);
		expect(result.task_completed_count).toBe(2);
	});
});

describe("extractTeamMetrics - sessionId matching (BUG-7)", () => {
	test("task_complete with agent=parentSessionId is counted when sessionId is passed", () => {
		const parentSessionId = "b75e880b-1234-5678-9abc-def012345678";
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkSpawn({ t: 1100, agent_id: "a2", agent_name: "builder-2" }),
			// Leader (parent session) calls TaskUpdate, so agent = parentSessionId
			mkTaskComplete({ t: 3000, agent: parentSessionId, task_id: "t1", subject: "Task by leader" }),
			mkTaskComplete({ t: 3500, agent: "builder-2", task_id: "t2", subject: "Task by builder" }),
			mkStop({ t: 5000, agent_id: "a1" }),
			mkStop({ t: 5100, agent_id: "a2" }),
		];

		const knownAgentIds = new Set(["a1", "a2"]);
		const result = extractTeamMetrics(links, knownAgentIds, parentSessionId);

		expect(result.task_completed_count).toBe(2);
		expect(result.tasks.map((t) => t.agent)).toEqual([parentSessionId, "builder-2"]);
	});

	test("task_complete with session_id=sessionId is counted", () => {
		const parentSessionId = "parent-session-abc";
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			// task_complete with agent set to some unknown value but session_id matches parent
			mkTaskComplete({ t: 3000, agent: "unknown-agent", task_id: "t1", session_id: parentSessionId }),
			mkStop({ t: 5000, agent_id: "a1" }),
		];

		const knownAgentIds = new Set(["a1"]);
		const result = extractTeamMetrics(links, knownAgentIds, parentSessionId);

		expect(result.task_completed_count).toBe(1);
	});

	test("without sessionId, task_complete with parent ID is not counted", () => {
		const parentSessionId = "b75e880b-1234-5678-9abc-def012345678";
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkTaskComplete({ t: 3000, agent: parentSessionId, task_id: "t1" }),
			mkStop({ t: 5000, agent_id: "a1" }),
		];

		const knownAgentIds = new Set(["a1"]);
		// No sessionId passed — parent session ID should NOT match
		const result = extractTeamMetrics(links, knownAgentIds);

		expect(result.task_completed_count).toBe(0);
	});
});

describe("extractTeamMetrics - utilization with agent_name=undefined (BUG-12)", () => {
	test("spawn with agent_name=undefined + teammate_idle with teammate=agent_id → idle counted → utilization < 1.0", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "uuid-agent-1", agent_name: undefined }),
			// teammate_idle uses the agent_id since agent_name was undefined
			mkTeammateIdle({ t: 2000, teammate: "uuid-agent-1" }),
			mkTaskComplete({ t: 3000, agent: "uuid-agent-1", task_id: "t1" }),
			mkStop({ t: 4000, agent_id: "uuid-agent-1" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.idle_event_count).toBe(1);
		expect(result.idle_transitions).toHaveLength(1);
		expect(result.idle_transitions[0].teammate).toBe("uuid-agent-1");
		// utilization should be < 1.0 because idle time was counted
		expect(result.utilization_ratio).toBeDefined();
		expect(result.utilization_ratio ?? -1).toBeLessThan(1.0);
	});

	test("agent_id used as fallback in teammateNames when agent_name is undefined", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "uuid-agent-1", agent_name: undefined }),
			mkStop({ t: 4000, agent_id: "uuid-agent-1" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.teammate_names).toEqual(["uuid-agent-1"]);
	});

	test("mixed spawns: some with agent_name, some without", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn({ t: 1000, agent_id: "a1", agent_name: "builder-1" }),
			mkSpawn({ t: 1100, agent_id: "a2", agent_name: undefined }),
			mkTeammateIdle({ t: 2000, teammate: "builder-1" }),
			mkTeammateIdle({ t: 2100, teammate: "a2" }),
			mkStop({ t: 5000, agent_id: "a1" }),
			mkStop({ t: 5100, agent_id: "a2" }),
		];

		const result = extractTeamMetrics(links);

		expect(result.idle_event_count).toBe(2);
		expect(result.teammate_names).toContain("builder-1");
		expect(result.teammate_names).toContain("a2");
		expect(result.utilization_ratio).toBeDefined();
		expect(result.utilization_ratio ?? -1).toBeLessThan(1.0);
	});
});

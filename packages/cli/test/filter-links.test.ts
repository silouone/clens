import { describe, expect, test } from "bun:test";
import { buildTeamMemberSessionMap, filterLinksForSession } from "../src/utils";
import type {
	ConfigChangeLink,
	LinkEvent,
	MessageLink,
	SessionEndLink,
	SpawnLink,
	StopLink,
	TaskCompleteLink,
	TaskLink,
	TeamLink,
	TeammateIdleLink,
} from "../src/types";

// -- Fixture factories --

const makeSpawn = (
	overrides: Partial<SpawnLink> & { parent_session: string; agent_id: string },
): SpawnLink => ({
	t: Date.now(),
	type: "spawn",
	agent_type: "builder",
	...overrides,
});

const makeStop = (
	overrides: Partial<StopLink> & { agent_id: string },
): StopLink => ({
	t: Date.now(),
	type: "stop",
	parent_session: "root",
	...overrides,
});

const makeMessage = (
	overrides: Partial<MessageLink> & { from: string; to: string; session_id: string },
): MessageLink => ({
	t: Date.now(),
	type: "msg_send",
	msg_type: "message",
	...overrides,
});

const makeTask = (
	overrides: Partial<TaskLink> & { session_id: string },
): TaskLink => ({
	t: Date.now(),
	type: "task",
	action: "create",
	task_id: "task-1",
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

const makeTeam = (
	overrides: Partial<TeamLink> & { leader_session: string },
): TeamLink => ({
	t: Date.now(),
	type: "team",
	team_name: "test-team",
	...overrides,
});

const makeSessionEnd = (
	overrides: Partial<SessionEndLink> & { session: string },
): SessionEndLink => ({
	t: Date.now(),
	type: "session_end",
	...overrides,
});

const makeConfigChange = (
	overrides: Partial<ConfigChangeLink> & { session: string },
): ConfigChangeLink => ({
	t: Date.now(),
	type: "config_change",
	...overrides,
});

// -- Tests --

describe("filterLinksForSession", () => {
	test("returns empty array for empty links", () => {
		const result = filterLinksForSession("session-root", []);
		expect(result).toEqual([]);
	});

	test("returns only links matching root sessionId when no spawns exist", () => {
		const rootId = "session-solo";
		const endLink = makeSessionEnd({ session: rootId });
		const configLink = makeConfigChange({ session: rootId, key: "model" });
		const links: readonly LinkEvent[] = [endLink, configLink];

		const result = filterLinksForSession(rootId, links);
		expect(result).toEqual([endLink, configLink]);
	});

	test("excludes links from other sessions in a multi-session project", () => {
		const rootId = "session-mine";
		const otherId = "session-other";

		const myEnd = makeSessionEnd({ t: 1000, session: rootId });
		const myConfig = makeConfigChange({ t: 1100, session: rootId });
		const otherEnd = makeSessionEnd({ t: 2000, session: otherId });
		const otherConfig = makeConfigChange({ t: 2100, session: otherId });
		const otherSpawn = makeSpawn({
			t: 2200,
			parent_session: otherId,
			agent_id: "other-child-1",
			agent_name: "other-builder",
		});

		const links: readonly LinkEvent[] = [myEnd, myConfig, otherEnd, otherConfig, otherSpawn];

		const result = filterLinksForSession(rootId, links);
		expect(result).toEqual([myEnd, myConfig]);
	});

	test("includes spawns, stops, messages, and tasks for direct children", () => {
		const rootId = "session-lead";
		const childId = "agent-child-1";
		const childName = "builder-alpha";
		const otherRootId = "session-unrelated";
		const otherChildId = "agent-other-child";
		const otherChildName = "builder-beta";

		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: childName,
		});
		const stopChild = makeStop({ t: 5000, parent_session: rootId, agent_id: childId });
		const teamLink = makeTeam({ t: 1100, leader_session: rootId, team_name: "my-team" });
		const taskLink = makeTask({ t: 2000, session_id: rootId, task_id: "t-1" });
		const msgFromChild = makeMessage({
			t: 3000,
			from: childId,
			to: "lead",
			session_id: childId,
		});
		const endLink = makeSessionEnd({ t: 6000, session: rootId });

		// Other session's links -- should be excluded
		const otherSpawn = makeSpawn({
			t: 1000,
			parent_session: otherRootId,
			agent_id: otherChildId,
			agent_name: otherChildName,
		});
		const otherTask = makeTask({ t: 2000, session_id: otherRootId, task_id: "t-other" });
		const otherStop = makeStop({ t: 5000, parent_session: otherRootId, agent_id: otherChildId });

		const links: readonly LinkEvent[] = [
			spawnChild, stopChild, teamLink, taskLink, msgFromChild, endLink,
			otherSpawn, otherTask, otherStop,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(stopChild);
		expect(result).toContain(teamLink);
		expect(result).toContain(taskLink);
		expect(result).toContain(msgFromChild);
		expect(result).toContain(endLink);
		expect(result).not.toContain(otherSpawn);
		expect(result).not.toContain(otherTask);
		expect(result).not.toContain(otherStop);
	});

	test("includes grandchildren via recursive spawn walk", () => {
		const rootId = "session-root";
		const childId = "agent-child";
		const grandchildId = "agent-grandchild";

		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: "child-worker",
		});
		const spawnGrandchild = makeSpawn({
			t: 2000,
			parent_session: childId,
			agent_id: grandchildId,
			agent_name: "grandchild-worker",
		});
		const stopGrandchild = makeStop({ t: 4000, parent_session: childId, agent_id: grandchildId });
		const stopChild = makeStop({ t: 5000, parent_session: rootId, agent_id: childId });
		const endRoot = makeSessionEnd({ t: 6000, session: rootId });

		const links: readonly LinkEvent[] = [
			spawnChild, spawnGrandchild, stopGrandchild, stopChild, endRoot,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(spawnGrandchild);
		expect(result).toContain(stopGrandchild);
		expect(result).toContain(stopChild);
		expect(result).toContain(endRoot);
		expect(result.length).toBe(5);
	});

	test("name-based matching includes task_complete and teammate_idle for session agents", () => {
		const rootId = "session-root";
		const childId = "agent-worker";
		const childName = "my-builder";

		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: childName,
		});
		const taskComplete = makeTaskComplete({
			t: 3000,
			agent: childName,
			task_id: "t-1",
			subject: "Build feature",
		});
		const idle = makeTeammateIdle({ t: 4000, teammate: childName });

		// Links from an agent name NOT in this session
		const foreignTaskComplete = makeTaskComplete({
			t: 3000,
			agent: "foreign-builder",
			task_id: "t-foreign",
		});
		const foreignIdle = makeTeammateIdle({ t: 4000, teammate: "foreign-builder" });

		const links: readonly LinkEvent[] = [
			spawnChild, taskComplete, idle, foreignTaskComplete, foreignIdle,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(taskComplete);
		expect(result).toContain(idle);
		expect(result).not.toContain(foreignTaskComplete);
		expect(result).not.toContain(foreignIdle);
	});

	test("name-based matching: same-name agents across sessions may leak (known limitation)", () => {
		const sessionA = "session-a";
		const sessionB = "session-b";
		const sharedName = "builder";

		const spawnA = makeSpawn({
			t: 1000,
			parent_session: sessionA,
			agent_id: "agent-a-1",
			agent_name: sharedName,
		});
		const spawnB = makeSpawn({
			t: 1000,
			parent_session: sessionB,
			agent_id: "agent-b-1",
			agent_name: sharedName,
		});

		// task_complete from session B's agent, but the name matches session A's agent
		const taskFromB = makeTaskComplete({
			t: 3000,
			agent: sharedName,
			task_id: "t-b",
			subject: "Work from B",
		});

		const links: readonly LinkEvent[] = [spawnA, spawnB, taskFromB];

		// When filtering for session A, task_complete using shared name leaks through
		const resultA = filterLinksForSession(sessionA, links);
		expect(resultA).toContain(taskFromB); // Known limitation: name collision causes leak
	});

	test("msg_send scoping: includes messages from session agents, excludes others", () => {
		const rootId = "session-root";
		const childId = "agent-child-1";
		const childName = "worker-a";
		const foreignAgentId = "foreign-agent-99";

		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: childName,
		});

		// Message from a session agent (from matches agentIds)
		const msgFromChild = makeMessage({
			t: 2000,
			from: childId,
			to: "team-lead",
			session_id: childId,
		});

		// Message where session_id matches root (root sends)
		const msgFromRoot = makeMessage({
			t: 2100,
			from: rootId,
			to: childName,
			session_id: rootId,
		});

		// Message to a session agent name (to matches agentNames)
		const msgToChild = makeMessage({
			t: 2200,
			from: "external-sender",
			to: childName,
			session_id: "external-session",
		});

		// Message from a foreign agent -- should be excluded
		const foreignMsg = makeMessage({
			t: 3000,
			from: foreignAgentId,
			to: "some-other-agent",
			session_id: "foreign-session",
		});

		const links: readonly LinkEvent[] = [
			spawnChild, msgFromChild, msgFromRoot, msgToChild, foreignMsg,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(msgFromChild);
		expect(result).toContain(msgFromRoot);
		expect(result).toContain(msgToChild);
		expect(result).not.toContain(foreignMsg);
	});

	test("task_complete prefers session_id when present over name matching", () => {
		const rootId = "session-root";
		const childId = "agent-child-sess";
		const childName = "builder-worker";

		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: childName,
		});

		// task_complete with session_id set to child's agent_id (should match via agentIds)
		const taskWithSessionId = makeTaskComplete({
			t: 3000,
			agent: "some-random-name",
			task_id: "t-sess",
			subject: "Matched by session_id",
			session_id: childId,
		});

		// task_complete from a foreign session_id (should NOT match)
		const foreignTask = makeTaskComplete({
			t: 4000,
			agent: "foreign-name",
			task_id: "t-foreign",
			session_id: "foreign-session",
		});

		const links: readonly LinkEvent[] = [spawnChild, taskWithSessionId, foreignTask];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(taskWithSessionId);
		expect(result).not.toContain(foreignTask);
	});

	test("task_complete falls back to name matching when session_id is absent", () => {
		const rootId = "session-root";
		const childId = "agent-child-name";
		const childName = "builder-fallback";

		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: childName,
		});

		// task_complete without session_id, matched by agent name
		const taskByName = makeTaskComplete({
			t: 3000,
			agent: childName,
			task_id: "t-name",
			subject: "Matched by name fallback",
		});

		// task_complete without session_id, with unrelated agent name
		const foreignTaskByName = makeTaskComplete({
			t: 4000,
			agent: "unknown-agent",
			task_id: "t-unknown",
		});

		const links: readonly LinkEvent[] = [spawnChild, taskByName, foreignTaskByName];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(taskByName);
		expect(result).not.toContain(foreignTaskByName);
	});

	test("includes team member session links when teammate name matches an agent in the session", () => {
		const rootId = "session-leader";
		const childId = "agent-builder-1";
		const childName = "builder-alpha";
		const teamMemberSessionId = "sess-tm-alpha";

		// Leader spawns child agent
		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: childName,
		});

		// teammate_idle link from the team member session (has same agent name)
		const idleLink = makeTeammateIdle({
			t: 2000,
			teammate: childName,
			session_id: teamMemberSessionId,
		});

		// Links from the team member's session that should now be included
		const tmSessionEnd = makeSessionEnd({ t: 5000, session: teamMemberSessionId });
		const tmTask = makeTask({ t: 3000, session_id: teamMemberSessionId, task_id: "t-tm" });
		const tmMsg = makeMessage({
			t: 3500,
			from: teamMemberSessionId,
			to: "leader",
			session_id: teamMemberSessionId,
		});

		// Foreign session links that should NOT be included
		const foreignEnd = makeSessionEnd({ t: 6000, session: "foreign-sess" });

		const links: readonly LinkEvent[] = [
			spawnChild, idleLink, tmSessionEnd, tmTask, tmMsg, foreignEnd,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(idleLink);
		expect(result).toContain(tmSessionEnd);
		expect(result).toContain(tmTask);
		expect(result).toContain(tmMsg);
		expect(result).not.toContain(foreignEnd);
	});

	test("includes team member session links when parent sends msg_send to teammate", () => {
		const rootId = "session-leader";
		const teammateName = "builder-beta";
		const teammateSessionId = "sess-tm-beta";

		// Leader sends a message to the teammate by name
		const msgToTeammate = makeMessage({
			t: 1000,
			from: rootId,
			to: teammateName,
			session_id: rootId,
		});

		// teammate_idle link maps teammate name to their session
		const idleLink = makeTeammateIdle({
			t: 1500,
			teammate: teammateName,
			session_id: teammateSessionId,
		});

		// Links from the teammate's session
		const tmEnd = makeSessionEnd({ t: 5000, session: teammateSessionId });
		const tmTaskComplete = makeTaskComplete({
			t: 3000,
			agent: teammateName,
			task_id: "t-beta",
			session_id: teammateSessionId,
		});

		const links: readonly LinkEvent[] = [
			msgToTeammate, idleLink, tmEnd, tmTaskComplete,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(msgToTeammate);
		expect(result).toContain(idleLink);
		expect(result).toContain(tmEnd);
		expect(result).toContain(tmTaskComplete);
	});

	test("does NOT include team member sessions that do not belong to this parent session", () => {
		const rootId = "session-a";
		const otherRootId = "session-b";
		const otherChildId = "agent-other-child";
		const otherChildName = "builder-gamma";
		const otherTeammateSessionId = "sess-tm-gamma";

		// session B spawns a child
		const spawnOtherChild = makeSpawn({
			t: 1000,
			parent_session: otherRootId,
			agent_id: otherChildId,
			agent_name: otherChildName,
		});

		// teammate_idle for session B's child
		const otherIdleLink = makeTeammateIdle({
			t: 2000,
			teammate: otherChildName,
			session_id: otherTeammateSessionId,
		});

		// Links from the other team member's session
		const otherTmEnd = makeSessionEnd({ t: 5000, session: otherTeammateSessionId });

		const links: readonly LinkEvent[] = [
			spawnOtherChild, otherIdleLink, otherTmEnd,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).not.toContain(spawnOtherChild);
		expect(result).not.toContain(otherIdleLink);
		expect(result).not.toContain(otherTmEnd);
	});

	test("team member session expansion works alongside spawn chain expansion", () => {
		const rootId = "session-root";
		const childId = "agent-child-1";
		const childName = "builder-worker";
		const grandchildId = "agent-grandchild-1";
		const grandchildName = "builder-sub";
		const teammateSessionId = "sess-tm-worker";

		// Root spawns child, child spawns grandchild
		const spawnChild = makeSpawn({
			t: 1000,
			parent_session: rootId,
			agent_id: childId,
			agent_name: childName,
		});
		const spawnGrandchild = makeSpawn({
			t: 2000,
			parent_session: childId,
			agent_id: grandchildId,
			agent_name: grandchildName,
		});

		// teammate_idle maps childName to a different session
		const idleLink = makeTeammateIdle({
			t: 2500,
			teammate: childName,
			session_id: teammateSessionId,
		});

		// Links from both the grandchild and the teammate's session
		const gcEnd = makeSessionEnd({ t: 4000, session: grandchildId });
		const tmEnd = makeSessionEnd({ t: 5000, session: teammateSessionId });
		const rootEnd = makeSessionEnd({ t: 6000, session: rootId });

		const links: readonly LinkEvent[] = [
			spawnChild, spawnGrandchild, idleLink, gcEnd, tmEnd, rootEnd,
		];

		const result = filterLinksForSession(rootId, links);
		expect(result).toContain(spawnChild);
		expect(result).toContain(spawnGrandchild);
		expect(result).toContain(idleLink);
		expect(result).toContain(gcEnd);
		expect(result).toContain(tmEnd);
		expect(result).toContain(rootEnd);
		expect(result.length).toBe(6);
	});
});

describe("buildTeamMemberSessionMap", () => {
	test("returns empty map for empty links", () => {
		const result = buildTeamMemberSessionMap([]);
		expect(result.size).toBe(0);
	});

	test("returns empty map when no teammate_idle links exist", () => {
		const links: readonly LinkEvent[] = [
			makeSpawn({ parent_session: "root", agent_id: "child-1" }),
			makeSessionEnd({ session: "root" }),
		];
		const result = buildTeamMemberSessionMap(links);
		expect(result.size).toBe(0);
	});

	test("maps teammate name to session_id from teammate_idle links", () => {
		const links: readonly LinkEvent[] = [
			makeTeammateIdle({ teammate: "builder-alpha", session_id: "sess-alpha" }),
			makeTeammateIdle({ teammate: "builder-beta", session_id: "sess-beta" }),
		];
		const result = buildTeamMemberSessionMap(links);
		expect(result.size).toBe(2);
		expect(result.get("builder-alpha")).toBe("sess-alpha");
		expect(result.get("builder-beta")).toBe("sess-beta");
	});

	test("excludes entries with empty teammate name", () => {
		const links: readonly LinkEvent[] = [
			makeTeammateIdle({ teammate: "", session_id: "sess-empty" }),
			makeTeammateIdle({ teammate: "builder-valid", session_id: "sess-valid" }),
		];
		const result = buildTeamMemberSessionMap(links);
		expect(result.size).toBe(1);
		expect(result.get("builder-valid")).toBe("sess-valid");
	});

	test("excludes entries with undefined session_id", () => {
		const links: readonly LinkEvent[] = [
			makeTeammateIdle({ teammate: "builder-no-session" }),
			makeTeammateIdle({ teammate: "builder-valid", session_id: "sess-valid" }),
		];
		const result = buildTeamMemberSessionMap(links);
		expect(result.size).toBe(1);
		expect(result.get("builder-valid")).toBe("sess-valid");
	});

	test("excludes entries with empty session_id", () => {
		const links: readonly LinkEvent[] = [
			makeTeammateIdle({ teammate: "builder-empty-sid", session_id: "" }),
			makeTeammateIdle({ teammate: "builder-ok", session_id: "sess-ok" }),
		];
		const result = buildTeamMemberSessionMap(links);
		expect(result.size).toBe(1);
		expect(result.get("builder-ok")).toBe("sess-ok");
	});

	test("later entries overwrite earlier ones for same teammate name", () => {
		const links: readonly LinkEvent[] = [
			makeTeammateIdle({ teammate: "builder-dup", session_id: "sess-old" }),
			makeTeammateIdle({ teammate: "builder-dup", session_id: "sess-new" }),
		];
		const result = buildTeamMemberSessionMap(links);
		expect(result.size).toBe(1);
		expect(result.get("builder-dup")).toBe("sess-new");
	});
});

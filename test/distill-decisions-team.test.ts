import { describe, expect, test } from "bun:test";
import { buildTeamPhases, hasTaskLinks } from "../src/distill/decisions-team";
import type { LinkEvent, SpawnLink, StoredEvent, TaskLink } from "../src/types";

// --- Helpers ---

const mkEvent = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
	t: 1000,
	event: "PostToolUse",
	sid: "session-1",
	data: {},
	...overrides,
});

const mkToolEvent = (t: number, toolName: string): StoredEvent =>
	mkEvent({ t, data: { tool_name: toolName } });

const mkTaskLink = (overrides: Partial<TaskLink> = {}): TaskLink => ({
	t: 1000,
	type: "task",
	action: "create",
	task_id: "task-1",
	session_id: "session-1",
	...overrides,
});

const mkSpawnLink = (overrides: Partial<SpawnLink> = {}): SpawnLink => ({
	t: 1000,
	type: "spawn",
	parent_session: "leader-session",
	agent_id: "agent-1",
	agent_type: "builder",
	agent_name: "builder-1",
	...overrides,
});

// --- hasTaskLinks ---

describe("hasTaskLinks", () => {
	test("returns false for empty array", () => {
		expect(hasTaskLinks([])).toBe(false);
	});

	test("returns false for non-task links", () => {
		const links: readonly LinkEvent[] = [
			mkSpawnLink(),
			{
				t: 2000,
				type: "stop",
				parent_session: "leader-session",
				agent_id: "agent-1",
			},
			{
				t: 3000,
				type: "msg_send",
				session_id: "session-1",
				from: "leader",
				to: "builder-1",
				msg_type: "message",
			},
		];

		expect(hasTaskLinks(links)).toBe(false);
	});

	test("returns true when task links present", () => {
		const links: readonly LinkEvent[] = [
			mkSpawnLink(),
			mkTaskLink({ action: "assign", agent: "builder-1" }),
		];

		expect(hasTaskLinks(links)).toBe(true);
	});
});

// --- buildTeamPhases ---

describe("buildTeamPhases", () => {
	test("returns single Build phase with zero timestamps for empty events", () => {
		const result = buildTeamPhases([], []);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Build");
		expect(result[0].start_t).toBe(0);
		expect(result[0].end_t).toBe(0);
		expect(result[0].tool_types).toEqual([]);
	});

	test("returns single Build phase when no task assignments", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent(1000, "Read"),
			mkToolEvent(2000, "Edit"),
			mkToolEvent(3000, "Bash"),
		];

		const result = buildTeamPhases(events, []);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Build");
		expect(result[0].start_t).toBe(1000);
		expect(result[0].end_t).toBe(3000);
		// Build filter uses e.t < buildEnd, so the last event (at sessionEnd) is excluded from tool_types
		expect(result[0].tool_types).toContain("Read");
		expect(result[0].tool_types).toContain("Edit");
	});

	test("returns Planning + Build phases when task assignments exist", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent(1000, "Read"),
			mkToolEvent(2000, "Read"),
			mkToolEvent(3000, "Edit"),
			mkToolEvent(4000, "Bash"),
			mkToolEvent(5000, "Edit"),
		];
		const links: readonly LinkEvent[] = [
			mkTaskLink({ t: 3000, action: "assign", agent: "builder-1" }),
		];

		const result = buildTeamPhases(events, links);

		expect(result).toHaveLength(2);
		expect(result[0].name).toBe("Planning");
		expect(result[0].start_t).toBe(1000);
		expect(result[0].end_t).toBe(3000);
		expect(result[1].name).toBe("Build");
		expect(result[1].start_t).toBe(3000);
		expect(result[1].end_t).toBe(5000);
	});

	test("returns Planning + Build + Validation phases when validator agents present", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent(1000, "Read"),
			mkToolEvent(2000, "Read"),
			mkToolEvent(3000, "Edit"),
			mkToolEvent(4000, "Bash"),
			mkToolEvent(5000, "Edit"),
			mkToolEvent(6000, "Read"),
		];
		const links: readonly LinkEvent[] = [
			mkTaskLink({ t: 2000, action: "assign", agent: "builder-1" }),
			mkSpawnLink({
				t: 5000,
				agent_id: "validator-1",
				agent_type: "validator",
				agent_name: "validator-agent",
			}),
		];

		const result = buildTeamPhases(events, links);

		expect(result).toHaveLength(3);
		expect(result[0].name).toBe("Planning");
		expect(result[0].start_t).toBe(1000);
		expect(result[0].end_t).toBe(2000);
		expect(result[1].name).toBe("Build");
		expect(result[1].start_t).toBe(2000);
		expect(result[1].end_t).toBe(5000);
		expect(result[2].name).toBe("Validation");
		expect(result[2].start_t).toBe(5000);
		expect(result[2].end_t).toBe(6000);
	});

	test("events with no task links but with other link types produce single Build phase", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent(1000, "Read"),
			mkToolEvent(2000, "Edit"),
		];
		const links: readonly LinkEvent[] = [
			mkSpawnLink({ t: 1000 }),
			{
				t: 1500,
				type: "msg_send",
				session_id: "session-1",
				from: "leader",
				to: "builder-1",
				msg_type: "message",
			},
		];

		const result = buildTeamPhases(events, links);

		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Build");
	});

	test("validator spawn at session start yields Build + Validation (no Planning)", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent(1000, "Read"),
			mkToolEvent(2000, "Edit"),
			mkToolEvent(3000, "Bash"),
		];
		const links: readonly LinkEvent[] = [
			mkSpawnLink({
				t: 1000,
				agent_id: "validator-1",
				agent_type: "validator",
				agent_name: "validator-agent",
			}),
		];

		const result = buildTeamPhases(events, links);

		// No task assignment => no Planning phase, but validator present
		// Build phase ends at validator spawn, Validation from there to end
		const phaseNames = result.map((p) => p.name);
		expect(phaseNames).toContain("Build");
		expect(phaseNames).toContain("Validation");
		expect(phaseNames).not.toContain("Planning");
	});

	test("all events at same timestamp produce valid phases", () => {
		const t = 5000;
		const events: readonly StoredEvent[] = [
			mkToolEvent(t, "Read"),
			mkToolEvent(t, "Edit"),
			mkToolEvent(t, "Bash"),
		];
		const links: readonly LinkEvent[] = [
			mkTaskLink({ t, action: "assign", agent: "builder-1" }),
		];

		const result = buildTeamPhases(events, links);

		// All timestamps equal: no Planning phase (planningEnd === sessionStart)
		// Build phase from t to t
		expect(result.length).toBeGreaterThanOrEqual(1);
		result.forEach((phase) => {
			expect(phase.start_t).toBeLessThanOrEqual(phase.end_t);
			expect(phase.start_t).toBe(t);
			expect(phase.end_t).toBe(t);
		});
	});
});

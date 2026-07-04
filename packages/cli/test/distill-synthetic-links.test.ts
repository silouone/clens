import { describe, expect, test } from "bun:test";
import {
	buildSyntheticLinks,
	extractUnlinkedAgentCalls,
	matchAgentCallsToSessions,
	type ScanSessionFilesFn,
	synthesizeSpawnLinks,
} from "../src/distill/synthetic-links";
import type { LinkEvent, SpawnLink, StopLink, StoredEvent } from "../src/types";

/** No-op scan function for tests that never reach the scan phase. */
const noopScan: ScanSessionFilesFn = () => [];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeStoredEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: 1000,
	sid: "root-session",
	data: {},
	...overrides,
});

const makeAgentPreToolUse = (
	t: number,
	name: string,
	subagentType: string,
	description = "",
): StoredEvent =>
	makeStoredEvent({
		t,
		event: "PreToolUse",
		data: {
			tool_name: "Agent",
			tool_input: { name, subagent_type: subagentType, description },
		},
	});

const makeSpawnLink = (overrides: Partial<SpawnLink> = {}): SpawnLink => ({
	t: 1000,
	type: "spawn",
	parent_session: "root-session",
	agent_id: "agent-1",
	agent_type: "builder",
	...overrides,
});

const makeStopLink = (overrides: Partial<StopLink> = {}): StopLink => ({
	t: 2000,
	type: "stop",
	parent_session: "root-session",
	agent_id: "agent-1",
	...overrides,
});

interface AgentCall {
	readonly t: number;
	readonly name: string;
	readonly agentType: string;
	readonly description: string;
}

interface SessionFileInfo {
	readonly sessionId: string;
	readonly startT: number;
	readonly endT: number | undefined;
}

interface AgentSessionMatch {
	readonly call: AgentCall;
	readonly session: SessionFileInfo;
	readonly deltaMs: number;
}

// ---------------------------------------------------------------------------
// extractUnlinkedAgentCalls
// ---------------------------------------------------------------------------

describe("extractUnlinkedAgentCalls", () => {
	test("returns empty when Agent call has matching SpawnLink within 2s", () => {
		const events = [makeAgentPreToolUse(1000, "builder-data", "builder")];
		const links: readonly LinkEvent[] = [makeSpawnLink({ t: 1500, agent_type: "builder" })];

		const result = extractUnlinkedAgentCalls(events, links);
		expect(result).toEqual([]);
	});

	test("returns AgentCall when no matching SubagentStart exists", () => {
		const events = [makeAgentPreToolUse(1000, "builder-data", "builder", "build the data layer")];
		const links: readonly LinkEvent[] = [];

		const result = extractUnlinkedAgentCalls(events, links);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("builder-data");
		expect(result[0].agentType).toBe("builder");
		expect(result[0].description).toBe("build the data layer");
		expect(result[0].t).toBe(1000);
	});

	test("returns only unlinked calls when some are linked and some are not", () => {
		const events = [
			makeAgentPreToolUse(1000, "builder-a", "builder"),
			makeAgentPreToolUse(2000, "researcher-b", "researcher"),
			makeAgentPreToolUse(3000, "builder-c", "builder"),
		];
		// Only builder at t=1000 and t=3000 have matching spawns
		const links: readonly LinkEvent[] = [
			makeSpawnLink({ t: 1100, agent_type: "builder" }),
			makeSpawnLink({ t: 3100, agent_type: "builder" }),
		];

		const result = extractUnlinkedAgentCalls(events, links);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("researcher-b");
	});

	test("filters out Agent call without name or subagent_type", () => {
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Agent",
					tool_input: { description: "some work" },
				},
			}),
		];

		const result = extractUnlinkedAgentCalls(events, []);
		expect(result).toEqual([]);
	});

	test("Agent call with name but no subagent_type is included", () => {
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Agent",
					tool_input: { name: "helper" },
				},
			}),
		];

		const result = extractUnlinkedAgentCalls(events, []);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("helper");
		expect(result[0].agentType).toBe("");
	});

	test("Agent call with subagent_type but no name is included", () => {
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Agent",
					tool_input: { subagent_type: "builder" },
				},
			}),
		];

		const result = extractUnlinkedAgentCalls(events, []);
		expect(result).toHaveLength(1);
		expect(result[0].agentType).toBe("builder");
		expect(result[0].name).toBe("");
	});

	test("SpawnLink with wrong agent_type does not match", () => {
		const events = [makeAgentPreToolUse(1000, "builder-x", "builder")];
		const links: readonly LinkEvent[] = [makeSpawnLink({ t: 1100, agent_type: "researcher" })];

		const result = extractUnlinkedAgentCalls(events, links);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("builder-x");
	});

	test("SpawnLink outside 2s window does not match", () => {
		const events = [makeAgentPreToolUse(1000, "builder-x", "builder")];
		const links: readonly LinkEvent[] = [makeSpawnLink({ t: 5000, agent_type: "builder" })];

		const result = extractUnlinkedAgentCalls(events, links);
		expect(result).toHaveLength(1);
	});

	test("ignores non-Agent PreToolUse events", () => {
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_input: {} },
			}),
		];

		const result = extractUnlinkedAgentCalls(events, []);
		expect(result).toEqual([]);
	});

	test("ignores non-PreToolUse events", () => {
		const events = [
			makeStoredEvent({ t: 1000, event: "PostToolUse", data: { tool_name: "Agent" } }),
			makeStoredEvent({ t: 1000, event: "SessionStart" }),
		];

		const result = extractUnlinkedAgentCalls(events, []);
		expect(result).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// matchAgentCallsToSessions
// ---------------------------------------------------------------------------

describe("matchAgentCallsToSessions", () => {
	test("single call matched to single candidate within window", () => {
		const calls: readonly AgentCall[] = [
			{ t: 1000, name: "builder-a", agentType: "builder", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-a", startT: 1200, endT: 5000 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toHaveLength(1);
		expect(result[0].call.name).toBe("builder-a");
		expect(result[0].session.sessionId).toBe("sess-a");
		expect(result[0].deltaMs).toBe(200);
	});

	test("candidate outside 15s window is not matched", () => {
		const calls: readonly AgentCall[] = [
			{ t: 1000, name: "builder-a", agentType: "builder", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-a", startT: 20_000, endT: 30_000 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toEqual([]);
	});

	test("candidate startT before call.t is not matched", () => {
		const calls: readonly AgentCall[] = [
			{ t: 5000, name: "builder-a", agentType: "builder", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-a", startT: 4000, endT: 8000 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toEqual([]);
	});

	test("multiple calls matched to multiple candidates by closest fit", () => {
		const calls: readonly AgentCall[] = [
			{ t: 1000, name: "builder-a", agentType: "builder", description: "" },
			{ t: 5000, name: "researcher-b", agentType: "researcher", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-1", startT: 1100, endT: 3000 },
			{ sessionId: "sess-2", startT: 5200, endT: 8000 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toHaveLength(2);
		expect(result[0].session.sessionId).toBe("sess-1");
		expect(result[0].deltaMs).toBe(100);
		expect(result[1].session.sessionId).toBe("sess-2");
		expect(result[1].deltaMs).toBe(200);
	});

	test("duplicate agent names match sequentially without double-claim", () => {
		const calls: readonly AgentCall[] = [
			{ t: 1000, name: "builder-data", agentType: "builder", description: "" },
			{ t: 3000, name: "builder-data", agentType: "builder", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-1", startT: 1100, endT: 2000 },
			{ sessionId: "sess-2", startT: 3100, endT: 5000 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toHaveLength(2);
		expect(result[0].session.sessionId).toBe("sess-1");
		expect(result[1].session.sessionId).toBe("sess-2");
	});

	test("more calls than candidates: matches what it can", () => {
		const calls: readonly AgentCall[] = [
			{ t: 1000, name: "a", agentType: "builder", description: "" },
			{ t: 2000, name: "b", agentType: "builder", description: "" },
			{ t: 3000, name: "c", agentType: "builder", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-1", startT: 1100, endT: 1500 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toHaveLength(1);
		expect(result[0].call.name).toBe("a");
		expect(result[0].session.sessionId).toBe("sess-1");
	});

	test("more candidates than calls: each call claims one", () => {
		const calls: readonly AgentCall[] = [
			{ t: 1000, name: "a", agentType: "builder", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-1", startT: 1050, endT: 2000 },
			{ sessionId: "sess-2", startT: 1100, endT: 3000 },
			{ sessionId: "sess-3", startT: 1200, endT: 4000 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toHaveLength(1);
		expect(result[0].session.sessionId).toBe("sess-1"); // closest
	});

	test("empty calls returns empty matches", () => {
		const result = matchAgentCallsToSessions(
			[],
			[{ sessionId: "sess-1", startT: 1000, endT: 2000 }],
		);
		expect(result).toEqual([]);
	});

	test("empty candidates returns empty matches", () => {
		const result = matchAgentCallsToSessions(
			[{ t: 1000, name: "a", agentType: "builder", description: "" }],
			[],
		);
		expect(result).toEqual([]);
	});

	test("selects closest candidate when multiple are within window", () => {
		const calls: readonly AgentCall[] = [
			{ t: 1000, name: "a", agentType: "builder", description: "" },
		];
		const candidates: readonly SessionFileInfo[] = [
			{ sessionId: "sess-far", startT: 5000, endT: 8000 },
			{ sessionId: "sess-close", startT: 1010, endT: 3000 },
			{ sessionId: "sess-mid", startT: 2000, endT: 4000 },
		];

		const result = matchAgentCallsToSessions(calls, candidates);
		expect(result).toHaveLength(1);
		expect(result[0].session.sessionId).toBe("sess-close");
		expect(result[0].deltaMs).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// buildSyntheticLinks
// ---------------------------------------------------------------------------

describe("buildSyntheticLinks", () => {
	const makeMatch = (overrides: Partial<AgentSessionMatch> = {}): AgentSessionMatch => ({
		call: { t: 1000, name: "builder-a", agentType: "builder", description: "do stuff" },
		session: { sessionId: "child-sess", startT: 1200, endT: 5000 },
		deltaMs: 200,
		...overrides,
	});

	test("produces SpawnLink with correct fields and synthetic=true", () => {
		const matches = [makeMatch()];

		const { spawns, stops } = buildSyntheticLinks(matches, "parent-sess");
		expect(spawns).toHaveLength(1);
		expect(spawns[0].type).toBe("spawn");
		expect(spawns[0].t).toBe(1000);
		expect(spawns[0].parent_session).toBe("parent-sess");
		expect(spawns[0].agent_id).toBe("child-sess");
		expect(spawns[0].agent_type).toBe("builder");
		expect(spawns[0].agent_name).toBe("builder-a");
		expect(spawns[0].synthetic).toBe(true);
	});

	test("produces StopLink with correct fields from endT", () => {
		const matches = [makeMatch()];

		const { stops } = buildSyntheticLinks(matches, "parent-sess");
		expect(stops).toHaveLength(1);
		expect(stops[0].type).toBe("stop");
		expect(stops[0].t).toBe(5000);
		expect(stops[0].parent_session).toBe("parent-sess");
		expect(stops[0].agent_id).toBe("child-sess");
		expect(stops[0].synthetic).toBe(true);
	});

	test("no StopLink when session endT is undefined", () => {
		const matches = [
			makeMatch({
				session: { sessionId: "child-sess", startT: 1200, endT: undefined },
			}),
		];

		const { spawns, stops } = buildSyntheticLinks(matches, "parent-sess");
		expect(spawns).toHaveLength(1);
		expect(stops).toEqual([]);
	});

	test("empty matches produces empty results", () => {
		const { spawns, stops } = buildSyntheticLinks([], "parent-sess");
		expect(spawns).toEqual([]);
		expect(stops).toEqual([]);
	});

	test("multiple matches produce correct spawn and stop counts", () => {
		const matches = [
			makeMatch({
				call: { t: 1000, name: "a", agentType: "builder", description: "" },
				session: { sessionId: "s1", startT: 1100, endT: 3000 },
			}),
			makeMatch({
				call: { t: 2000, name: "b", agentType: "researcher", description: "" },
				session: { sessionId: "s2", startT: 2200, endT: undefined },
			}),
			makeMatch({
				call: { t: 3000, name: "c", agentType: "builder", description: "" },
				session: { sessionId: "s3", startT: 3100, endT: 8000 },
			}),
		];

		const { spawns, stops } = buildSyntheticLinks(matches, "parent-sess");
		expect(spawns).toHaveLength(3);
		expect(stops).toHaveLength(2); // s2 has no endT
		expect(spawns[1].agent_type).toBe("researcher");
		expect(stops[0].agent_id).toBe("s1");
		expect(stops[1].agent_id).toBe("s3");
	});

	test("agent_name is undefined when call.name is empty string", () => {
		const matches = [
			makeMatch({
				call: { t: 1000, name: "", agentType: "builder", description: "" },
			}),
		];

		const { spawns } = buildSyntheticLinks(matches, "parent-sess");
		expect(spawns[0].agent_name).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// synthesizeSpawnLinks (integration — no-op cases only, avoids filesystem)
// ---------------------------------------------------------------------------

describe("synthesizeSpawnLinks", () => {
	test("returns empty when all Agent calls are already linked", () => {
		const events = [makeAgentPreToolUse(1000, "builder-a", "builder")];
		const links: readonly LinkEvent[] = [
			makeSpawnLink({ t: 1100, agent_type: "builder", agent_id: "child-1" }),
		];

		const result = synthesizeSpawnLinks(events, links, "/tmp/proj", "root-session", noopScan);
		expect(result.spawns).toEqual([]);
		expect(result.stops).toEqual([]);
	});

	test("returns empty when no Agent PreToolUse events exist", () => {
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart" }),
			makeStoredEvent({ t: 2000, event: "PostToolUse", data: { tool_name: "Edit" } }),
		];

		const result = synthesizeSpawnLinks(events, [], "/tmp/proj", "root-session", noopScan);
		expect(result.spawns).toEqual([]);
		expect(result.stops).toEqual([]);
	});

	test("returns empty for empty events array", () => {
		const result = synthesizeSpawnLinks([], [], "/tmp/proj", "root-session", noopScan);
		expect(result.spawns).toEqual([]);
		expect(result.stops).toEqual([]);
	});

	test("returns empty when events have t=0 timestamps", () => {
		const events = [
			makeStoredEvent({
				t: 0,
				event: "PreToolUse",
				data: {
					tool_name: "Agent",
					tool_input: { name: "builder-a", subagent_type: "builder" },
				},
			}),
		];

		const result = synthesizeSpawnLinks(events, [], "/tmp/proj", "root-session", noopScan);
		expect(result.spawns).toEqual([]);
		expect(result.stops).toEqual([]);
	});
});

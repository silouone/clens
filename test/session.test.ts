import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cleanAll, cleanSession } from "../src/session/clean";
import { listSessions, readSessionEvents } from "../src/session/read";
import type { SessionStartContext, StoredEvent } from "../src/types";

const TEST_DIR = "/tmp/clens-test-session";

const makeStoredEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

const makeSessionStartContext = (
	overrides: Partial<SessionStartContext> = {},
): SessionStartContext => ({
	project_dir: "/test/project",
	cwd: "/test/project",
	git_branch: null,
	git_remote: null,
	git_commit: null,
	git_worktree: null,
	team_name: null,
	task_list_dir: null,
	claude_entrypoint: null,
	model: null,
	agent_type: null,
	...overrides,
});

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
	mkdirSync(`${TEST_DIR}/.clens/distilled`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("listSessions", () => {
	test("returns empty array when no sessions", () => {
		const sessions = listSessions(TEST_DIR);
		expect(sessions).toEqual([]);
	});

	test("lists sessions from JSONL files", () => {
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-1" })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid: "sess-1" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-1.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		expect(sessions.length).toBe(1);
		expect(sessions[0].session_id).toBe("sess-1");
		expect(sessions[0].status).toBe("complete");
		expect(sessions[0].duration_ms).toBe(4000);
		expect(sessions[0].event_count).toBe(2);
	});

	test("marks incomplete sessions", () => {
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-2" })),
			JSON.stringify(makeStoredEvent({ t: 3000, event: "PreToolUse", sid: "sess-2" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-2.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		expect(sessions[0].status).toBe("incomplete");
	});

	test("excludes _links.jsonl", () => {
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, '{"t":1}\n');
		const sessions = listSessions(TEST_DIR);
		expect(sessions.length).toBe(0);
	});

	test("returns empty when sessions dir missing", () => {
		rmSync(`${TEST_DIR}/.clens/sessions`, { recursive: true, force: true });
		const sessions = listSessions(TEST_DIR);
		expect(sessions).toEqual([]);
	});

	test("extracts git_branch from SessionStart context", () => {
		const events = [
			JSON.stringify(
				makeStoredEvent({
					t: 1000,
					event: "SessionStart",
					sid: "sess-branch",
					context: makeSessionStartContext({ git_branch: "feature/test-branch" }),
				}),
			),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid: "sess-branch" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-branch.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		expect(sessions.length).toBe(1);
		expect(sessions[0].git_branch).toBe("feature/test-branch");
	});

	test("extracts team_name from SessionStart context", () => {
		const events = [
			JSON.stringify(
				makeStoredEvent({
					t: 1000,
					event: "SessionStart",
					sid: "sess-team",
					context: makeSessionStartContext({ team_name: "backend-squad" }),
				}),
			),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid: "sess-team" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-team.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		expect(sessions.length).toBe(1);
		expect(sessions[0].team_name).toBe("backend-squad");
	});

	test("git_branch and team_name are undefined when context is missing", () => {
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-nocontext" })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid: "sess-nocontext" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-nocontext.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		expect(sessions[0].git_branch).toBeUndefined();
		expect(sessions[0].team_name).toBeUndefined();
	});

	test("skips files with empty content", () => {
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-empty.jsonl`, "\n");

		const sessions = listSessions(TEST_DIR);
		expect(sessions.length).toBe(0);
	});

	test("skips files with invalid JSON content gracefully", () => {
		writeFileSync(
			`${TEST_DIR}/.clens/sessions/sess-corrupt.jsonl`,
			"not valid json at all\n",
		);

		const sessions = listSessions(TEST_DIR);
		expect(sessions.length).toBe(0);
	});

	test("sorts sessions by start_time descending", () => {
		const sessionsData = [
			{ id: "sess-old", startT: 1000, endT: 2000 },
			{ id: "sess-new", startT: 5000, endT: 6000 },
			{ id: "sess-mid", startT: 3000, endT: 4000 },
		];
		for (const { id, startT, endT } of sessionsData) {
			const events = [
				JSON.stringify(makeStoredEvent({ t: startT, event: "SessionStart", sid: id })),
				JSON.stringify(makeStoredEvent({ t: endT, event: "SessionEnd", sid: id })),
			].join("\n");
			writeFileSync(`${TEST_DIR}/.clens/sessions/${id}.jsonl`, `${events}\n`);
		}

		const sessions = listSessions(TEST_DIR);
		expect(sessions[0].session_id).toBe("sess-new");
		expect(sessions[1].session_id).toBe("sess-mid");
		expect(sessions[2].session_id).toBe("sess-old");
	});

	test("marks session complete when last event is Stop", () => {
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-stop" })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "Stop", sid: "sess-stop" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-stop.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		expect(sessions[0].status).toBe("complete");
	});
});

describe("readSessionEvents", () => {
	test("reads and parses all events", () => {
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-r" })),
			JSON.stringify(
				makeStoredEvent({
					t: 2000,
					event: "PreToolUse",
					sid: "sess-r",
					data: { tool_name: "Bash" },
				}),
			),
			JSON.stringify(makeStoredEvent({ t: 3000, event: "SessionEnd", sid: "sess-r" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-r.jsonl`, `${events}\n`);

		const parsed = readSessionEvents("sess-r", TEST_DIR);
		expect(parsed.length).toBe(3);
		expect(parsed[0].event).toBe("SessionStart");
		expect(parsed[1].data.tool_name).toBe("Bash");
		expect(parsed[2].event).toBe("SessionEnd");
	});

	test("handles malformed JSON lines gracefully by skipping them", () => {
		const content = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-malformed" })),
			"this is not valid JSON {{{",
			"",
			JSON.stringify(makeStoredEvent({ t: 3000, event: "SessionEnd", sid: "sess-malformed" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-malformed.jsonl`, `${content}\n`);

		const parsed = readSessionEvents("sess-malformed", TEST_DIR);
		expect(parsed.length).toBe(2);
		expect(parsed[0].event).toBe("SessionStart");
		expect(parsed[1].event).toBe("SessionEnd");
	});

	test("returns empty array for empty file", () => {
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-empty.jsonl`, "");

		const parsed = readSessionEvents("sess-empty", TEST_DIR);
		expect(parsed).toEqual([]);
	});

	test("returns empty array for file with only whitespace", () => {
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-ws.jsonl`, "   \n  \n  ");

		const parsed = readSessionEvents("sess-ws", TEST_DIR);
		expect(parsed).toEqual([]);
	});
});

describe("enrichSessionSummaries", () => {
	test("returns agent_count from spawn links", () => {
		const { enrichSessionSummaries } = require("../src/session/read");
		const sid = "sess-enrich-1";
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/${sid}.jsonl`, `${events}\n`);

		// Write spawn links with this session as parent
		const spawnLink1 = JSON.stringify({ t: 2000, type: "spawn", parent_session: sid, agent_id: "child-1", agent_type: "builder" });
		const spawnLink2 = JSON.stringify({ t: 3000, type: "spawn", parent_session: sid, agent_id: "child-2", agent_type: "builder" });
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawnLink1}\n${spawnLink2}\n`);

		const sessions = listSessions(TEST_DIR);
		const enriched = enrichSessionSummaries(sessions, TEST_DIR);
		expect(enriched.length).toBe(1);
		expect(enriched[0].agent_count).toBe(2);
	});

	test("returns 0 agent_count for sessions with no spawn links", () => {
		const { enrichSessionSummaries } = require("../src/session/read");
		const sid = "sess-enrich-2";
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/${sid}.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		const enriched = enrichSessionSummaries(sessions, TEST_DIR);
		expect(enriched[0].agent_count).toBe(0);
	});

	test("detects is_distilled when distilled file exists", () => {
		const { enrichSessionSummaries } = require("../src/session/read");
		const sid = "sess-enrich-3";
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/${sid}.jsonl`, `${events}\n`);
		writeFileSync(`${TEST_DIR}/.clens/distilled/${sid}.json`, '{"session_id": "test"}');

		const sessions = listSessions(TEST_DIR);
		const enriched = enrichSessionSummaries(sessions, TEST_DIR);
		expect(enriched[0].is_distilled).toBe(true);
	});

	test("returns is_distilled false when no distilled file", () => {
		const { enrichSessionSummaries } = require("../src/session/read");
		const sid = "sess-enrich-4";
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/${sid}.jsonl`, `${events}\n`);

		const sessions = listSessions(TEST_DIR);
		const enriched = enrichSessionSummaries(sessions, TEST_DIR);
		expect(enriched[0].is_distilled).toBe(false);
	});

	test("detects has_spec when plan_drift present in distilled", () => {
		const { enrichSessionSummaries } = require("../src/session/read");
		const sid = "sess-enrich-5";
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/${sid}.jsonl`, `${events}\n`);
		writeFileSync(`${TEST_DIR}/.clens/distilled/${sid}.json`, JSON.stringify({
			session_id: sid,
			plan_drift: { spec_path: "specs/test.md", drift_score: 0.5, expected_files: [], actual_files: [], unexpected_files: [], missing_files: [] },
		}));

		const sessions = listSessions(TEST_DIR);
		const enriched = enrichSessionSummaries(sessions, TEST_DIR);
		expect(enriched[0].has_spec).toBe(true);
	});

	test("returns has_spec false when no plan_drift in distilled", () => {
		const { enrichSessionSummaries } = require("../src/session/read");
		const sid = "sess-enrich-6";
		const events = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/${sid}.jsonl`, `${events}\n`);
		writeFileSync(`${TEST_DIR}/.clens/distilled/${sid}.json`, '{"session_id": "test"}');

		const sessions = listSessions(TEST_DIR);
		const enriched = enrichSessionSummaries(sessions, TEST_DIR);
		expect(enriched[0].has_spec).toBe(false);
	});
});

describe("cleanSession", () => {
	test("removes session file when distilled", () => {
		const events = JSON.stringify(
			makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-c" }),
		);
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-c.jsonl`, `${events}\n`);
		writeFileSync(`${TEST_DIR}/.clens/distilled/sess-c.json`, "{}");

		const result = cleanSession("sess-c", TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-c.jsonl`)).toBe(false);
		expect(result.session_id).toBe("sess-c");
		expect(result.freed_bytes).toBeGreaterThan(0);
	});

	test("throws when session not found", () => {
		expect(() => cleanSession("nonexistent", TEST_DIR)).toThrow("not found");
	});

	test("refuses when no distilled file exists (safety check)", () => {
		const events = JSON.stringify(
			makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-d" }),
		);
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-d.jsonl`, `${events}\n`);

		expect(() => cleanSession("sess-d", TEST_DIR)).toThrow("has not been distilled");
	});

	test("proceeds with force: true even without distilled file", () => {
		const events = JSON.stringify(
			makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-f" }),
		);
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-f.jsonl`, `${events}\n`);

		const result = cleanSession("sess-f", TEST_DIR, { force: true });
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-f.jsonl`)).toBe(false);
		expect(result.session_id).toBe("sess-f");
		expect(result.freed_bytes).toBeGreaterThan(0);
	});
});

describe("cleanAll", () => {
	test("cleans multiple sessions that have distilled files", () => {
		// Create two sessions with distill files
		for (const id of ["sess-a", "sess-b"]) {
			const events = [
				JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: id })),
				JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid: id })),
			].join("\n");
			writeFileSync(`${TEST_DIR}/.clens/sessions/${id}.jsonl`, `${events}\n`);
			writeFileSync(`${TEST_DIR}/.clens/distilled/${id}.json`, "{}");
		}

		const result = cleanAll(TEST_DIR);
		expect(result.cleaned).toBe(2);
		expect(result.freed_bytes).toBeGreaterThan(0);
		expect(result.skipped).toEqual([]);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-a.jsonl`)).toBe(false);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-b.jsonl`)).toBe(false);
	});

	test("reports skipped sessions without distilled files", () => {
		// Create one distilled and one not
		const distilledEvents = [
			JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: "sess-dist" })),
			JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid: "sess-dist" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-dist.jsonl`, `${distilledEvents}\n`);
		writeFileSync(`${TEST_DIR}/.clens/distilled/sess-dist.json`, "{}");

		const undistilledEvents = [
			JSON.stringify(makeStoredEvent({ t: 2000, event: "SessionStart", sid: "sess-nodist" })),
			JSON.stringify(makeStoredEvent({ t: 6000, event: "SessionEnd", sid: "sess-nodist" })),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/sess-nodist.jsonl`, `${undistilledEvents}\n`);

		const result = cleanAll(TEST_DIR);
		expect(result.cleaned).toBe(1);
		expect(result.skipped).toContain("sess-nodist");
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-dist.jsonl`)).toBe(false);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-nodist.jsonl`)).toBe(true);
	});

	test("with force: true cleans everything regardless of distilled status", () => {
		for (const id of ["sess-f1", "sess-f2"]) {
			const events = [
				JSON.stringify(makeStoredEvent({ t: 1000, event: "SessionStart", sid: id })),
				JSON.stringify(makeStoredEvent({ t: 5000, event: "SessionEnd", sid: id })),
			].join("\n");
			writeFileSync(`${TEST_DIR}/.clens/sessions/${id}.jsonl`, `${events}\n`);
		}
		// Only distill one of them
		writeFileSync(`${TEST_DIR}/.clens/distilled/sess-f1.json`, "{}");

		const result = cleanAll(TEST_DIR, { force: true });
		expect(result.cleaned).toBe(2);
		expect(result.skipped).toEqual([]);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-f1.jsonl`)).toBe(false);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/sess-f2.jsonl`)).toBe(false);
	});

	test("returns zero counts when no sessions exist", () => {
		const result = cleanAll(TEST_DIR);
		expect(result.cleaned).toBe(0);
		expect(result.freed_bytes).toBe(0);
		expect(result.skipped).toEqual([]);
	});
});

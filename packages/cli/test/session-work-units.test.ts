import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import {
	buildSubagentIdSet,
	getRelatedSessions,
	readWorkUnitIndex,
	writeWorkUnitIndex,
} from "../src/session/work-units";
import type { WorkUnitIndex } from "../src/types";

const TEST_DIR = "/tmp/clens-work-units-test";

const makeIndex = (overrides: Partial<WorkUnitIndex> = {}): WorkUnitIndex => ({
	version: 1,
	updated_at: Date.now(),
	units: [],
	...overrides,
});

describe("readWorkUnitIndex", () => {
	beforeEach(() => {
		mkdirSync(`${TEST_DIR}/.clens`, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("returns undefined when file does not exist", () => {
		const result = readWorkUnitIndex(TEST_DIR);
		expect(result).toBeUndefined();
	});

	test("parses valid index JSON", () => {
		const index = makeIndex({ units: [] });
		writeFileSync(`${TEST_DIR}/.clens/_work_units.json`, JSON.stringify(index));

		const result = readWorkUnitIndex(TEST_DIR);
		expect(result).toBeDefined();
		expect(result?.version).toBe(1);
		expect(result?.units).toEqual([]);
	});

	test("returns undefined for invalid JSON", () => {
		writeFileSync(`${TEST_DIR}/.clens/_work_units.json`, "not json");

		const result = readWorkUnitIndex(TEST_DIR);
		expect(result).toBeUndefined();
	});

	test("returns undefined for valid JSON missing required fields", () => {
		writeFileSync(`${TEST_DIR}/.clens/_work_units.json`, JSON.stringify({ foo: "bar" }));

		const result = readWorkUnitIndex(TEST_DIR);
		expect(result).toBeUndefined();
	});
});

describe("writeWorkUnitIndex", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("writes valid JSON to correct path", () => {
		const index = makeIndex();
		writeWorkUnitIndex(index, TEST_DIR);

		expect(existsSync(`${TEST_DIR}/.clens/_work_units.json`)).toBe(true);

		const result = readWorkUnitIndex(TEST_DIR);
		expect(result?.version).toBe(1);
	});

	test("creates .clens directory if missing", () => {
		const index = makeIndex();
		writeWorkUnitIndex(index, TEST_DIR);

		expect(existsSync(`${TEST_DIR}/.clens`)).toBe(true);
	});
});

describe("getRelatedSessions", () => {
	beforeEach(() => {
		mkdirSync(`${TEST_DIR}/.clens`, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("returns empty when no index exists", () => {
		const result = getRelatedSessions("some-id", TEST_DIR);
		expect(result).toEqual({});
	});

	test("returns empty for unknown session", () => {
		const index = makeIndex({
			units: [{
				id: "unit-1",
				link_type: "spec",
				spec_path: "specs/plan.md",
				sessions: [{
					session_id: "s1",
					phase: "plan",
					role: "creator",
					start_time: 1000,
					duration_ms: 5000,
				}],
				lifecycle: "ad-hoc",
				total_duration_ms: 5000,
				date_range: { start: 1000, end: 6000 },
			}],
		});
		writeWorkUnitIndex(index, TEST_DIR);

		const result = getRelatedSessions("unknown-id", TEST_DIR);
		expect(result).toEqual({});
	});

	test("finds session in work unit and returns role", () => {
		const index = makeIndex({
			units: [{
				id: "unit-1",
				link_type: "spec",
				spec_path: "specs/plan.md",
				sessions: [
					{
						session_id: "planner",
						phase: "plan",
						role: "creator",
						start_time: 1000,
						duration_ms: 5000,
					},
					{
						session_id: "builder",
						phase: "build",
						role: "consumer",
						start_time: 10000,
						duration_ms: 8000,
					},
				],
				lifecycle: "plan-build",
				total_duration_ms: 13000,
				date_range: { start: 1000, end: 18000 },
			}],
		});
		writeWorkUnitIndex(index, TEST_DIR);

		const result = getRelatedSessions("builder", TEST_DIR);
		expect(result.work_unit).toBeDefined();
		expect(result.work_unit?.id).toBe("unit-1");
		expect(result.role).toBe("consumer");

		const planResult = getRelatedSessions("planner", TEST_DIR);
		expect(planResult.role).toBe("creator");
	});
});

describe("buildSubagentIdSet", () => {
	beforeEach(() => {
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("returns empty set when no links file exists", () => {
		const result = buildSubagentIdSet(TEST_DIR);
		expect(result.size).toBe(0);
	});

	test("returns spawn agent IDs", () => {
		const links = [
			{ t: 1000, type: "spawn", parent_session: "parent-1", agent_id: "agent-a", agent_type: "task" },
			{ t: 2000, type: "spawn", parent_session: "parent-1", agent_id: "agent-b", agent_type: "task" },
			{ t: 3000, type: "msg_send", session_id: "parent-1", from: "parent-1", to: "agent-a", msg_type: "text" },
		];
		const linksContent = links.map((l) => JSON.stringify(l)).join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, linksContent);

		const result = buildSubagentIdSet(TEST_DIR);
		expect(result.size).toBe(2);
		expect(result.has("agent-a")).toBe(true);
		expect(result.has("agent-b")).toBe(true);
	});

	test("ignores non-spawn link events", () => {
		const links = [
			{ t: 1000, type: "stop", parent_session: "parent-1", agent_id: "agent-a" },
			{ t: 2000, type: "team", team_name: "team-1", leader_session: "parent-1" },
		];
		const linksContent = links.map((l) => JSON.stringify(l)).join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, linksContent);

		const result = buildSubagentIdSet(TEST_DIR);
		expect(result.size).toBe(0);
	});
});

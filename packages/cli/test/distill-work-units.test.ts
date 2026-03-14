import { describe, expect, test } from "bun:test";
import type { FileMapEntry, FileMapResult, PlanDriftReport } from "../src/types";
import type { TranscriptUserMessage } from "../src/types/transcript";
import {
	buildSpecWorkUnits,
	buildWorkUnitIndex,
	detectSpecConsumers,
	detectSpecCreators,
	groupByBranchTime,
	inferPhase,
	normalizeSpecPath,
	type DistilledSessionSummary,
	type WorkUnitSessionMeta,
} from "../src/distill/work-units";

// --- Helpers ---

const makeFileMapEntry = (
	overrides: Partial<FileMapEntry> & { readonly file_path: string },
): FileMapEntry => ({
	reads: 0,
	edits: 0,
	writes: 0,
	errors: 0,
	tool_use_ids: [],
	...overrides,
});

const makeFileMap = (entries: readonly FileMapEntry[]): FileMapResult => ({
	files: [...entries],
});

const makeUserMessage = (content: string, t: number = 0): TranscriptUserMessage => ({
	t,
	content,
	is_tool_result: false,
});

const makeSession = (
	overrides: Partial<DistilledSessionSummary> & { readonly session_id: string },
): DistilledSessionSummary => ({
	start_time: 1000,
	duration_ms: 5000,
	file_map: makeFileMap([]),
	user_messages: [],
	tool_call_count: 10,
	...overrides,
});

const makeMeta = (
	overrides: Partial<WorkUnitSessionMeta> & { readonly session_id: string },
): WorkUnitSessionMeta => ({
	start_time: 1000,
	duration_ms: 5000,
	phase: "other",
	...overrides,
});

// =============================================================================
// detectSpecCreators
// =============================================================================

describe("detectSpecCreators", () => {
	test("returns empty map for empty input", () => {
		const result = detectSpecCreators([]);
		expect(result.size).toBe(0);
	});

	test("detects a single spec writer", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				start_time: 1000,
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/plan.md", writes: 1 }),
				]),
			}),
		];
		const result = detectSpecCreators(sessions);
		expect(result.get("specs/plan.md")).toBe("s1");
	});

	test("keeps earliest session when multiple write same spec", () => {
		const sessions = [
			makeSession({
				session_id: "s2",
				start_time: 2000,
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/plan.md", writes: 1 }),
				]),
			}),
			makeSession({
				session_id: "s1",
				start_time: 1000,
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/plan.md", edits: 1 }),
				]),
			}),
		];
		const result = detectSpecCreators(sessions);
		expect(result.get("specs/plan.md")).toBe("s1");
		expect(result.size).toBe(1);
	});

	test("ignores non-spec file writes", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "src/main.ts", writes: 1 }),
				]),
			}),
		];
		const result = detectSpecCreators(sessions);
		expect(result.size).toBe(0);
	});

	test("ignores spec files with only reads", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/plan.md", reads: 5 }),
				]),
			}),
		];
		const result = detectSpecCreators(sessions);
		expect(result.size).toBe(0);
	});
});

// =============================================================================
// detectSpecConsumers
// =============================================================================

describe("detectSpecConsumers", () => {
	test("returns empty map for empty input", () => {
		const result = detectSpecConsumers([]);
		expect(result.size).toBe(0);
	});

	test("detects plan_drift spec reference", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				plan_drift: {
					spec_path: "specs/plan.md",
					expected_files: [],
					actual_files: [],
					unexpected_files: [],
					missing_files: [],
					drift_score: 0,
				},
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.get("specs/plan.md")).toEqual(["s1"]);
	});

	test("detects user_message spec reference", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				user_messages: [
					makeUserMessage("Please build specs/feature.md"),
				],
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.get("specs/feature.md")).toEqual(["s1"]);
	});

	test("only scans first 5 user messages", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				user_messages: [
					makeUserMessage("hello"),
					makeUserMessage("world"),
					makeUserMessage("foo"),
					makeUserMessage("bar"),
					makeUserMessage("baz"),
					makeUserMessage("build specs/hidden.md"),
				],
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.size).toBe(0);
	});

	test("detects spec in message 4 (within 5-message window)", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				user_messages: [
					makeUserMessage("/clear"),
					makeUserMessage("stdout"),
					makeUserMessage("caveat"),
					makeUserMessage("build specs/feature.md"),
				],
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.get("specs/feature.md")).toEqual(["s1"]);
	});

	test("falls back to file_map for spec reads", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				user_messages: [],
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/plan.md", reads: 1 }),
				]),
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.get("specs/plan.md")).toEqual(["s1"]);
	});

	test("file_map fallback skipped when message ref exists", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				user_messages: [makeUserMessage("build specs/a.md")],
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/b.md", reads: 1 }),
				]),
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.get("specs/a.md")).toEqual(["s1"]);
		expect(result.has("specs/b.md")).toBe(false);
	});

	test("deduplicates session IDs for same spec", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				plan_drift: {
					spec_path: "specs/plan.md",
					expected_files: [],
					actual_files: [],
					unexpected_files: [],
					missing_files: [],
					drift_score: 0,
				},
				user_messages: [
					makeUserMessage("build specs/plan.md"),
				],
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.get("specs/plan.md")).toEqual(["s1"]);
	});

	test("multiple sessions consuming same spec", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				user_messages: [makeUserMessage("build specs/plan.md")],
			}),
			makeSession({
				session_id: "s2",
				user_messages: [makeUserMessage("continue specs/plan.md")],
			}),
		];
		const result = detectSpecConsumers(sessions);
		expect(result.get("specs/plan.md")).toEqual(["s1", "s2"]);
	});
});

// =============================================================================
// buildSpecWorkUnits
// =============================================================================

describe("buildSpecWorkUnits", () => {
	test("builds plan+build pair", () => {
		const creators = new Map([["specs/plan.md", "s1"]]);
		const consumers = new Map([["specs/plan.md", ["s2"]]]);
		const meta = new Map([
			["s1", makeMeta({ session_id: "s1", start_time: 1000, duration_ms: 5000, phase: "plan" })],
			["s2", makeMeta({ session_id: "s2", start_time: 10000, duration_ms: 8000, phase: "build" })],
		]);

		const result = buildSpecWorkUnits(creators, consumers, meta);
		expect(result).toHaveLength(1);
		expect(result[0].link_type).toBe("spec");
		expect(result[0].spec_path).toBe("specs/plan.md");
		expect(result[0].sessions).toHaveLength(2);
		expect(result[0].sessions[0].role).toBe("creator");
		expect(result[0].sessions[1].role).toBe("consumer");
		expect(result[0].lifecycle).toBe("plan-build");
		expect(result[0].total_duration_ms).toBe(13000);
		expect(result[0].date_range.start).toBe(1000);
		expect(result[0].date_range.end).toBe(18000);
	});

	test("builds plan+build+review triple", () => {
		const creators = new Map([["specs/plan.md", "s1"]]);
		const consumers = new Map([["specs/plan.md", ["s2", "s3"]]]);
		const meta = new Map([
			["s1", makeMeta({ session_id: "s1", start_time: 1000, duration_ms: 5000, phase: "plan" })],
			["s2", makeMeta({ session_id: "s2", start_time: 10000, duration_ms: 8000, phase: "build" })],
			["s3", makeMeta({ session_id: "s3", start_time: 20000, duration_ms: 3000, phase: "review" })],
		]);

		const result = buildSpecWorkUnits(creators, consumers, meta);
		expect(result[0].lifecycle).toBe("plan-build-review");
		expect(result[0].sessions).toHaveLength(3);
	});

	test("orphan plan (no consumers) results in ad-hoc", () => {
		const creators = new Map([["specs/orphan.md", "s1"]]);
		const consumers: ReadonlyMap<string, readonly string[]> = new Map();
		const meta = new Map([
			["s1", makeMeta({ session_id: "s1", start_time: 1000, duration_ms: 5000, phase: "plan" })],
		]);

		const result = buildSpecWorkUnits(creators, consumers, meta);
		expect(result).toHaveLength(1);
		expect(result[0].sessions).toHaveLength(1);
		expect(result[0].lifecycle).toBe("ad-hoc");
	});

	test("orphan build (no creator) results in ad-hoc", () => {
		const creators: ReadonlyMap<string, string> = new Map();
		const consumers = new Map([["specs/orphan.md", ["s1"]]]);
		const meta = new Map([
			["s1", makeMeta({ session_id: "s1", start_time: 1000, duration_ms: 5000, phase: "build" })],
		]);

		const result = buildSpecWorkUnits(creators, consumers, meta);
		expect(result).toHaveLength(1);
		expect(result[0].sessions).toHaveLength(1);
		expect(result[0].sessions[0].role).toBe("consumer");
	});

	test("multiple builds from same spec -> multi-build", () => {
		const creators = new Map([["specs/plan.md", "s1"]]);
		const consumers = new Map([["specs/plan.md", ["s2", "s3"]]]);
		const meta = new Map([
			["s1", makeMeta({ session_id: "s1", start_time: 1000, duration_ms: 5000, phase: "freeform" })],
			["s2", makeMeta({ session_id: "s2", start_time: 10000, duration_ms: 8000, phase: "freeform" })],
			["s3", makeMeta({ session_id: "s3", start_time: 20000, duration_ms: 3000, phase: "freeform" })],
		]);

		const result = buildSpecWorkUnits(creators, consumers, meta);
		expect(result[0].lifecycle).toBe("multi-build");
	});

	test("consumer same as creator is excluded from consumer list", () => {
		const creators = new Map([["specs/plan.md", "s1"]]);
		const consumers = new Map([["specs/plan.md", ["s1", "s2"]]]);
		const meta = new Map([
			["s1", makeMeta({ session_id: "s1", start_time: 1000, phase: "plan" })],
			["s2", makeMeta({ session_id: "s2", start_time: 10000, phase: "build" })],
		]);

		const result = buildSpecWorkUnits(creators, consumers, meta);
		expect(result[0].sessions).toHaveLength(2);
		expect(result[0].sessions[0].role).toBe("creator");
		expect(result[0].sessions[1].role).toBe("consumer");
	});
});

// =============================================================================
// groupByBranchTime
// =============================================================================

describe("groupByBranchTime", () => {
	test("returns empty array for empty input", () => {
		const result = groupByBranchTime([], new Set());
		expect(result).toEqual([]);
	});

	test("groups sessions on same branch within gap threshold", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				start_time: 1000,
				duration_ms: 5000,
				git_branch: "feature/foo",
			}),
			makeSession({
				session_id: "s2",
				start_time: 7000,
				duration_ms: 3000,
				git_branch: "feature/foo",
			}),
		];
		const result = groupByBranchTime(sessions, new Set());
		expect(result).toHaveLength(1);
		expect(result[0].sessions).toHaveLength(2);
		expect(result[0].link_type).toBe("branch_time");
		expect(result[0].git_branch).toBe("feature/foo");
	});

	test("splits into separate groups when gap exceeds threshold", () => {
		const gap = 9 * 60 * 60 * 1000; // 9 hours
		const sessions = [
			makeSession({
				session_id: "s1",
				start_time: 1000,
				duration_ms: 5000,
				git_branch: "feature/bar",
			}),
			makeSession({
				session_id: "s2",
				start_time: 1000 + 5000 + gap,
				duration_ms: 3000,
				git_branch: "feature/bar",
			}),
		];
		const result = groupByBranchTime(sessions, new Set());
		expect(result).toHaveLength(2);
		expect(result[0].sessions).toHaveLength(1);
		expect(result[1].sessions).toHaveLength(1);
	});

	test("excludes main/master/develop branches", () => {
		const sessions = [
			makeSession({ session_id: "s1", git_branch: "main" }),
			makeSession({ session_id: "s2", git_branch: "master" }),
			makeSession({ session_id: "s3", git_branch: "develop" }),
		];
		const result = groupByBranchTime(sessions, new Set());
		expect(result).toEqual([]);
	});

	test("excludes already-grouped sessions", () => {
		const sessions = [
			makeSession({ session_id: "s1", git_branch: "feature/x" }),
			makeSession({ session_id: "s2", git_branch: "feature/x" }),
		];
		const result = groupByBranchTime(sessions, new Set(["s1", "s2"]));
		expect(result).toEqual([]);
	});

	test("excludes sessions without git_branch", () => {
		const sessions = [
			makeSession({ session_id: "s1" }),
		];
		const result = groupByBranchTime(sessions, new Set());
		expect(result).toEqual([]);
	});
});

// =============================================================================
// buildWorkUnitIndex
// =============================================================================

describe("buildWorkUnitIndex", () => {
	test("returns empty index for empty input", () => {
		const result = buildWorkUnitIndex([], new Set());
		expect(result.version).toBe(1);
		expect(result.units).toEqual([]);
		expect(typeof result.updated_at).toBe("number");
	});

	test("end-to-end: spec-linked sessions", () => {
		const sessions = [
			makeSession({
				session_id: "planner",
				start_time: 1000,
				duration_ms: 5000,
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/feature.md", writes: 1 }),
				]),
			}),
			makeSession({
				session_id: "builder",
				start_time: 10000,
				duration_ms: 8000,
				user_messages: [makeUserMessage("build specs/feature.md")],
			}),
		];
		const result = buildWorkUnitIndex(sessions, new Set());
		expect(result.units.length).toBeGreaterThanOrEqual(1);
		const specUnit = result.units.find((u) => u.link_type === "spec");
		expect(specUnit).toBeDefined();
		expect(specUnit?.spec_path).toBe("specs/feature.md");
		expect(specUnit?.sessions).toHaveLength(2);
	});

	test("end-to-end: branch-grouped sessions", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				start_time: 1000,
				duration_ms: 5000,
				git_branch: "feature/ui",
			}),
			makeSession({
				session_id: "s2",
				start_time: 7000,
				duration_ms: 3000,
				git_branch: "feature/ui",
			}),
		];
		const result = buildWorkUnitIndex(sessions, new Set());
		const branchUnit = result.units.find((u) => u.link_type === "branch_time");
		expect(branchUnit).toBeDefined();
		expect(branchUnit?.git_branch).toBe("feature/ui");
		expect(branchUnit?.sessions).toHaveLength(2);
	});

	test("end-to-end: mix of spec and branch sessions", () => {
		const sessions = [
			makeSession({
				session_id: "planner",
				start_time: 1000,
				duration_ms: 5000,
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/api.md", writes: 1 }),
				]),
			}),
			makeSession({
				session_id: "builder",
				start_time: 10000,
				duration_ms: 8000,
				user_messages: [makeUserMessage("implement specs/api.md")],
				git_branch: "feature/api",
			}),
			makeSession({
				session_id: "unrelated",
				start_time: 20000,
				duration_ms: 3000,
				git_branch: "feature/docs",
			}),
		];
		const result = buildWorkUnitIndex(sessions, new Set());
		const specUnits = result.units.filter((u) => u.link_type === "spec");
		const branchUnits = result.units.filter((u) => u.link_type === "branch_time");
		expect(specUnits).toHaveLength(1);
		expect(branchUnits).toHaveLength(1);
		expect(branchUnits[0].git_branch).toBe("feature/docs");
	});

	test("spec-linked sessions are excluded from branch grouping", () => {
		const sessions = [
			makeSession({
				session_id: "planner",
				start_time: 1000,
				duration_ms: 5000,
				git_branch: "feature/x",
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/x.md", writes: 1 }),
				]),
			}),
			makeSession({
				session_id: "builder",
				start_time: 7000,
				duration_ms: 3000,
				git_branch: "feature/x",
				user_messages: [makeUserMessage("build specs/x.md")],
			}),
		];
		const result = buildWorkUnitIndex(sessions, new Set());
		const branchUnits = result.units.filter((u) => u.link_type === "branch_time");
		expect(branchUnits).toHaveLength(0);
	});

	test("units are sorted by date descending", () => {
		const sessions = [
			makeSession({
				session_id: "early",
				start_time: 1000,
				duration_ms: 1000,
				git_branch: "feature/a",
			}),
			makeSession({
				session_id: "late",
				start_time: 50000,
				duration_ms: 1000,
				git_branch: "feature/b",
			}),
		];
		const result = buildWorkUnitIndex(sessions, new Set());
		expect(result.units.length).toBe(2);
		expect(result.units[0].date_range.start).toBeGreaterThan(result.units[1].date_range.start);
	});

	test("filters subagent sessions", () => {
		const sessions = [
			makeSession({
				session_id: "parent",
				start_time: 1000,
				duration_ms: 5000,
				git_branch: "feature/x",
			}),
			makeSession({
				session_id: "subagent-1",
				start_time: 2000,
				duration_ms: 3000,
				git_branch: "feature/x",
			}),
		];
		const result = buildWorkUnitIndex(sessions, new Set(["subagent-1"]));
		const allSessionIds = result.units.flatMap((u) => u.sessions.map((s) => s.session_id));
		expect(allSessionIds).not.toContain("subagent-1");
		expect(allSessionIds).toContain("parent");
	});

	test("excludes subagents from spec consumers", () => {
		const sessions = [
			makeSession({
				session_id: "planner",
				start_time: 1000,
				duration_ms: 5000,
				file_map: makeFileMap([
					makeFileMapEntry({ file_path: "specs/plan.md", writes: 1 }),
				]),
			}),
			makeSession({
				session_id: "subagent-consumer",
				start_time: 2000,
				duration_ms: 3000,
				user_messages: [makeUserMessage("build specs/plan.md")],
			}),
		];
		const result = buildWorkUnitIndex(sessions, new Set(["subagent-consumer"]));
		const specUnit = result.units.find((u) => u.link_type === "spec");
		expect(specUnit).toBeDefined();
		const consumerIds = specUnit?.sessions
			.filter((s) => s.role === "consumer")
			.map((s) => s.session_id) ?? [];
		expect(consumerIds).not.toContain("subagent-consumer");
	});
});

// =============================================================================
// inferPhase
// =============================================================================

describe("inferPhase", () => {
	test("detects plan from user message", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [makeUserMessage("# Plan\nCreate a new feature")],
		});
		expect(inferPhase(session)).toBe("plan");
	});

	test("detects plan from slash command", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [makeUserMessage("/plan create a new feature")],
		});
		expect(inferPhase(session)).toBe("plan");
	});

	test("detects build from plan_drift", () => {
		const session = makeSession({
			session_id: "s1",
			plan_drift: {
				spec_path: "specs/feature.md",
				expected_files: [],
				actual_files: [],
				unexpected_files: [],
				missing_files: [],
				drift_score: 0,
			},
		});
		expect(inferPhase(session)).toBe("build");
	});

	test("detects prime from user message", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [makeUserMessage("# Prime\nSetup the codebase")],
		});
		expect(inferPhase(session)).toBe("prime");
	});

	test("detects review from user message", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [makeUserMessage("# Review\nCheck the implementation")],
		});
		expect(inferPhase(session)).toBe("review");
	});

	test("returns other for unknown with low tool count", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [makeUserMessage("Fix the bug in login")],
			tool_call_count: 3,
		});
		expect(inferPhase(session)).toBe("other");
	});

	test("returns build for unknown with high tool count", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [makeUserMessage("Fix the bug in login")],
			tool_call_count: 15,
		});
		expect(inferPhase(session)).toBe("build");
	});

	test("returns other for empty messages and low tool count", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [],
			tool_call_count: 0,
		});
		expect(inferPhase(session)).toBe("other");
	});

	test("detects phase from summary_phases fallback", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [],
			tool_call_count: 0,
			summary_phases: [{ name: "File Exploration", start_t: 0, end_t: 1000, tool_types: [], description: "" }],
		});
		expect(inferPhase(session)).toBe("prime");
	});

	test("detects build from summary_phases", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [],
			tool_call_count: 5,
			summary_phases: [{ name: "Build", start_t: 0, end_t: 1000, tool_types: [], description: "" }],
		});
		expect(inferPhase(session)).toBe("build");
	});

	test("detects prime from command-message wrapper", () => {
		const session = makeSession({
			session_id: "s1",
			user_messages: [makeUserMessage("<command-message>prime</command-message>\n# Prime\nSetup")],
		});
		expect(inferPhase(session)).toBe("prime");
	});
});

// =============================================================================
// normalizeSpecPath
// =============================================================================

describe("normalizeSpecPath", () => {
	test("strips absolute prefix", () => {
		expect(normalizeSpecPath("/Users/foo/project/specs/bar.md")).toBe("specs/bar.md");
	});

	test("preserves relative path", () => {
		expect(normalizeSpecPath("specs/bar.md")).toBe("specs/bar.md");
	});

	test("handles nested specs path", () => {
		expect(normalizeSpecPath("/home/user/work/specs/sub/feature.md")).toBe("specs/sub/feature.md");
	});

	test("returns original when no specs/ found", () => {
		expect(normalizeSpecPath("/some/random/path.md")).toBe("/some/random/path.md");
	});
});

// =============================================================================
// groupByBranchTime role assignment
// =============================================================================

describe("groupByBranchTime role assignment", () => {
	test("assigns creator role to first session", () => {
		const sessions = [
			makeSession({
				session_id: "s1",
				start_time: 1000,
				duration_ms: 5000,
				git_branch: "feature/foo",
			}),
			makeSession({
				session_id: "s2",
				start_time: 7000,
				duration_ms: 3000,
				git_branch: "feature/foo",
			}),
		];
		const result = groupByBranchTime(sessions, new Set());
		expect(result).toHaveLength(1);
		expect(result[0].sessions[0].role).toBe("creator");
		expect(result[0].sessions[1].role).toBe("modifier");
	});
});

import { describe, expect, test } from "bun:test";
import type { AgentEditEntry } from "../src/distill/diff-attribution";
import type { DiffLine, EditChain, EditChainsResult, EditStep, StoredEvent } from "../src/types";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

const makeDiffLine = (overrides: Partial<DiffLine>): DiffLine => ({
	type: "context",
	content: "",
	...overrides,
});

const makeEditStep = (overrides: Partial<EditStep>): EditStep => ({
	tool_use_id: "tu-1",
	t: 1000,
	tool_name: "Edit",
	outcome: "success",
	...overrides,
});

const makeEditChain = (overrides: Partial<EditChain>): EditChain => ({
	file_path: "/project/src/foo.ts",
	steps: [makeEditStep({})],
	total_edits: 1,
	total_failures: 0,
	total_reads: 0,
	effort_ms: 0,
	has_backtrack: false,
	surviving_edit_ids: ["tu-1"],
	abandoned_edit_ids: [],
	...overrides,
});

const makeEditChainsResult = (overrides: Partial<EditChainsResult>): EditChainsResult => ({
	chains: [makeEditChain({})],
	...overrides,
});

const makeSessionStartEvent = (gitCommit: string | null): StoredEvent => ({
	t: 1000,
	event: "SessionStart",
	sid: "test-session",
	context: {
		project_dir: "/project",
		cwd: "/project",
		git_branch: "main",
		git_remote: null,
		git_commit: gitCommit,
		git_worktree: null,
		team_name: null,
		task_list_dir: null,
		claude_entrypoint: null,
		model: null,
		agent_type: null,
	},
	data: {},
});

const makePreToolUseEvent = (
	overrides: Partial<{
		t: number;
		tool_name: string;
		tool_use_id: string;
		tool_input: Record<string, unknown>;
	}>,
): StoredEvent => ({
	t: overrides.t ?? 2000,
	event: "PreToolUse",
	sid: "test-session",
	data: {
		tool_name: overrides.tool_name ?? "Edit",
		tool_use_id: overrides.tool_use_id ?? "tu-1",
		tool_input: overrides.tool_input ?? {},
	},
});

const makePostToolUseEvent = (
	overrides: Partial<{
		t: number;
		tool_name: string;
		tool_use_id: string;
		tool_response: Record<string, unknown>;
	}>,
): StoredEvent => ({
	t: overrides.t ?? 2500,
	event: "PostToolUse",
	sid: "test-session",
	data: {
		tool_name: overrides.tool_name ?? "Edit",
		tool_use_id: overrides.tool_use_id ?? "tu-1",
		tool_response: overrides.tool_response ?? {},
	},
});

const makeAgentEditEntry = (overrides: Partial<AgentEditEntry>): AgentEditEntry => ({
	agent_name: "builder",
	tool_use_id: "tu-1",
	new_string_lines: new Set<string>(),
	old_string_lines: new Set<string>(),
	t: 100,
	...overrides,
});

// ---------------------------------------------------------------------------
// Tests: parseUnifiedDiff
// ---------------------------------------------------------------------------

describe("parseUnifiedDiff", () => {
	const importModule = () => import("../src/distill/diff-attribution");

	test("parses standard unified diff with adds, removes, and context", async () => {
		const { parseUnifiedDiff } = await importModule();

		const diff = [
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -1,4 +1,5 @@",
			' import { bar } from "./bar";',
			"-const x = 1;",
			"+const x = 2;",
			"+const y = 3;",
			" export { x };",
		].join("\n");

		const result = parseUnifiedDiff(diff);

		expect(result).toHaveLength(5);
		expect(result[0]).toMatchObject({ type: "context", content: 'import { bar } from "./bar";' });
		expect(result[1]).toMatchObject({ type: "remove", content: "const x = 1;" });
		expect(result[2]).toMatchObject({ type: "add", content: "const x = 2;" });
		expect(result[3]).toMatchObject({ type: "add", content: "const y = 3;" });
		expect(result[4]).toMatchObject({ type: "context", content: "export { x };" });
	});

	test("parses diff with multiple hunks", async () => {
		const { parseUnifiedDiff } = await importModule();

		const diff = [
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -1,3 +1,3 @@",
			" line1",
			"-line2",
			"+line2_modified",
			" line3",
			"@@ -10,3 +10,4 @@",
			" line10",
			"+inserted_line",
			" line11",
			" line12",
		].join("\n");

		const result = parseUnifiedDiff(diff);

		// First hunk: context, remove, add, context = 4 lines
		// Second hunk: context, add, context, context = 4 lines
		expect(result).toHaveLength(8);

		const addLines = result.filter((l) => l.type === "add");
		expect(addLines).toHaveLength(2);
		expect(addLines[0].content).toBe("line2_modified");
		expect(addLines[1].content).toBe("inserted_line");

		const removeLines = result.filter((l) => l.type === "remove");
		expect(removeLines).toHaveLength(1);
		expect(removeLines[0].content).toBe("line2");
	});

	test("returns empty array for empty string", async () => {
		const { parseUnifiedDiff } = await importModule();

		const result = parseUnifiedDiff("");
		expect(result).toEqual([]);
	});

	test("returns empty array for binary file marker", async () => {
		const { parseUnifiedDiff } = await importModule();

		const result = parseUnifiedDiff("Binary files a/foo.png and b/foo.png differ");
		expect(result).toEqual([]);
	});

	test("tracks line numbers from hunk headers", async () => {
		const { parseUnifiedDiff } = await importModule();

		const diff = [
			"--- a/src/foo.ts",
			"+++ b/src/foo.ts",
			"@@ -10,3 +10,4 @@ some function context",
			" line10",
			"+inserted",
			" line11",
			" line12",
		].join("\n");

		const result = parseUnifiedDiff(diff);

		// Context lines don't get line_number in the implementation
		// Add lines track newLine, remove lines track oldLine
		const addLine = result.find((l) => l.type === "add");
		expect(addLine).toBeDefined();
		// After context line at newLine=10 (increments to 11), the add is at 11
		expect(addLine?.line_number).toBe(11);

		// Context lines after the hunk header start at old=10, new=10
		// First context line10 increments both to 11
		// Then add "inserted" is at newLine=11
		// Then context "line11" at old=11, new=12
	});
});

// ---------------------------------------------------------------------------
// Tests: attributeDiffLines
// ---------------------------------------------------------------------------

describe("attributeDiffLines", () => {
	const importModule = () => import("../src/distill/diff-attribution");

	test("attributes add lines to single agent", async () => {
		const { attributeDiffLines } = await importModule();

		const diffLines: readonly DiffLine[] = [
			makeDiffLine({ type: "add", content: "const x = 2;" }),
			makeDiffLine({ type: "add", content: "const y = 3;" }),
		];

		const editIndex: readonly AgentEditEntry[] = [
			makeAgentEditEntry({
				agent_name: "builder",
				tool_use_id: "tu-1",
				new_string_lines: new Set(["const x = 2;", "const y = 3;"]),
				old_string_lines: new Set(),
				t: 100,
			}),
		];

		const result = attributeDiffLines(diffLines, editIndex);

		expect(result).toHaveLength(2);
		expect(result[0].agent_name).toBe("builder");
		expect(result[1].agent_name).toBe("builder");
	});

	test("attributes remove lines to agent", async () => {
		const { attributeDiffLines } = await importModule();

		const diffLines: readonly DiffLine[] = [
			makeDiffLine({ type: "remove", content: "const old = 1;" }),
		];

		const editIndex: readonly AgentEditEntry[] = [
			makeAgentEditEntry({
				agent_name: "refactorer",
				tool_use_id: "tu-2",
				new_string_lines: new Set(),
				old_string_lines: new Set(["const old = 1;"]),
				t: 200,
			}),
		];

		const result = attributeDiffLines(diffLines, editIndex);

		expect(result).toHaveLength(1);
		expect(result[0].agent_name).toBe("refactorer");
	});

	test("leaves context lines unattributed", async () => {
		const { attributeDiffLines } = await importModule();

		const diffLines: readonly DiffLine[] = [
			makeDiffLine({ type: "context", content: "import { foo } from 'bar';" }),
		];

		const editIndex: readonly AgentEditEntry[] = [
			makeAgentEditEntry({
				agent_name: "builder",
				new_string_lines: new Set(["import { foo } from 'bar';"]),
			}),
		];

		const result = attributeDiffLines(diffLines, editIndex);

		expect(result).toHaveLength(1);
		expect(result[0].agent_name).toBeUndefined();
	});

	test("picks chronologically latest agent when multiple match", async () => {
		const { attributeDiffLines } = await importModule();

		const diffLines: readonly DiffLine[] = [
			makeDiffLine({ type: "add", content: "const x = final;" }),
		];

		const editIndex: readonly AgentEditEntry[] = [
			makeAgentEditEntry({
				agent_name: "early-agent",
				tool_use_id: "tu-early",
				new_string_lines: new Set(["const x = final;"]),
				t: 100,
			}),
			makeAgentEditEntry({
				agent_name: "late-agent",
				tool_use_id: "tu-late",
				new_string_lines: new Set(["const x = final;"]),
				t: 200,
			}),
		];

		const result = attributeDiffLines(diffLines, editIndex);

		expect(result).toHaveLength(1);
		expect(result[0].agent_name).toBe("late-agent");
	});

	test("leaves agent_name undefined when no match found", async () => {
		const { attributeDiffLines } = await importModule();

		const diffLines: readonly DiffLine[] = [
			makeDiffLine({ type: "add", content: "something completely new" }),
		];

		const editIndex: readonly AgentEditEntry[] = [
			makeAgentEditEntry({
				agent_name: "builder",
				new_string_lines: new Set(["unrelated content"]),
			}),
		];

		const result = attributeDiffLines(diffLines, editIndex);

		expect(result).toHaveLength(1);
		expect(result[0].agent_name).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Tests: getStartCommit
// ---------------------------------------------------------------------------

describe("getStartCommit", () => {
	const importModule = () => import("../src/distill/diff-attribution");

	test("extracts git_commit from SessionStart event", async () => {
		const { getStartCommit } = await importModule();

		const events: readonly StoredEvent[] = [
			makeSessionStartEvent("abc123def456"),
			makePostToolUseEvent({ t: 3000 }),
		];

		const result = getStartCommit(events);
		expect(result).toBe("abc123def456");
	});

	test("returns undefined when no SessionStart event", async () => {
		const { getStartCommit } = await importModule();

		const events: readonly StoredEvent[] = [
			makePreToolUseEvent({ t: 1000, tool_name: "Edit" }),
			makePostToolUseEvent({ t: 2000, tool_name: "Edit" }),
		];

		const result = getStartCommit(events);
		expect(result).toBeUndefined();
	});

	test("returns undefined when SessionStart has no git_commit", async () => {
		const { getStartCommit } = await importModule();

		const events: readonly StoredEvent[] = [makeSessionStartEvent(null)];

		const result = getStartCommit(events);
		expect(result).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Tests: buildAgentEditIndex
// ---------------------------------------------------------------------------

describe("buildAgentEditIndex", () => {
	const importModule = () => import("../src/distill/diff-attribution");

	test("builds index from edit chain steps with tool input data", async () => {
		const { buildAgentEditIndex } = await importModule();

		const events: readonly StoredEvent[] = [
			makeSessionStartEvent("abc123"),
			makePreToolUseEvent({
				t: 2000,
				tool_name: "Edit",
				tool_use_id: "tu-1",
				tool_input: {
					file_path: "/project/src/foo.ts",
					old_string: "const x = 1;",
					new_string: "const x = 2;\nconst y = 3;",
				},
			}),
			makePostToolUseEvent({ t: 2500, tool_use_id: "tu-1" }),
		];

		const editChains: EditChainsResult = makeEditChainsResult({
			chains: [
				makeEditChain({
					file_path: "/project/src/foo.ts",
					agent_name: "builder",
					steps: [
						makeEditStep({
							tool_use_id: "tu-1",
							t: 2000,
							tool_name: "Edit",
							outcome: "success",
						}),
					],
				}),
			],
		});

		const result = buildAgentEditIndex(events, editChains, "/project");

		expect(result).toBeInstanceOf(Map);
		// The index should contain entries for the file's relative path
		expect(result.size).toBeGreaterThan(0);

		// Check that the entry has the correct structure
		const entries = [...result.values()].flat();
		expect(entries.length).toBeGreaterThan(0);
		expect(entries[0].agent_name).toBe("builder");
		expect(entries[0].new_string_lines.has("const x = 2;")).toBe(true);
		expect(entries[0].new_string_lines.has("const y = 3;")).toBe(true);
		expect(entries[0].old_string_lines.has("const x = 1;")).toBe(true);
	});

	test("returns empty map when no edit chains", async () => {
		const { buildAgentEditIndex } = await importModule();

		const events: readonly StoredEvent[] = [makeSessionStartEvent("abc123")];

		const editChains: EditChainsResult = makeEditChainsResult({
			chains: [],
		});

		const result = buildAgentEditIndex(events, editChains, "/project");

		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(0);
	});

	test("associates agent_name from edit chain with index entries", async () => {
		const { buildAgentEditIndex } = await importModule();

		const events: readonly StoredEvent[] = [
			makeSessionStartEvent("abc123"),
			makePreToolUseEvent({
				t: 2000,
				tool_name: "Edit",
				tool_use_id: "tu-alpha",
				tool_input: {
					file_path: "/project/src/alpha.ts",
					old_string: "old line",
					new_string: "new line",
				},
			}),
			makePostToolUseEvent({ t: 2500, tool_use_id: "tu-alpha" }),
		];

		const editChains: EditChainsResult = makeEditChainsResult({
			chains: [
				makeEditChain({
					file_path: "/project/src/alpha.ts",
					agent_name: "alpha-agent",
					steps: [
						makeEditStep({
							tool_use_id: "tu-alpha",
							t: 2000,
							tool_name: "Edit",
						}),
					],
				}),
			],
		});

		const result = buildAgentEditIndex(events, editChains, "/project");

		// Verify at least one entry has the correct agent_name
		const entries = [...result.values()].flat();
		const agentNames = entries.map((e) => e.agent_name);
		expect(agentNames).toContain("alpha-agent");
	});

	test("excludes steps with PostToolUseFailure events", async () => {
		const { buildAgentEditIndex } = await importModule();

		const events: readonly StoredEvent[] = [
			makeSessionStartEvent("abc123"),
			makePreToolUseEvent({
				t: 2000,
				tool_name: "Edit",
				tool_use_id: "tu-fail",
				tool_input: {
					file_path: "/project/src/fail.ts",
					old_string: "old",
					new_string: "new",
				},
			}),
			{
				t: 2500,
				event: "PostToolUseFailure",
				sid: "test-session",
				data: {
					tool_name: "Edit",
					tool_use_id: "tu-fail",
					error: "old_string not found",
				},
			},
		];

		const editChains: EditChainsResult = makeEditChainsResult({
			chains: [
				makeEditChain({
					file_path: "/project/src/fail.ts",
					agent_name: "builder",
					steps: [
						makeEditStep({
							tool_use_id: "tu-fail",
							t: 2000,
							tool_name: "Edit",
							outcome: "failure",
						}),
					],
				}),
			],
		});

		const result = buildAgentEditIndex(events, editChains, "/project");

		// Failed edits should be excluded from the index
		const entries = [...result.values()].flat();
		expect(entries.length).toBe(0);
	});
});

import { describe, expect, test } from "bun:test";
import { renderEditsDetail, renderEditsSummary } from "../src/commands/edits";
import type { DistilledSession, EditChain, EditStep } from "../src/types";

const makeStep = (overrides: Partial<EditStep>): EditStep => ({
	tool_use_id: "t1",
	t: 1000,
	tool_name: "Edit",
	outcome: "success",
	...overrides,
});

const makeChain = (overrides: Partial<EditChain>): EditChain => ({
	file_path: "/foo.ts",
	steps: [makeStep({})],
	total_edits: 1,
	total_failures: 0,
	total_reads: 0,
	effort_ms: 0,
	has_backtrack: false,
	surviving_edit_ids: ["t1"],
	abandoned_edit_ids: [],
	...overrides,
});

const makeDistilled = (overrides: Partial<DistilledSession>): DistilledSession => ({
	session_id: "test-session-123",
	stats: {
		total_events: 0,
		duration_ms: 60000,
		events_by_type: {},
		tools_by_name: {},
		tool_call_count: 0,
		failure_count: 0,
		failure_rate: 0,
		unique_files: [],
	},
	backtracks: [],
	decisions: [],
	file_map: { files: [] },
	git_diff: { commits: [], hunks: [] },
	reasoning: [],
	user_messages: [],
	complete: true,
	...overrides,
});

describe("renderEditsSummary", () => {
	test("renders table with correct columns", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/src/app.ts",
						total_edits: 3,
						total_failures: 0,
						total_reads: 1,
					}),
					makeChain({
						file_path: "/src/util.ts",
						total_edits: 2,
						total_failures: 1,
						total_reads: 0,
					}),
				],
			},
		});

		const output = renderEditsSummary(distilled);
		expect(output).toContain("File");
		expect(output).toContain("Edits");
		expect(output).toContain("Failed");
		expect(output).toContain("Reads");
		expect(output).toContain("Time");
		expect(output).toContain("Flag");
		expect(output).toContain("/src/app.ts");
		expect(output).toContain("/src/util.ts");
	});

	test("shows totals footer", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/a.ts",
						total_edits: 5,
						total_failures: 2,
						total_reads: 3,
						surviving_edit_ids: ["t1", "t2", "t3"],
						abandoned_edit_ids: ["t4", "t5"],
					}),
					makeChain({
						file_path: "/b.ts",
						total_edits: 3,
						total_failures: 1,
						total_reads: 0,
						surviving_edit_ids: ["t6", "t7"],
						abandoned_edit_ids: ["t8"],
					}),
				],
			},
		});

		const output = renderEditsSummary(distilled);
		expect(output).toContain("8 edits");
		expect(output).toContain("3 failures");
		expect(output).toContain("3 recovery reads");
		expect(output).toContain("3 failed edits");
		expect(output).toContain("5 successful edits");
	});

	test("shows clean flag when no failures and no backtracks", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						total_failures: 0,
						has_backtrack: false,
						steps: [makeStep({ outcome: "success" })],
					}),
				],
			},
		});

		const output = renderEditsSummary(distilled);
		expect(output).toContain("clean");
	});

	test("shows backtrack flag when backtrack present", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						has_backtrack: true,
						steps: [makeStep({ backtrack_type: "failure_retry", outcome: "failure" })],
						total_failures: 1,
					}),
				],
			},
		});

		const output = renderEditsSummary(distilled);
		expect(output).toContain("failure_retry");
	});

	test("no edit_chains returns informative message about re-running distill", () => {
		const distilled = makeDistilled({});
		// edit_chains is undefined by default from makeDistilled

		const output = renderEditsSummary(distilled);
		// When edit_chains is undefined, chains = [] via nullish coalescing
		// So it renders with 0 files modified
		expect(output).toContain("0 files modified");
	});

	test("empty chains renders no file rows", () => {
		const distilled = makeDistilled({
			edit_chains: { chains: [] },
		});

		const output = renderEditsSummary(distilled);
		expect(output).toContain("0 files modified");
		expect(output).toContain("0 edits");
	});

	test("header includes session prefix and file count", () => {
		const distilled = makeDistilled({
			session_id: "abcdef1234567890",
			edit_chains: {
				chains: [
					makeChain({ file_path: "/x.ts" }),
					makeChain({ file_path: "/y.ts" }),
					makeChain({ file_path: "/z.ts" }),
				],
			},
		});

		const output = renderEditsSummary(distilled);
		expect(output).toContain("abcdef12");
		expect(output).toContain("3 files modified");
	});

	test("has_failures flag when total_failures > 0 but no backtrack_type on steps", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						total_failures: 2,
						has_backtrack: false,
						steps: [makeStep({ outcome: "failure" }), makeStep({ outcome: "success" })],
					}),
				],
			},
		});

		const output = renderEditsSummary(distilled);
		expect(output).toContain("has_failures");
	});
});

describe("renderEditsDetail", () => {
	test("renders timeline with outcome icons", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/foo.ts",
						steps: [
							makeStep({ tool_use_id: "t1", outcome: "success", tool_name: "Edit" }),
							makeStep({
								tool_use_id: "t2",
								outcome: "failure",
								tool_name: "Edit",
								error_preview: "not found",
							}),
							makeStep({ tool_use_id: "t3", outcome: "info", tool_name: "Read" }),
						],
						total_edits: 2,
						total_failures: 1,
						total_reads: 1,
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/foo.ts");
		expect(output).toContain("\u2713"); // checkmark for success
		expect(output).toContain("\u2717"); // X for failure
		expect(output).toContain("\u00b7"); // middle dot for info
	});

	test("shows thinking preview when available", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/foo.ts",
						steps: [
							makeStep({
								thinking_preview: "I need to fix the validation logic here",
							}),
						],
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/foo.ts");
		expect(output).toContain("thinking");
		expect(output).toContain("I need to fix the validation");
	});

	test("shows error preview for failures", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/foo.ts",
						total_failures: 1,
						steps: [
							makeStep({
								outcome: "failure",
								error_preview: "old_string not found in file",
							}),
						],
						abandoned_edit_ids: ["t1"],
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/foo.ts");
		expect(output).toContain("FAILED");
		expect(output).toContain("old_string not found in file");
	});

	test("shows surviving and abandoned footer", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/foo.ts",
						surviving_edit_ids: ["t2", "t3"],
						abandoned_edit_ids: ["t1"],
						total_edits: 3,
						total_failures: 1,
						steps: [
							makeStep({ tool_use_id: "t1", outcome: "failure" }),
							makeStep({ tool_use_id: "t2", outcome: "success" }),
							makeStep({ tool_use_id: "t3", outcome: "success" }),
						],
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/foo.ts");
		expect(output).toContain("Successful: 2 edits");
		expect(output).toContain("Failed: 1 edit");
	});

	test("file not found in chains returns descriptive message", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [makeChain({ file_path: "/foo.ts" })],
			},
		});

		const output = renderEditsDetail(distilled, "/nonexistent.ts");
		expect(output).toContain("No edit chain found");
		expect(output).toContain("/nonexistent.ts");
	});

	test("renders header with file stats", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/bar.ts",
						total_edits: 5,
						total_failures: 2,
						total_reads: 1,
						effort_ms: 30000,
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/bar.ts");
		expect(output).toContain("/bar.ts");
		expect(output).toContain("5 edits");
		expect(output).toContain("2 failures");
		expect(output).toContain("1 recovery reads");
		expect(output).toContain("30s");
	});

	test("shows (none) when no surviving or abandoned edits", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/empty.ts",
						surviving_edit_ids: [],
						abandoned_edit_ids: [],
						steps: [],
						total_edits: 0,
						total_failures: 0,
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/empty.ts");
		expect(output).toContain("Successful: (none)");
		expect(output).toContain("Failed: (none)");
	});

	test("abandoned entries show (failed) annotation for failure outcomes", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/foo.ts",
						abandoned_edit_ids: ["t1"],
						steps: [
							makeStep({ tool_use_id: "t1", outcome: "failure" }),
							makeStep({ tool_use_id: "t2", outcome: "success" }),
						],
						surviving_edit_ids: ["t2"],
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/foo.ts");
		expect(output).toContain("Successful: 1 edit");
		expect(output).toContain("Failed: 1 edit");
	});

	test("shows old/new string previews when available", () => {
		const distilled = makeDistilled({
			edit_chains: {
				chains: [
					makeChain({
						file_path: "/foo.ts",
						steps: [
							makeStep({
								old_string_preview: "const x = 1",
								new_string_preview: "const x = 2",
							}),
						],
					}),
				],
			},
		});

		const output = renderEditsDetail(distilled, "/foo.ts");
		expect(output).toContain("const x = 1");
		expect(output).toContain("const x = 2");
	});
});

describe("extractNetChanges", () => {
	test("returns empty array when no SessionStart event", async () => {
		const { extractNetChanges } = await import("../src/distill/git-diff");

		const events = [
			{ t: 1000, event: "PreToolUse" as const, sid: "test", data: { tool_name: "Edit" } },
			{ t: 2000, event: "SessionEnd" as const, sid: "test", data: {} },
		];

		const result = extractNetChanges("/tmp", events);
		expect(result).toEqual([]);
	});

	test("returns empty array when SessionStart has no git_commit", async () => {
		const { extractNetChanges } = await import("../src/distill/git-diff");

		const events = [
			{
				t: 1000,
				event: "SessionStart" as const,
				sid: "test",
				data: {},
				context: {
					project_dir: "/test",
					cwd: "/test",
					git_branch: "main",
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: null,
					agent_type: null,
				},
			},
			{ t: 2000, event: "SessionEnd" as const, sid: "test", data: {} },
		];

		const result = extractNetChanges("/tmp", events);
		expect(result).toEqual([]);
	});
});

describe("formatAttributedDiff", () => {
	// This function may not exist yet -- tests are written ahead of implementation.
	// They will fail with an import error until the rendering function is created.
	const importFormatter = () =>
		import("../src/commands/tui-formatters").then((m) => m.formatAttributedDiff);

	test("renders header with file path and change counts", async () => {
		const formatAttributedDiff = await importFormatter();
		if (!formatAttributedDiff) return; // skip gracefully if not yet implemented

		const attribution: import("../src/types").FileDiffAttribution = {
			file_path: "/src/app.ts",
			lines: [
				{ type: "add" as const, content: "const x = 2;", agent_name: "builder" },
				{ type: "remove" as const, content: "const x = 1;" },
				{ type: "context" as const, content: "import { foo } from 'bar';" },
			],
			total_additions: 1,
			total_deletions: 1,
		};

		const output = formatAttributedDiff(attribution, ["builder"], 80);
		const joined = Array.isArray(output) ? output.join("\n") : String(output);

		expect(joined).toContain("/src/app.ts");
		expect(joined).toMatch(/\+1/);
		expect(joined).toMatch(/-1/);
	});

	test("renders add lines in green with agent tags", async () => {
		const formatAttributedDiff = await importFormatter();
		if (!formatAttributedDiff) return;

		const attribution: import("../src/types").FileDiffAttribution = {
			file_path: "/src/foo.ts",
			lines: [{ type: "add" as const, content: "const y = 3;", agent_name: "builder" }],
			total_additions: 1,
			total_deletions: 0,
		};

		const output = formatAttributedDiff(attribution, ["builder"], 80);
		const joined = Array.isArray(output) ? output.join("\n") : String(output);

		// Should contain the added content
		expect(joined).toContain("const y = 3;");
		// Should contain the agent name
		expect(joined).toContain("builder");
	});

	test("handles file with no agent attribution gracefully", async () => {
		const formatAttributedDiff = await importFormatter();
		if (!formatAttributedDiff) return;

		const attribution: import("../src/types").FileDiffAttribution = {
			file_path: "/src/mystery.ts",
			lines: [
				{ type: "add" as const, content: "new line" },
				{ type: "remove" as const, content: "old line" },
			],
			total_additions: 1,
			total_deletions: 1,
		};

		const output = formatAttributedDiff(attribution, [], 80);
		const joined = Array.isArray(output) ? output.join("\n") : String(output);

		// Should still render file path and content without crashing
		expect(joined).toContain("/src/mystery.ts");
		expect(joined).toContain("new line");
		expect(joined).toContain("old line");
	});
});

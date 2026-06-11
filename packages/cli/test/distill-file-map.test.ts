import { describe, expect, test } from "bun:test";
import { extractFileMap } from "../src/distill/file-map";
import type { StoredEvent } from "../src/types";

// -- Helper factories --

const CWD = "/Users/dev/repo";

const mkToolEvent = (overrides: Partial<{
	event: StoredEvent["event"];
	tool_name: string;
	file_path: string;
	tool_use_id: string;
	cwd: string;
}> = {}): StoredEvent => ({
	t: 1000,
	event: overrides.event ?? "PreToolUse",
	sid: "s1",
	data: {
		tool_name: overrides.tool_name ?? "Edit",
		tool_input: { file_path: overrides.file_path ?? `${CWD}/package.json` },
		tool_use_id: overrides.tool_use_id ?? "t1",
		cwd: overrides.cwd ?? CWD,
	},
});

const mkBashEvent = (command: string, cwd: string = CWD): StoredEvent => ({
	t: 2000,
	event: "PreToolUse",
	sid: "s1",
	data: {
		tool_name: "Bash",
		tool_input: { command },
		tool_use_id: "b1",
		cwd,
	},
});

describe("extractFileMap path normalization (B23)", () => {
	test("folds absolute tool path and relative bash path for the same file into one entry", () => {
		// An Edit tool sees the absolute path; a Bash heuristic sees the relative one.
		const events: readonly StoredEvent[] = [
			mkToolEvent({ tool_name: "Edit", file_path: `${CWD}/package.json`, tool_use_id: "t1" }),
			mkBashEvent("cat package.json > package.json"),
		];

		const result = extractFileMap(events);
		const matches = result.files.filter((f) => f.file_path === "package.json");

		// package.json must appear exactly once (not once absolute + once relative).
		expect(matches.length).toBe(1);
		expect(result.files.length).toBe(1);
		expect(matches[0].edits).toBe(1);
	});

	test("merges edit counts across abs/rel duplicates of the same file", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent({ tool_name: "Edit", file_path: `${CWD}/src/app.ts`, tool_use_id: "t1" }),
			// A relative path coming through a tool event (e.g. agent ran with cwd inside repo).
			mkToolEvent({ tool_name: "Edit", file_path: "src/app.ts", tool_use_id: "t2", cwd: CWD }),
		];

		const result = extractFileMap(events);
		expect(result.files.length).toBe(1);
		expect(result.files[0].file_path).toBe("src/app.ts");
		expect(result.files[0].edits).toBe(2);
		expect(result.files[0].tool_use_ids).toEqual(["t1", "t2"]);
	});

	test("normalizes absolute tool paths to repo-relative", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent({ tool_name: "Write", file_path: `${CWD}/packages/web/index.ts`, tool_use_id: "w1" }),
		];

		const result = extractFileMap(events);
		expect(result.files[0].file_path).toBe("packages/web/index.ts");
		expect(result.files[0].writes).toBe(1);
	});

	test("leaves paths outside the session cwd untouched", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent({ tool_name: "Read", file_path: "/etc/hosts", tool_use_id: "r1" }),
		];

		const result = extractFileMap(events);
		expect(result.files[0].file_path).toBe("/etc/hosts");
	});

	test("falls back to absolute paths when no cwd is captured", () => {
		const events: readonly StoredEvent[] = [
			{
				t: 1000,
				event: "PreToolUse",
				sid: "s1",
				data: {
					tool_name: "Edit",
					tool_input: { file_path: "/some/abs/file.ts" },
					tool_use_id: "t1",
				},
			},
		];

		const result = extractFileMap(events);
		expect(result.files[0].file_path).toBe("/some/abs/file.ts");
	});

	test("prefers SessionStart context cwd over event data cwd", () => {
		const events: readonly StoredEvent[] = [
			{
				t: 500,
				event: "SessionStart",
				sid: "s1",
				context: {
					project_dir: CWD,
					cwd: CWD,
					git_branch: null,
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: null,
					agent_type: null,
				},
				data: {},
			},
			mkToolEvent({ tool_name: "Edit", file_path: `${CWD}/main.ts`, tool_use_id: "t1", cwd: "/wrong/dir" }),
		];

		const result = extractFileMap(events);
		expect(result.files[0].file_path).toBe("main.ts");
	});
});

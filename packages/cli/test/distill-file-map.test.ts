import { describe, expect, test } from "bun:test";
import { extractFileMap } from "../src/distill/file-map";
import type { StoredEvent } from "../src/types";

// -- Helper factories --

const CWD = "/Users/dev/repo";

const mkToolEvent = (
	overrides: Partial<{
		event: StoredEvent["event"];
		tool_name: string;
		file_path: string;
		tool_use_id: string;
		cwd: string;
	}> = {},
): StoredEvent => ({
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
			mkToolEvent({
				tool_name: "Write",
				file_path: `${CWD}/packages/web/index.ts`,
				tool_use_id: "w1",
			}),
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
			mkToolEvent({
				tool_name: "Edit",
				file_path: `${CWD}/main.ts`,
				tool_use_id: "t1",
				cwd: "/wrong/dir",
			}),
		];

		const result = extractFileMap(events);
		expect(result.files[0].file_path).toBe("main.ts");
	});
});

// A failing tool op emits BOTH a PreToolUse and a PostToolUseFailure sharing the
// same tool_use_id (confirmed in real sessions); a successful op emits a
// PreToolUse + PostToolUse instead.
const mkFailPair = (
	overrides: Partial<{
		tool_name: string;
		file_path: string;
		tool_use_id: string;
	}> = {},
): readonly StoredEvent[] => {
	const tool_name = overrides.tool_name ?? "Edit";
	const file_path = overrides.file_path ?? `${CWD}/src/app.ts`;
	const tool_use_id = overrides.tool_use_id ?? "fail1";
	return [
		mkToolEvent({ event: "PreToolUse", tool_name, file_path, tool_use_id }),
		mkToolEvent({ event: "PostToolUseFailure", tool_name, file_path, tool_use_id }),
	];
};

describe("extractFileMap failed ops (file-map-failed-ops-counted-as-success-and-dup-ids)", () => {
	test("a failed Edit records an error and NOT an edit", () => {
		const result = extractFileMap(mkFailPair({ tool_name: "Edit", tool_use_id: "f1" }));

		expect(result.files.length).toBe(1);
		expect(result.files[0].errors).toBe(1);
		expect(result.files[0].edits).toBe(0);
	});

	test("a failed Read records an error and NOT a read", () => {
		const result = extractFileMap(mkFailPair({ tool_name: "Read", tool_use_id: "f2" }));

		expect(result.files[0].errors).toBe(1);
		expect(result.files[0].reads).toBe(0);
	});

	test("a failed Write records an error and NOT a write", () => {
		const result = extractFileMap(mkFailPair({ tool_name: "Write", tool_use_id: "f3" }));

		expect(result.files[0].errors).toBe(1);
		expect(result.files[0].writes).toBe(0);
	});

	test("does not duplicate the tool_use_id across the Pre/Failure pair", () => {
		const result = extractFileMap(mkFailPair({ tool_use_id: "dup1" }));

		expect(result.files[0].tool_use_ids).toEqual(["dup1"]);
	});

	test("a successful Edit still counts once with no error", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent({
				event: "PreToolUse",
				tool_name: "Edit",
				file_path: `${CWD}/ok.ts`,
				tool_use_id: "ok1",
			}),
		];

		const result = extractFileMap(events);
		expect(result.files[0].edits).toBe(1);
		expect(result.files[0].errors).toBe(0);
		expect(result.files[0].tool_use_ids).toEqual(["ok1"]);
	});

	test("mixed success and failure on the same file are counted independently", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent({
				event: "PreToolUse",
				tool_name: "Edit",
				file_path: `${CWD}/m.ts`,
				tool_use_id: "okA",
			}),
			...mkFailPair({ tool_name: "Edit", file_path: `${CWD}/m.ts`, tool_use_id: "failB" }),
		];

		const result = extractFileMap(events);
		expect(result.files.length).toBe(1);
		expect(result.files[0].edits).toBe(1);
		expect(result.files[0].errors).toBe(1);
		expect(result.files[0].tool_use_ids).toEqual(["okA", "failB"]);
	});

	test("an orphan PostToolUseFailure (no matching PreToolUse) still records the error", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent({
				event: "PostToolUseFailure",
				tool_name: "Read",
				file_path: `${CWD}/orphan.ts`,
				tool_use_id: "orph1",
			}),
		];

		const result = extractFileMap(events);
		expect(result.files.length).toBe(1);
		expect(result.files[0].errors).toBe(1);
		expect(result.files[0].reads).toBe(0);
		expect(result.files[0].tool_use_ids).toEqual(["orph1"]);
	});
});

describe("extractFileMap bash path heuristics (file-map-bash-regex-garbage-paths)", () => {
	test("does not extract a path from an arrow function inside node -e", () => {
		const result = extractFileMap([mkBashEvent('node -e "rows.map(r => r.id)"')]);
		expect(result.files).toEqual([]);
	});

	test("does not extract a path from a >= comparison", () => {
		const result = extractFileMap([mkBashEvent("if [ $x >= 5 ]; then echo hi; fi")]);
		expect(result.files).toEqual([]);
	});

	test("does not extract a path from an arrow inside a quoted commit message", () => {
		const result = extractFileMap([mkBashEvent('git commit -m "fix => bug"')]);
		expect(result.files).toEqual([]);
	});

	test("still extracts a genuine redirect target", () => {
		const result = extractFileMap([mkBashEvent("echo hello > out.txt")]);
		expect(result.files.map((f) => f.file_path)).toEqual(["out.txt"]);
	});

	test("still extracts an append redirect target", () => {
		const result = extractFileMap([mkBashEvent("echo data >> log.txt")]);
		expect(result.files.map((f) => f.file_path)).toEqual(["log.txt"]);
	});

	test("still extracts mkdir and touch targets", () => {
		const mk = extractFileMap([mkBashEvent("mkdir -p dist/assets")]);
		const tch = extractFileMap([mkBashEvent("touch newfile.ts")]);
		expect(mk.files.map((f) => f.file_path)).toEqual(["dist/assets"]);
		expect(tch.files.map((f) => f.file_path)).toEqual(["newfile.ts"]);
	});

	test("rejects tokens carrying shell-syntax garbage characters", () => {
		const result = extractFileMap([mkBashEvent('echo "$(date)" > "weird=name"')]);
		// The quoted/garbage redirect target must not surface as a file.
		const garbage = result.files.filter((f) => /["'`(){}=$<>;&|]/.test(f.file_path));
		expect(garbage).toEqual([]);
	});
});

describe("extractFileMap repo-root normalization aligns with git diff (cwd-in-subdir)", () => {
	const ROOT = "/Users/dev/repo";
	const SUBDIR = "/Users/dev/repo/packages/web";

	const subdirCtx = {
		project_dir: ROOT,
		cwd: SUBDIR,
		git_branch: null,
		git_remote: null,
		git_commit: null,
		git_worktree: null,
		team_name: null,
		task_list_dir: null,
		claude_entrypoint: null,
		model: null,
		agent_type: null,
	};

	test("normalizes an absolute tool path under a subdir to a repo-root-relative key", () => {
		// When a session runs in a subdirectory, project_dir is the repo root.
		// git diff emits repo-root-relative paths (e.g. packages/web/src/app.ts),
		// so the tool path must normalize to the SAME key, not the subdir-relative
		// "src/app.ts".
		const events: readonly StoredEvent[] = [
			{ t: 500, event: "SessionStart", sid: "s1", context: subdirCtx, data: {} },
			mkToolEvent({
				event: "PreToolUse",
				tool_name: "Edit",
				file_path: `${SUBDIR}/src/app.ts`,
				tool_use_id: "t1",
			}),
		];

		const result = extractFileMap(events);
		expect(result.files[0].file_path).toBe("packages/web/src/app.ts");
	});

	test("folds a tool event and a git-style repo-relative path onto one entry (merge dedup)", () => {
		// Simulate the merge scenario: a tool event (absolute, under the subdir)
		// and a bash heuristic emitting the repo-root-relative path git would use.
		// Both must collapse onto a single repo-relative key.
		const events: readonly StoredEvent[] = [
			{ t: 500, event: "SessionStart", sid: "s1", context: subdirCtx, data: {} },
			mkToolEvent({
				event: "PreToolUse",
				tool_name: "Edit",
				file_path: `${SUBDIR}/src/app.ts`,
				tool_use_id: "t1",
			}),
			// A bash redirect writing to the same file expressed repo-root-relative.
			mkBashEvent("echo x > packages/web/src/app.ts", ROOT),
		];

		const result = extractFileMap(events);
		const matches = result.files.filter((f) => f.file_path === "packages/web/src/app.ts");
		expect(matches.length).toBe(1);
		expect(result.files.length).toBe(1);
		expect(matches[0].edits).toBe(1);
		expect(matches[0].source).toBe("tool");
	});

	test("falls back to subdir cwd only when no project_dir is captured", () => {
		const events: readonly StoredEvent[] = [
			mkToolEvent({
				event: "PreToolUse",
				tool_name: "Edit",
				file_path: `${SUBDIR}/src/app.ts`,
				tool_use_id: "t1",
				cwd: SUBDIR,
			}),
		];

		const result = extractFileMap(events);
		// Without a repo root, the subdir cwd is all we have; this is the
		// degraded case the project_dir preference is designed to avoid.
		expect(result.files[0].file_path).toBe("src/app.ts");
	});
});

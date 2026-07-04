import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extractGitDiff, parseNumstatOutput } from "../src/distill/git-diff";
import type { StoredEvent } from "../src/types";

// --- Factories ---

const makeStoredEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

// --- parseNumstatOutput (pure function) ---

describe("parseNumstatOutput", () => {
	test("parses standard numstat output into WorkingTreeChange array", () => {
		const output = "10\t5\tsrc/index.ts\n3\t1\tsrc/utils.ts\n";

		const result = parseNumstatOutput(output);

		expect(result.length).toBe(2);
		expect(result[0]).toEqual({
			file_path: "src/index.ts",
			status: "modified",
			additions: 10,
			deletions: 5,
		});
		expect(result[1]).toEqual({
			file_path: "src/utils.ts",
			status: "modified",
			additions: 3,
			deletions: 1,
		});
	});

	test("detects 'added' status (additions > 0, deletions === 0)", () => {
		const output = "15\t0\tsrc/new-file.ts\n";

		const result = parseNumstatOutput(output);

		expect(result.length).toBe(1);
		expect(result[0].status).toBe("added");
		expect(result[0].additions).toBe(15);
		expect(result[0].deletions).toBe(0);
	});

	test("detects 'deleted' status (deletions > 0, additions === 0)", () => {
		const output = "0\t20\tsrc/old-file.ts\n";

		const result = parseNumstatOutput(output);

		expect(result.length).toBe(1);
		expect(result[0].status).toBe("deleted");
		expect(result[0].additions).toBe(0);
		expect(result[0].deletions).toBe(20);
	});

	test("detects 'modified' status (both additions and deletions)", () => {
		const output = "7\t3\tsrc/refactored.ts\n";

		const result = parseNumstatOutput(output);

		expect(result.length).toBe(1);
		expect(result[0].status).toBe("modified");
		expect(result[0].additions).toBe(7);
		expect(result[0].deletions).toBe(3);
	});

	test("handles empty output", () => {
		const result = parseNumstatOutput("");
		expect(result).toEqual([]);
	});

	test("handles whitespace-only output", () => {
		const result = parseNumstatOutput("   \n  \n");
		expect(result).toEqual([]);
	});

	test("handles lines without file path (malformed)", () => {
		const output = "10\t5\n3\t1\tsrc/valid.ts\n";

		const result = parseNumstatOutput(output);

		expect(result.length).toBe(1);
		expect(result[0].file_path).toBe("src/valid.ts");
	});

	test("handles multiple files with mixed statuses", () => {
		const output = [
			"20\t0\tsrc/brand-new.ts",
			"0\t15\tsrc/removed.ts",
			"8\t4\tsrc/changed.ts",
		].join("\n");

		const result = parseNumstatOutput(output);

		expect(result.length).toBe(3);
		expect(result[0].status).toBe("added");
		expect(result[1].status).toBe("deleted");
		expect(result[2].status).toBe("modified");
	});

	test("treats non-numeric additions/deletions as 0 (modified status)", () => {
		const output = "-\t-\tsrc/binary-file.bin\n";

		const result = parseNumstatOutput(output);

		expect(result.length).toBe(1);
		expect(result[0].additions).toBe(0);
		expect(result[0].deletions).toBe(0);
		expect(result[0].status).toBe("modified");
	});
});

// --- extractGitDiff (integration tests with temp git repo) ---

const TEST_DIR = "/tmp/clens-test-git-diff";

const initGitRepo = () => {
	Bun.spawnSync(["git", "init"], { cwd: TEST_DIR });
	Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: TEST_DIR });
	Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: TEST_DIR });
};

describe("extractGitDiff", () => {
	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		mkdirSync(TEST_DIR, { recursive: true });
		initGitRepo();
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("returns empty commits and hunks when session has no events", async () => {
		const result = await extractGitDiff("sess-empty", TEST_DIR, []);

		expect(result.commits).toEqual([]);
		expect(result.hunks).toEqual([]);
	});

	test("returns empty commits when no git commits in session timeframe", async () => {
		// Create an initial commit outside the session timeframe
		writeFileSync(`${TEST_DIR}/initial.txt`, "initial content\n");
		Bun.spawnSync(["git", "add", "."], { cwd: TEST_DIR });
		Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd: TEST_DIR });

		// Session timeframe far in the future
		const futureTime = Date.now() + 86_400_000; // +24h
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: futureTime, event: "SessionStart", sid: "sess-future" }),
			makeStoredEvent({ t: futureTime + 1000, event: "SessionEnd", sid: "sess-future" }),
		];

		const result = await extractGitDiff("sess-future", TEST_DIR, [...events]);

		expect(result.commits).toEqual([]);
		expect(result.hunks).toEqual([]);
	});

	test("detects commits within session timeframe", async () => {
		// Create initial commit
		writeFileSync(`${TEST_DIR}/base.txt`, "base\n");
		Bun.spawnSync(["git", "add", "."], { cwd: TEST_DIR });
		Bun.spawnSync(["git", "commit", "-m", "base commit"], { cwd: TEST_DIR });

		// Create a commit that should fall within the session timeframe
		const beforeCommit = Date.now();
		writeFileSync(`${TEST_DIR}/feature.txt`, "new feature content\n");
		Bun.spawnSync(["git", "add", "."], { cwd: TEST_DIR });
		Bun.spawnSync(["git", "commit", "-m", "add feature"], { cwd: TEST_DIR });
		const afterCommit = Date.now();

		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: beforeCommit - 1000, event: "SessionStart", sid: "sess-detect" }),
			makeStoredEvent({ t: afterCommit + 1000, event: "SessionEnd", sid: "sess-detect" }),
		];

		const result = await extractGitDiff("sess-detect", TEST_DIR, [...events]);

		expect(result.commits.length).toBeGreaterThanOrEqual(1);
		expect(result.hunks.length).toBeGreaterThanOrEqual(1);
		expect(result.hunks[0].file_path).toBe("feature.txt");
		expect(result.hunks[0].additions).toBeGreaterThan(0);
	});

	test("matches Edit/Write events to commit hunks by file path", async () => {
		// Create initial commit
		writeFileSync(`${TEST_DIR}/app.ts`, "const x = 1;\n");
		Bun.spawnSync(["git", "add", "."], { cwd: TEST_DIR });
		Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd: TEST_DIR });

		// Create a commit modifying the file
		const beforeCommit = Date.now();
		writeFileSync(`${TEST_DIR}/app.ts`, "const x = 1;\nconst y = 2;\n");
		Bun.spawnSync(["git", "add", "."], { cwd: TEST_DIR });
		Bun.spawnSync(["git", "commit", "-m", "modify app.ts"], { cwd: TEST_DIR });
		const afterCommit = Date.now();

		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: beforeCommit - 1000, event: "SessionStart", sid: "sess-match" }),
			makeStoredEvent({
				t: beforeCommit,
				event: "PreToolUse",
				sid: "sess-match",
				data: {
					tool_name: "Edit",
					tool_use_id: "edit-123",
					tool_input: { file_path: `${TEST_DIR}/app.ts` },
				},
			}),
			makeStoredEvent({ t: afterCommit + 1000, event: "SessionEnd", sid: "sess-match" }),
		];

		const result = await extractGitDiff("sess-match", TEST_DIR, [...events]);

		expect(result.hunks.length).toBeGreaterThanOrEqual(1);
		const appHunk = result.hunks.find((h) => h.file_path === "app.ts");
		expect(appHunk).toBeDefined();
		expect(appHunk?.matched_tool_use_id).toBe("edit-123");
	});

	test("detects working tree changes", async () => {
		// Create initial commit
		writeFileSync(`${TEST_DIR}/tracked.txt`, "original\n");
		Bun.spawnSync(["git", "add", "."], { cwd: TEST_DIR });
		Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd: TEST_DIR });

		// Modify tracked file without committing (working tree change)
		writeFileSync(`${TEST_DIR}/tracked.txt`, "original\nmodified line\n");

		const now = Date.now();
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: now - 5000, event: "SessionStart", sid: "sess-wt" }),
			makeStoredEvent({ t: now, event: "SessionEnd", sid: "sess-wt" }),
		];

		// Need at least one commit in timeframe for the function to proceed past early return
		// Create a commit within the timeframe
		writeFileSync(`${TEST_DIR}/other.txt`, "some content\n");
		Bun.spawnSync(["git", "add", "other.txt"], { cwd: TEST_DIR });
		Bun.spawnSync(["git", "commit", "-m", "commit in session"], { cwd: TEST_DIR });

		const result = await extractGitDiff("sess-wt", TEST_DIR, [...events]);

		// working_tree_changes should include tracked.txt
		// (appending a line = 1 addition, 0 deletions => "added" status per parseNumstatOutput)
		expect(result.working_tree_changes).toBeDefined();
		if (result.working_tree_changes) {
			const trackedChange = result.working_tree_changes.find((c) => c.file_path === "tracked.txt");
			expect(trackedChange).toBeDefined();
			expect(trackedChange?.additions).toBeGreaterThan(0);
		}
	});

	test("handles repo with no commits gracefully", async () => {
		// Git repo with no commits at all
		const now = Date.now();
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: now - 5000, event: "SessionStart", sid: "sess-nocommit" }),
			makeStoredEvent({ t: now, event: "SessionEnd", sid: "sess-nocommit" }),
		];

		const result = await extractGitDiff("sess-nocommit", TEST_DIR, [...events]);

		expect(result.commits).toEqual([]);
		expect(result.hunks).toEqual([]);
	});

	test("returns empty when projectDir is not a git repo", async () => {
		const nonGitDir = "/tmp/clens-test-non-git";
		rmSync(nonGitDir, { recursive: true, force: true });
		mkdirSync(nonGitDir, { recursive: true });

		const now = Date.now();
		const events: readonly StoredEvent[] = [
			makeStoredEvent({ t: now - 5000, event: "SessionStart", sid: "sess-nongit" }),
			makeStoredEvent({ t: now, event: "SessionEnd", sid: "sess-nongit" }),
		];

		const result = await extractGitDiff("sess-nongit", nonGitDir, [...events]);

		expect(result.commits).toEqual([]);
		expect(result.hunks).toEqual([]);

		rmSync(nonGitDir, { recursive: true, force: true });
	});
});

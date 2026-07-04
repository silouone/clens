import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredEvent } from "../src/types";

const TEST_DIR = "/tmp/clens-test-hook";
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_SCRIPT = resolve(PKG_ROOT, "src/hook.ts");

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("hook handler", () => {
	test("writes JSONL for PreToolUse event", async () => {
		const payload = JSON.stringify({
			session_id: "test-session-1",
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command: "ls" },
			tool_use_id: "t1",
			cwd: TEST_DIR,
			transcript_path: "/tmp/t.jsonl",
			permission_mode: "default",
		});

		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		await proc.exited;

		const sessionFile = `${TEST_DIR}/.clens/sessions/test-session-1.jsonl`;
		expect(existsSync(sessionFile)).toBe(true);

		const content = readFileSync(sessionFile, "utf-8").trim();
		const stored: StoredEvent = JSON.parse(content);
		expect(stored.event).toBe("PreToolUse");
		expect(stored.sid).toBe("test-session-1");
		expect(stored.data.tool_name).toBe("Bash");
		expect(typeof stored.t).toBe("number");
	});

	test("handles empty stdin gracefully", async () => {
		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response(""),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);
	});

	test("handles invalid JSON gracefully", async () => {
		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response("not json"),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);
	});

	test("non-JSON input exits cleanly without error log entry", async () => {
		const invalidInput = "not valid json at all";

		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response(invalidInput),
			stdout: "pipe",
			stderr: "pipe",
			cwd: TEST_DIR,
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);

		// Guard catches non-JSON input before JSON.parse — no error log created
		const errorLog = `${TEST_DIR}/.clens/errors.log`;
		expect(existsSync(errorLog)).toBe(false);
	});

	test("valid JSON input still processes normally", async () => {
		const payload = JSON.stringify({
			session_id: "valid-session",
			cwd: TEST_DIR,
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { file_path: "/foo.ts" },
			tool_use_id: "t2",
			transcript_path: "/tmp/t.jsonl",
			permission_mode: "default",
		});

		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);

		const sessionFile = `${TEST_DIR}/.clens/sessions/valid-session.jsonl`;
		expect(existsSync(sessionFile)).toBe(true);

		const content = readFileSync(sessionFile, "utf-8").trim();
		const stored: StoredEvent = JSON.parse(content);
		expect(stored.event).toBe("PreToolUse");
		expect(stored.sid).toBe("valid-session");
	});

	test("creates directory on first event", async () => {
		const payload = JSON.stringify({
			session_id: "new-session",
			cwd: TEST_DIR,
			hook_event_name: "SessionStart",
			transcript_path: "/tmp/t.jsonl",
			permission_mode: "default",
		});

		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "SessionStart"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		await proc.exited;
		expect(existsSync(`${TEST_DIR}/.clens/sessions`)).toBe(true);
	});

	// B28: a subagent running with cwd inside a subdirectory must NOT fragment
	// session capture into a nested `.clens/`. The hook walks up to the project
	// root (nearest `.clens/`) and appends there.
	test("nested cwd writes to the project-root .clens, not a nested one", async () => {
		// Seed the project root so resolveProjectRoot can find the marker.
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
		const nestedCwd = `${TEST_DIR}/packages/web/src/client/assets`;
		mkdirSync(nestedCwd, { recursive: true });

		const payload = JSON.stringify({
			session_id: "nested-session",
			cwd: nestedCwd,
			hook_event_name: "PreToolUse",
			tool_name: "Edit",
			tool_input: { file_path: "/foo.ts" },
			tool_use_id: "t-nested",
			transcript_path: "/tmp/t.jsonl",
			permission_mode: "default",
		});

		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		await proc.exited;

		// Event lands in the project-root .clens.
		const rootFile = `${TEST_DIR}/.clens/sessions/nested-session.jsonl`;
		expect(existsSync(rootFile)).toBe(true);

		// And NOT in a fragmented nested .clens under the subdirectory.
		expect(existsSync(`${nestedCwd}/.clens`)).toBe(false);

		const stored: StoredEvent = JSON.parse(readFileSync(rootFile, "utf-8").trim());
		expect(stored.sid).toBe("nested-session");
		expect(stored.event).toBe("PreToolUse");
	});

	test("nested cwd falls back to .git root when no .clens exists yet", async () => {
		// Project root has a .git but no .clens yet (first event of a session).
		mkdirSync(`${TEST_DIR}/.git`, { recursive: true });
		const nestedCwd = `${TEST_DIR}/packages/cli/src`;
		mkdirSync(nestedCwd, { recursive: true });

		const payload = JSON.stringify({
			session_id: "git-root-session",
			cwd: nestedCwd,
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { file_path: "/bar.ts" },
			tool_use_id: "t-git",
			transcript_path: "/tmp/t.jsonl",
			permission_mode: "default",
		});

		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		await proc.exited;

		expect(existsSync(`${TEST_DIR}/.clens/sessions/git-root-session.jsonl`)).toBe(true);
		expect(existsSync(`${nestedCwd}/.clens`)).toBe(false);
	});

	// Regression: a resolved root nested under `.clens/` produced a recursive
	// `.clens/sessions/.clens/sessions` capture dir that self-perpetuated. The hook
	// must refuse to write any path nested under a `.clens/` segment.
	test("refuses to write when the resolved root is nested under .clens", async () => {
		// A capture dir already nested under `.clens/` (the recursion seed).
		const nestedRoot = `${TEST_DIR}/.clens/sessions`;
		mkdirSync(`${nestedRoot}/.clens/sessions`, { recursive: true });

		const payload = JSON.stringify({
			session_id: "recursive-session",
			cwd: nestedRoot,
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { file_path: "/baz.ts" },
			tool_use_id: "t-recursive",
			transcript_path: "/tmp/t.jsonl",
			permission_mode: "default",
		});

		const proc = Bun.spawn(["bun", "run", HOOK_SCRIPT, "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: PKG_ROOT,
		});

		await proc.exited;

		// No event written anywhere under the nested `.clens/`.
		expect(existsSync(`${nestedRoot}/.clens/sessions/recursive-session.jsonl`)).toBe(false);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/recursive-session.jsonl`)).toBe(false);
	});
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredEvent } from "../src/types";

const ROOT_PREFIX = join(tmpdir(), "clens-test-hook-");
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_SCRIPT = resolve(PKG_ROOT, "src/hook.ts");

const markersIn = (dir: string) => [".clens", ".git"].filter((m) => existsSync(join(dir, m)));

// @adw clens-014#R1,R2: each test owns a mkdtemp root seeded with its own `.clens` marker, so
// the nearest marker wins and a stray `.clens` in a shared parent cannot capture the walk.
const seenRoots: string[] = [];
let TEST_DIR: string;

beforeEach(() => {
	TEST_DIR = mkdtempSync(ROOT_PREFIX);
	seenRoots.push(TEST_DIR);
	mkdirSync(`${TEST_DIR}/.clens`);
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

	// @adw clens-014#R2: a `.clens` in the parent of the project root must not capture the event.
	test("ignores a .clens in the parent of the project root", async () => {
		const outer = mkdtempSync(ROOT_PREFIX);
		try {
			mkdirSync(`${outer}/.clens`);
			const project = `${outer}/proj`;
			const cwd = `${project}/src`;
			mkdirSync(`${project}/.clens`, { recursive: true });
			mkdirSync(cwd, { recursive: true });

			const payload = JSON.stringify({
				session_id: "parent-marker-session",
				cwd,
				hook_event_name: "PreToolUse",
				tool_name: "Read",
				tool_input: { file_path: "/qux.ts" },
				tool_use_id: "t-parent",
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

			expect(existsSync(`${project}/.clens/sessions/parent-marker-session.jsonl`)).toBe(true);
			expect(existsSync(`${outer}/.clens/sessions`)).toBe(false);
		} finally {
			rmSync(outer, { recursive: true, force: true });
		}
	});

	// @adw clens-014#R1: the run writes nothing outside its private mkdtemp root.
	test("R1: hook run stays inside its private root", async () => {
		const parentBefore = markersIn(dirname(TEST_DIR));
		const payload = JSON.stringify({
			session_id: "private-root-session",
			cwd: TEST_DIR,
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command: "ls" },
			tool_use_id: "t-private",
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

		expect(TEST_DIR.startsWith(ROOT_PREFIX)).toBe(true);
		expect(markersIn(dirname(TEST_DIR))).toEqual(parentBefore);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/private-root-session.jsonl`)).toBe(true);
	});

	// @adw clens-014#R1: roots from earlier tests are distinct and gone.
	test("R1: previous hook test roots were removed by afterEach", () => {
		expect(new Set(seenRoots).size).toBe(seenRoots.length);
		const previous = seenRoots.filter((root) => root !== TEST_DIR);
		expect(previous.length).toBeGreaterThan(0);
		expect(previous.filter((root) => existsSync(root))).toEqual([]);
	});
});

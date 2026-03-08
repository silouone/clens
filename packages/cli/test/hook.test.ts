import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
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
});

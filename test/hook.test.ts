import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import type { StoredEvent } from "../src/types";

const TEST_DIR = "/tmp/clens-test-hook";

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

		const proc = Bun.spawn(["bun", "run", "src/hook.ts", "PreToolUse"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: process.cwd(),
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
		const proc = Bun.spawn(["bun", "run", "src/hook.ts", "PreToolUse"], {
			stdin: new Response(""),
			stdout: "pipe",
			stderr: "pipe",
			cwd: process.cwd(),
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);
	});

	test("handles invalid JSON gracefully", async () => {
		const proc = Bun.spawn(["bun", "run", "src/hook.ts", "PreToolUse"], {
			stdin: new Response("not json"),
			stdout: "pipe",
			stderr: "pipe",
			cwd: process.cwd(),
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);
	});

	test("logs error details on invalid JSON", async () => {
		const invalidInput = "not valid json at all {broken";
		const projectRoot = process.cwd();
		const hookScript = `${projectRoot}/src/hook.ts`;

		const proc = Bun.spawn(["bun", "run", hookScript, "PreToolUse"], {
			stdin: new Response(invalidInput),
			stdout: "pipe",
			stderr: "pipe",
			cwd: TEST_DIR,
		});

		const exitCode = await proc.exited;
		expect(exitCode).toBe(0);

		// The hook falls back to process.cwd() (TEST_DIR) for error logging when JSON parse fails
		const errorLog = `${TEST_DIR}/.clens/errors.log`;
		expect(existsSync(errorLog)).toBe(true);

		const logContent = readFileSync(errorLog, "utf-8");
		// Should contain event type
		expect(logContent).toContain("[PreToolUse]");
		// Should contain stack trace indicator
		expect(logContent).toContain("stack:");
		// Should contain truncated input
		expect(logContent).toContain("input:");
		expect(logContent).toContain("not valid json");
	});

	test("creates directory on first event", async () => {
		const payload = JSON.stringify({
			session_id: "new-session",
			cwd: TEST_DIR,
			hook_event_name: "SessionStart",
			transcript_path: "/tmp/t.jsonl",
			permission_mode: "default",
		});

		const proc = Bun.spawn(["bun", "run", "src/hook.ts", "SessionStart"], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			cwd: process.cwd(),
		});

		await proc.exited;
		expect(existsSync(`${TEST_DIR}/.clens/sessions`)).toBe(true);
	});
});

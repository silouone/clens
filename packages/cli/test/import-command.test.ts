/**
 * Command-level coverage for `clens import codex` (clens-007): a rollout file is
 * mapped and written to `.clens/sessions/{sid}.jsonl`, a directory imports every
 * rollout under it, and re-import OVERWRITES (never appends).
 *
 * GUARDRAIL: runs entirely against a throwaway temp dir under os.tmpdir(); never
 * touches a real `.clens/`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCommand } from "../src/commands/import";

// A minimal 3-record rollout: session_meta (+ turn_context for the model slug)
// and one user_message. Enough to exercise the write path.
const ROLLOUT = [
	{
		timestamp: "2026-07-20T10:00:00.000Z",
		type: "session_meta",
		payload: { session_id: "sid-abc", cwd: "/x", git: { branch: "main" } },
	},
	{
		timestamp: "2026-07-20T10:00:01.000Z",
		type: "turn_context",
		payload: { model: "gpt-5.6-sol" },
	},
	{
		timestamp: "2026-07-20T10:00:02.000Z",
		type: "event_msg",
		payload: { type: "user_message", message: "hi" },
	},
]
	.map((r) => JSON.stringify(r))
	.join("\n");

let dir: string;

beforeEach(() => {
	dir = join(tmpdir(), `clens-import-test-${process.pid}-${performance.now()}`);
	mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sessionFile = () => join(dir, ".clens/sessions/sid-abc.jsonl");

describe("importCommand", () => {
	test("writes a session file from a single rollout", () => {
		const rolloutPath = join(dir, "rollout-x.jsonl");
		writeFileSync(rolloutPath, ROLLOUT);

		importCommand({ provider: "codex", inputPath: rolloutPath, projectDir: dir });

		expect(existsSync(sessionFile())).toBe(true);
		const lines = readFileSync(sessionFile(), "utf-8").trim().split("\n");
		expect(JSON.parse(lines[0]).event).toBe("SessionStart");
	});

	test("re-import overwrites, never appends", () => {
		const rolloutPath = join(dir, "rollout-x.jsonl");
		writeFileSync(rolloutPath, ROLLOUT);

		importCommand({ provider: "codex", inputPath: rolloutPath, projectDir: dir });
		const firstCount = readFileSync(sessionFile(), "utf-8").trim().split("\n").length;
		importCommand({ provider: "codex", inputPath: rolloutPath, projectDir: dir });
		const secondCount = readFileSync(sessionFile(), "utf-8").trim().split("\n").length;

		expect(secondCount).toBe(firstCount);
	});

	test("imports every rollout-*.jsonl under a directory (recursively)", () => {
		const nested = join(dir, "2026/07/20");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "rollout-a.jsonl"), ROLLOUT);
		// A non-rollout file in the same dir is ignored.
		writeFileSync(join(nested, "notes.txt"), "ignore me");

		importCommand({ provider: "codex", inputPath: dir, projectDir: dir });

		expect(existsSync(sessionFile())).toBe(true);
	});

	test("rejects an unknown provider", () => {
		expect(() => importCommand({ provider: "gemini", inputPath: "x", projectDir: dir })).toThrow(
			/Unknown import provider/,
		);
	});

	test("errors when the rollout path is missing", () => {
		expect(() =>
			importCommand({ provider: "codex", inputPath: undefined, projectDir: dir }),
		).toThrow(/Missing rollout path/);
	});
});

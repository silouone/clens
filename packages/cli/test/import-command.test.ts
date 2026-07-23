/**
 * Command-level coverage for `clens import codex` (clens-007): a rollout file is
 * mapped and written to `.clens/sessions/{sid}.jsonl`, a directory imports every
 * rollout under it, and re-import OVERWRITES (never appends). Also covers the
 * no-arg auto-discover default (clens-010): `CODEX_HOME`/`~/.codex/sessions`.
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
});

describe("importCommand auto-discover (no path arg)", () => {
	let previousCodexHome: string | undefined;
	let previousHome: string | undefined;
	let previousUserProfile: string | undefined;

	beforeEach(() => {
		previousCodexHome = process.env.CODEX_HOME;
		previousHome = process.env.HOME;
		previousUserProfile = process.env.USERPROFILE;
	});
	afterEach(() => {
		if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = previousCodexHome;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
	});

	test("imports from $CODEX_HOME/sessions when CODEX_HOME is set", () => {
		process.env.CODEX_HOME = dir;
		const nested = join(dir, "sessions/2026/07/20");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "rollout-a.jsonl"), ROLLOUT);

		importCommand({ provider: "codex", inputPath: undefined, projectDir: dir });

		expect(existsSync(sessionFile())).toBe(true);
		const lines = readFileSync(sessionFile(), "utf-8").trim().split("\n");
		expect(JSON.parse(lines[0]).event).toBe("SessionStart");
	});

	test("falls back to ~/.codex/sessions when CODEX_HOME is unset", () => {
		delete process.env.CODEX_HOME;
		process.env.HOME = dir;
		const nested = join(dir, ".codex/sessions");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "rollout-a.jsonl"), ROLLOUT);

		importCommand({ provider: "codex", inputPath: undefined, projectDir: dir });

		expect(existsSync(sessionFile())).toBe(true);
	});

	test("falls back to $USERPROFILE/.codex/sessions when neither CODEX_HOME nor HOME is set", () => {
		delete process.env.CODEX_HOME;
		delete process.env.HOME;
		process.env.USERPROFILE = dir;
		const nested = join(dir, ".codex/sessions");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "rollout-a.jsonl"), ROLLOUT);

		importCommand({ provider: "codex", inputPath: undefined, projectDir: dir });

		expect(existsSync(sessionFile())).toBe(true);
	});

	test("an empty-string CODEX_HOME is treated as unset and falls back to HOME", () => {
		process.env.CODEX_HOME = "";
		process.env.HOME = dir;
		const nested = join(dir, ".codex/sessions");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(nested, "rollout-a.jsonl"), ROLLOUT);

		importCommand({ provider: "codex", inputPath: undefined, projectDir: dir });

		expect(existsSync(sessionFile())).toBe(true);
	});

	test("absent default dir → friendly message, no crash, no .clens created", () => {
		process.env.CODEX_HOME = join(dir, "does-not-exist");

		expect(() =>
			importCommand({ provider: "codex", inputPath: undefined, projectDir: dir }),
		).not.toThrow();
		expect(existsSync(join(dir, ".clens"))).toBe(false);
	});

	test("default dir exists but is empty → reuses the existing 'no files found' message, no crash", () => {
		process.env.CODEX_HOME = dir;
		mkdirSync(join(dir, "sessions"), { recursive: true });

		expect(() =>
			importCommand({ provider: "codex", inputPath: undefined, projectDir: dir }),
		).not.toThrow();
		expect(existsSync(join(dir, ".clens"))).toBe(false);
	});

	test("explicit path is unaffected by CODEX_HOME (regression)", () => {
		// A different session lives under CODEX_HOME than the one passed explicitly.
		process.env.CODEX_HOME = dir;
		const codexNested = join(dir, "sessions/2026/07/20");
		mkdirSync(codexNested, { recursive: true });
		const OTHER_ROLLOUT = ROLLOUT.replace("sid-abc", "sid-other");
		writeFileSync(join(codexNested, "rollout-other.jsonl"), OTHER_ROLLOUT);

		const explicitDir = join(dir, "explicit");
		mkdirSync(explicitDir, { recursive: true });
		writeFileSync(join(explicitDir, "rollout-x.jsonl"), ROLLOUT);

		importCommand({ provider: "codex", inputPath: explicitDir, projectDir: dir });

		expect(existsSync(sessionFile())).toBe(true);
		expect(existsSync(join(dir, ".clens/sessions/sid-other.jsonl"))).toBe(false);
	});
});

/**
 * Pins the LOCKED clean-safety semantics (revival-2026-06 / talk-prep footgun):
 *
 *   - bare `clens clean` (no id, no --last, no --all) deletes NOTHING and errors,
 *   - blanket `--all` is gated behind a confirmation (interactive [y/N]) and,
 *     in a non-interactive context, requires an explicit `--yes`,
 *   - `--yes` performs the non-interactive blanket delete,
 *   - undistilled sessions are skipped unless `--force`,
 *   - an end-to-end happy path through the real CLI binary entrypoint.
 *
 * GUARDRAIL: every path runs against a throwaway temp fixture dir under os.tmpdir().
 * It NEVER touches a real `.clens/` (the project's or `~/.clens`).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Flags } from "../src/commands/shared";
import { runCli } from "./e2e/helpers";

// ── Interactive-confirm mock ────────────────────────────
// commands/clean.ts builds its [y/N] prompt via node:readline's createInterface.
// We replace it with a deterministic stub whose answer is controlled per-test.
let mockAnswer = "";
mock.module("node:readline", () => ({
	createInterface: () => ({
		question: (_question: string, cb: (answer: string) => void) => cb(mockAnswer),
		close: () => {},
	}),
}));

// ── Flag builder ────────────────────────────────────────
const makeFlags = (overrides: Partial<Flags> = {}): Flags => ({
	last: false,
	force: false,
	yes: false,
	deep: false,
	json: false,
	help: false,
	version: false,
	detail: false,
	full: false,
	all: false,
	remove: false,
	status: false,
	dev: false,
	comms: false,
	global: false,
	legacy: false,
	...overrides,
});

const DISTILLED_ID = "11111111-1111-1111-1111-111111111111";
const UNDISTILLED_ID = "22222222-2222-2222-2222-222222222222";

const sessionPath = (dir: string, id: string) => join(dir, ".clens", "sessions", `${id}.jsonl`);
const distilledPath = (dir: string, id: string) => join(dir, ".clens", "distilled", `${id}.json`);

const writeSession = (dir: string, id: string, distilled: boolean): void => {
	writeFileSync(
		sessionPath(dir, id),
		[
			JSON.stringify({ event: "SessionStart", t: 1000, sid: id, data: {} }),
			JSON.stringify({ event: "SessionEnd", t: 2000, sid: id, data: {} }),
		].join("\n") + "\n",
	);
	if (distilled) {
		writeFileSync(distilledPath(dir, id), JSON.stringify({ session_id: id }));
	}
};

describe("clean command — safety gating", () => {
	let tempDir: string;

	// Capture console output so the suite stays quiet and so we can assert on it.
	const logs: string[] = [];
	const originalLog = console.log;

	beforeEach(() => {
		mockAnswer = "";
		logs.length = 0;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		tempDir = join(
			tmpdir(),
			`clens-test-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(join(tempDir, ".clens", "sessions"), { recursive: true });
		mkdirSync(join(tempDir, ".clens", "distilled"), { recursive: true });
		writeSession(tempDir, DISTILLED_ID, true);
		writeSession(tempDir, UNDISTILLED_ID, false);
	});

	afterEach(() => {
		console.log = originalLog;
		rmSync(tempDir, { recursive: true, force: true });
	});

	const runClean = async (args: { sessionArg?: string; flags?: Partial<Flags> }): Promise<void> => {
		const { cleanCommand } = await import("../src/commands/clean");
		await cleanCommand({
			sessionArg: args.sessionArg,
			flags: makeFlags(args.flags),
			projectDir: tempDir,
		});
	};

	test("bare clean (no id, no --all) errors and deletes nothing", async () => {
		await expect(runClean({})).rejects.toThrow(/Nothing to clean/);

		// Guardrail: both sessions are untouched.
		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(true);
		expect(existsSync(sessionPath(tempDir, UNDISTILLED_ID))).toBe(true);
	});

	test("--all in a non-interactive context refuses without --yes (confirmation gating)", async () => {
		// In `bun test` process.stdin.isTTY is undefined → non-interactive path.
		await expect(runClean({ flags: { all: true } })).rejects.toThrow(/Refusing to .*clean --all/);

		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(true);
		expect(existsSync(sessionPath(tempDir, UNDISTILLED_ID))).toBe(true);
	});

	test("--all --yes deletes distilled sessions non-interactively, skips undistilled", async () => {
		await runClean({ flags: { all: true, yes: true } });

		// Distilled session removed; undistilled one skipped (kept).
		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(false);
		expect(existsSync(sessionPath(tempDir, UNDISTILLED_ID))).toBe(true);
		expect(logs.join("\n")).toMatch(/Cleaned 1 session/);
		expect(logs.join("\n")).toMatch(/Skipping/);
	});

	test("--all --yes --force deletes every session including undistilled", async () => {
		await runClean({ flags: { all: true, yes: true, force: true } });

		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(false);
		expect(existsSync(sessionPath(tempDir, UNDISTILLED_ID))).toBe(false);
		expect(logs.join("\n")).toMatch(/Cleaned 2 session/);
	});

	test("interactive confirm: 'y' proceeds with the blanket delete", async () => {
		mockAnswer = "y";
		const stdin = process.stdin as { isTTY?: boolean };
		const prev = stdin.isTTY;
		stdin.isTTY = true;
		try {
			await runClean({ flags: { all: true } });
		} finally {
			stdin.isTTY = prev;
		}

		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(false);
	});

	test("interactive confirm: 'n' aborts and deletes nothing", async () => {
		mockAnswer = "n";
		const stdin = process.stdin as { isTTY?: boolean };
		const prev = stdin.isTTY;
		stdin.isTTY = true;
		try {
			await runClean({ flags: { all: true } });
		} finally {
			stdin.isTTY = prev;
		}

		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(true);
		expect(logs.join("\n")).toMatch(/Aborted/);
	});

	test("targeted clean of a distilled session removes only that session", async () => {
		await runClean({ sessionArg: DISTILLED_ID });

		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(false);
		expect(existsSync(sessionPath(tempDir, UNDISTILLED_ID))).toBe(true);
		expect(logs.join("\n")).toMatch(/Cleaned session 11111111/);
	});

	test("targeted clean of an undistilled session errors without --force", async () => {
		await expect(runClean({ sessionArg: UNDISTILLED_ID })).rejects.toThrow(/not been distilled/);
		expect(existsSync(sessionPath(tempDir, UNDISTILLED_ID))).toBe(true);
	});

	test("targeted clean of an undistilled session succeeds with --force", async () => {
		await runClean({ sessionArg: UNDISTILLED_ID, flags: { force: true } });
		expect(existsSync(sessionPath(tempDir, UNDISTILLED_ID))).toBe(false);
	});
});

// ── End-to-end happy path through the real CLI entrypoint ──
describe("clean command — e2e", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(
			tmpdir(),
			`clens-test-clean-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(join(tempDir, ".clens", "sessions"), { recursive: true });
		mkdirSync(join(tempDir, ".clens", "distilled"), { recursive: true });
		writeSession(tempDir, DISTILLED_ID, true);
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("`clens clean <id>` exits 0, reports freed space, and removes the file", async () => {
		const result = await runCli(["clean", DISTILLED_ID], tempDir);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/Cleaned session 11111111/);
		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(false);
	});

	test("`clens clean` with no target exits non-zero and deletes nothing", async () => {
		const result = await runCli(["clean"], tempDir);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toMatch(/Nothing to clean/);
		expect(existsSync(sessionPath(tempDir, DISTILLED_ID))).toBe(true);
	});
});

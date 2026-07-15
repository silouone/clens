import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DISTILL_SCHEMA_VERSION,
	distillAllGlobal,
	isDistilledFresh,
} from "../src/commands/distill";
import type { GlobalSessionSummary } from "../src/types/distill";

// Two-project fixture, injected directly (no registry / HOME dependency):
//  - project mode:    <tmp>/proj-a/.clens/sessions/<id>.jsonl
//  - repository mode: <tmp>/repo-b/packages/web/.clens/sessions/<id>.jsonl (nested)
const SESSION_A = "aaaaaaaa-1111-1111-1111-111111111111";
const SESSION_B = "bbbbbbbb-1111-1111-1111-111111111111";
const SESSION_MISSING = "cccccccc-1111-1111-1111-111111111111";

const makeEvent = (
	event: string,
	t: number,
	sid: string,
	data: Record<string, unknown> = {},
): string => JSON.stringify({ event, t, sid, data, context: { git_branch: "main" } });

const writeSessionFile = (captureDir: string, sid: string): void => {
	mkdirSync(join(captureDir, ".clens", "sessions"), { recursive: true });
	writeFileSync(
		join(captureDir, ".clens", "sessions", `${sid}.jsonl`),
		`${[
			makeEvent("SessionStart", 1000, sid, { source: "cli" }),
			makeEvent("PreToolUse", 1500, sid, {
				tool_name: "Read",
				tool_use_id: "u1",
				tool_input: { file_path: "a.ts" },
			}),
			makeEvent("PostToolUse", 1600, sid, {
				tool_name: "Read",
				tool_use_id: "u1",
				tool_input: { file_path: "a.ts" },
				tool_response: "ok",
			}),
			makeEvent("SessionEnd", 2000, sid, { reason: "done" }),
		].join("\n")}\n`,
	);
};

const makeGlobalSession = (
	sid: string,
	captureDir: string,
	projectName: string,
): GlobalSessionSummary => ({
	session_id: sid,
	start_time: 1000,
	duration_ms: 1000,
	event_count: 4,
	status: "complete",
	file_size_bytes: 100,
	project_id: projectName,
	project_name: projectName,
	capture_dir: captureDir,
});

const distilledPath = (captureDir: string, sid: string): string =>
	join(captureDir, ".clens", "distilled", `${sid}.json`);

describe("distill-global batch driver", () => {
	let tempDir: string;
	let projAdir: string;
	let nestedDir: string;
	let sessions: readonly GlobalSessionSummary[];

	beforeEach(() => {
		tempDir = join(
			tmpdir(),
			`clens-test-distill-global-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		projAdir = join(tempDir, "proj-a");
		nestedDir = join(tempDir, "repo-b", "packages", "web");

		writeSessionFile(projAdir, SESSION_A);
		writeSessionFile(nestedDir, SESSION_B);

		sessions = [
			makeGlobalSession(SESSION_A, projAdir, "proj-a"),
			makeGlobalSession(SESSION_B, nestedDir, "repo-b"),
		];
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("isDistilledFresh: false when distilled missing, true when newer + current schema", () => {
		const sf = join(projAdir, ".clens", "sessions", `${SESSION_A}.jsonl`);
		const df = distilledPath(projAdir, SESSION_A);
		expect(isDistilledFresh(sf, df)).toBe(false);
		mkdirSync(join(projAdir, ".clens", "distilled"), { recursive: true });
		// A distilled artifact with no schema_version is treated as stale (DIST-4).
		writeFileSync(df, "{}");
		expect(isDistilledFresh(sf, df)).toBe(false);
		// Newer than the session AND stamped with the current schema version -> fresh.
		writeFileSync(df, JSON.stringify({ schema_version: DISTILL_SCHEMA_VERSION }));
		expect(isDistilledFresh(sf, df)).toBe(true);
		// A mismatched schema version (e.g. after a bump) -> stale even though mtime is fine.
		writeFileSync(df, JSON.stringify({ schema_version: DISTILL_SCHEMA_VERSION + 1 }));
		expect(isDistilledFresh(sf, df)).toBe(false);
		// Pricing-tier drift relative to an explicit expected tier -> stale.
		writeFileSync(
			df,
			JSON.stringify({ schema_version: DISTILL_SCHEMA_VERSION, pricing_tier: "max" }),
		);
		expect(isDistilledFresh(sf, df, "api")).toBe(false);
		expect(isDistilledFresh(sf, df, "max")).toBe(true);
	});

	test("each session distills into its own capture dir (incl. nested repo)", async () => {
		const counts = await distillAllGlobal({ deep: false, force: false, sessions });

		expect(counts.distilled).toBe(2);
		expect(counts.skipped).toBe(0);
		expect(counts.failed).toBe(0);
		expect(counts.projectCount).toBe(2);

		// Project-mode session writes to its own dir.
		expect(existsSync(distilledPath(projAdir, SESSION_A))).toBe(true);
		// Nested repo session routes to the nested capture dir, not the git root.
		expect(existsSync(distilledPath(nestedDir, SESSION_B))).toBe(true);
		expect(existsSync(join(tempDir, "repo-b", ".clens", "distilled", `${SESSION_B}.json`))).toBe(
			false,
		);
	});

	test("second run with no changes skips all (incremental)", async () => {
		await distillAllGlobal({ deep: false, force: false, sessions });
		const second = await distillAllGlobal({ deep: false, force: false, sessions });

		expect(second.distilled).toBe(0);
		expect(second.skipped).toBe(2);
		expect(second.failed).toBe(0);
	});

	test("force re-distills all even when fresh", async () => {
		await distillAllGlobal({ deep: false, force: false, sessions });
		const forced = await distillAllGlobal({ deep: false, force: true, sessions });

		expect(forced.distilled).toBe(2);
		expect(forced.skipped).toBe(0);
	});

	test("a session with no backing file is counted failed; others still complete", async () => {
		const withBad = [
			...sessions,
			makeGlobalSession(SESSION_MISSING, join(tempDir, "ghost"), "ghost"),
		];
		const counts = await distillAllGlobal({ deep: false, force: false, sessions: withBad });

		expect(counts.failed).toBe(1);
		expect(counts.distilled).toBe(2);
		expect(existsSync(distilledPath(projAdir, SESSION_A))).toBe(true);
		expect(existsSync(distilledPath(nestedDir, SESSION_B))).toBe(true);
	});

	test("throws a clean error when no sessions exist", async () => {
		await expect(distillAllGlobal({ deep: false, force: false, sessions: [] })).rejects.toThrow(
			/No sessions found across registered projects/,
		);
	});
});

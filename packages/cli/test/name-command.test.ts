import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nameCommand } from "../src/commands/name";
import { enrichSessionSummaries, listSessions } from "../src/session/read";
import { readSessionMeta } from "../src/session/session-meta";

const TMP_ROOT = join(import.meta.dir, "tmp-name-cmd");

let counter = 0;
const setupProject = (sessionId: string, prompt: string): string => {
	counter += 1;
	const dir = join(TMP_ROOT, `case-${counter}`);
	try {
		rmSync(dir, { recursive: true });
	} catch {
		/* ignore */
	}
	mkdirSync(join(dir, ".clens", "sessions"), { recursive: true });
	const now = Date.now();
	writeFileSync(
		join(dir, ".clens", "sessions", `${sessionId}.jsonl`),
		[
			JSON.stringify({ event: "SessionStart", t: now, data: { source: "startup" }, context: {} }),
			JSON.stringify({ event: "UserPromptSubmit", t: now + 10, data: { prompt }, context: {} }),
			JSON.stringify({ event: "SessionEnd", t: now + 20, data: { reason: "clear" }, context: {} }),
		].join("\n"),
	);
	return dir;
};

const resolveRow = (dir: string, sessionId: string) =>
	enrichSessionSummaries(listSessions(dir), dir).find((s) => s.session_id === sessionId);

describe("nameCommand", () => {
	test("computed name derives from first prompt when no label (AC1)", () => {
		const sid = "aaaa1111-2222-3333";
		const dir = setupProject(sid, "Fix the analyze session button");
		const row = resolveRow(dir, sid);
		expect(row?.display_name).toBe("Fix the analyze session button");
		expect(row?.name_source).toBe("computed");
	});

	test("setting a label makes it the display name (AC7)", () => {
		const sid = "bbbb1111-2222-3333";
		const dir = setupProject(sid, "Fix the analyze session button");
		nameCommand({
			sessionArg: "bbbb",
			projectDir: dir,
			label: "Auth refactor",
			color: "amber",
			clear: false,
			json: false,
		});
		const meta = readSessionMeta(dir)[sid];
		expect(meta?.label).toBe("Auth refactor");
		expect(meta?.color).toBe("amber");
		const row = resolveRow(dir, sid);
		expect(row?.display_name).toBe("Auth refactor");
		expect(row?.name_source).toBe("label");
		expect(row?.color).toBe("amber");
	});

	test("--clear reverts to computed name and unflags (AC7)", () => {
		const sid = "cccc1111-2222-3333";
		const dir = setupProject(sid, "Implement plan drift view");
		nameCommand({
			sessionArg: "cccc",
			projectDir: dir,
			label: "Temp",
			color: "blue",
			clear: false,
			json: false,
		});
		nameCommand({
			sessionArg: "cccc",
			projectDir: dir,
			label: undefined,
			color: undefined,
			clear: true,
			json: false,
		});
		expect(readSessionMeta(dir)[sid]).toBeUndefined();
		const row = resolveRow(dir, sid);
		expect(row?.display_name).toBe("Implement plan drift view");
		expect(row?.name_source).toBe("computed");
		expect(row?.color).toBeUndefined();
	});

	test("rejects an invalid color (R14)", () => {
		const sid = "dddd1111-2222-3333";
		const dir = setupProject(sid, "Hello");
		expect(() =>
			nameCommand({
				sessionArg: "dddd",
				projectDir: dir,
				label: undefined,
				color: "rainbow",
				clear: false,
				json: false,
			}),
		).toThrow();
		expect(readSessionMeta(dir)[sid]).toBeUndefined();
	});

	test("label survives when raw session data is removed (AC5)", () => {
		const sid = "eeee1111-2222-3333";
		const dir = setupProject(sid, "Hello");
		nameCommand({
			sessionArg: "eeee",
			projectDir: dir,
			label: "Keeper",
			color: "green",
			clear: false,
			json: false,
		});
		// Simulate `clens clean`: remove the raw session JSONL only.
		rmSync(join(dir, ".clens", "sessions", `${sid}.jsonl`));
		const meta = readSessionMeta(dir)[sid];
		expect(meta?.label).toBe("Keeper");
		expect(meta?.color).toBe("green");
	});
});

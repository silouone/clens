import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	readSessionMeta,
	sessionMetaPath,
	setSessionMeta,
	writeSessionMeta,
} from "../src/session/session-meta";

const TMP_ROOT = join(import.meta.dir, "tmp-session-meta");

let counter = 0;
const freshDir = (): string => {
	counter += 1;
	const dir = join(TMP_ROOT, `case-${counter}`);
	try {
		rmSync(dir, { recursive: true });
	} catch {
		/* ignore */
	}
	mkdirSync(dir, { recursive: true });
	return dir;
};

describe("readSessionMeta", () => {
	test("returns {} when sidecar is missing", () => {
		const dir = freshDir();
		expect(readSessionMeta(dir)).toEqual({});
	});

	test("returns {} when sidecar is malformed (R15)", () => {
		const dir = freshDir();
		mkdirSync(join(dir, ".clens"), { recursive: true });
		writeFileSync(sessionMetaPath(dir), "{ not valid json ::::");
		expect(readSessionMeta(dir)).toEqual({});
	});

	test("returns {} when sidecar JSON is not an object", () => {
		const dir = freshDir();
		mkdirSync(join(dir, ".clens"), { recursive: true });
		writeFileSync(sessionMetaPath(dir), "[1,2,3]");
		expect(readSessionMeta(dir)).toEqual({});
	});

	test("ignores malformed individual entries but keeps valid ones", () => {
		const dir = freshDir();
		mkdirSync(join(dir, ".clens"), { recursive: true });
		writeFileSync(
			sessionMetaPath(dir),
			JSON.stringify({
				good: { label: "Keep me", color: "amber", updated_at: 1 },
				badColor: { color: "rainbow", updated_at: 2 },
				notObject: "nope",
			}),
		);
		const meta = readSessionMeta(dir);
		expect(meta.good).toEqual({ label: "Keep me", color: "amber", updated_at: 1 });
		// invalid color dropped, entry still present without it
		expect(meta.badColor?.color).toBeUndefined();
		expect(meta.notObject).toBeUndefined();
	});
});

describe("writeSessionMeta (atomic round-trip)", () => {
	test("writes and reads back the same map", () => {
		const dir = freshDir();
		const map = {
			s1: { label: "First", color: "green" as const, updated_at: 100 },
			s2: { color: "red" as const, updated_at: 200 },
		};
		writeSessionMeta(dir, map);
		expect(readSessionMeta(dir)).toEqual(map);
	});

	test("creates the .clens directory if missing", () => {
		const dir = freshDir();
		writeSessionMeta(dir, { s1: { label: "x", updated_at: 1 } });
		expect(existsSync(sessionMetaPath(dir))).toBe(true);
	});

	test("leaves no temp files behind", () => {
		const dir = freshDir();
		writeSessionMeta(dir, { s1: { label: "x", updated_at: 1 } });
		const files = readdirSync(join(dir, ".clens"));
		expect(files.filter((f) => f.includes("tmp") || f.endsWith(".tmp"))).toHaveLength(0);
	});
});

describe("setSessionMeta", () => {
	test("sets a label (R6)", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { label: "My Label" });
		expect(readSessionMeta(dir).s1?.label).toBe("My Label");
	});

	test("sets a color (R10)", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { color: "violet" });
		expect(readSessionMeta(dir).s1?.color).toBe("violet");
	});

	test("clears label when passed null (R7)", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { label: "x", color: "blue" });
		setSessionMeta(dir, "s1", { label: null });
		const meta = readSessionMeta(dir).s1;
		expect(meta?.label).toBeUndefined();
		expect(meta?.color).toBe("blue"); // color untouched
	});

	test("treats whitespace-only label as a clear (R8)", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { label: "x" });
		setSessionMeta(dir, "s1", { label: "   " });
		expect(readSessionMeta(dir).s1?.label).toBeUndefined();
	});

	test("clears color when set to none (R13)", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { color: "red" });
		setSessionMeta(dir, "s1", { color: "none" });
		expect(readSessionMeta(dir).s1?.color).toBeUndefined();
	});

	test("clears color when passed null", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { color: "red" });
		setSessionMeta(dir, "s1", { color: null });
		expect(readSessionMeta(dir).s1?.color).toBeUndefined();
	});

	test("rejects an invalid color and leaves metadata unchanged (R14)", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { label: "Keep", color: "green" });
		expect(() => setSessionMeta(dir, "s1", { color: "rainbow" as never })).toThrow();
		const meta = readSessionMeta(dir).s1;
		expect(meta?.label).toBe("Keep");
		expect(meta?.color).toBe("green");
	});

	test("removes the entry entirely when both fields cleared", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { label: "x", color: "amber" });
		setSessionMeta(dir, "s1", { label: null, color: "none" });
		expect(readSessionMeta(dir).s1).toBeUndefined();
	});

	test("does not disturb other sessions' metadata", () => {
		const dir = freshDir();
		setSessionMeta(dir, "s1", { label: "one" });
		setSessionMeta(dir, "s2", { color: "blue" });
		const meta = readSessionMeta(dir);
		expect(meta.s1?.label).toBe("one");
		expect(meta.s2?.color).toBe("blue");
	});

	test("bumps updated_at on write", () => {
		const dir = freshDir();
		const before = Date.now();
		setSessionMeta(dir, "s1", { label: "x" });
		const ts = readSessionMeta(dir).s1?.updated_at ?? 0;
		expect(ts).toBeGreaterThanOrEqual(before);
	});
});

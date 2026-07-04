import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import {
	formatBytes,
	formatDuration,
	isUuidLike,
	resolveProjectRoot,
	sanitizeAgentName,
} from "../src/utils";

describe("formatDuration", () => {
	test("0ms", () => {
		expect(formatDuration(0)).toBe("0ms");
	});

	test("500ms", () => {
		expect(formatDuration(500)).toBe("500ms");
	});

	test("999ms", () => {
		expect(formatDuration(999)).toBe("999ms");
	});

	test("1000ms → 1s", () => {
		expect(formatDuration(1000)).toBe("1s");
	});

	test("59000ms → 59s", () => {
		expect(formatDuration(59000)).toBe("59s");
	});

	test("60000ms → 1m", () => {
		expect(formatDuration(60000)).toBe("1m");
	});

	test("3599000ms → 59m", () => {
		expect(formatDuration(3599000)).toBe("59m");
	});

	test("3600000ms → 1h0m", () => {
		expect(formatDuration(3600000)).toBe("1h0m");
	});

	test("5400000ms → 1h30m", () => {
		expect(formatDuration(5400000)).toBe("1h30m");
	});
});

describe("formatBytes", () => {
	test("0 → 0B", () => {
		expect(formatBytes(0)).toBe("0B");
	});

	test("1023 → 1023B", () => {
		expect(formatBytes(1023)).toBe("1023B");
	});

	test("1024 → 1.0KB", () => {
		expect(formatBytes(1024)).toBe("1.0KB");
	});

	test("1048576 → 1.0MB", () => {
		expect(formatBytes(1048576)).toBe("1.0MB");
	});

	test("1073741824 → 1.0GB", () => {
		expect(formatBytes(1073741824)).toBe("1.0GB");
	});
});

describe("isUuidLike", () => {
	test("long hex string returns true", () => {
		expect(isUuidLike("a28e35948fb8bc659")).toBe(true);
	});

	test("prefixed name returns false", () => {
		expect(isUuidLike("builder-a28e")).toBe(false);
	});

	test("dashed UUID returns false", () => {
		expect(isUuidLike("b75e880b-5334-4720-92ca-05db84f8d746")).toBe(false);
	});

	test("short hex string returns false", () => {
		expect(isUuidLike("a28e3594")).toBe(false);
	});
});

describe("sanitizeAgentName", () => {
	test("undefined rawName returns truncated id", () => {
		expect(sanitizeAgentName(undefined, "a28e35948fb8bc659")).toBe("a28e3594");
	});

	test("UUID-like rawName returns truncated id", () => {
		expect(sanitizeAgentName("a28e35948fb8bc659", "a28e35948fb8bc659")).toBe("a28e3594");
	});

	test("non-UUID rawName returns as-is", () => {
		expect(sanitizeAgentName("builder-types", "abc123")).toBe("builder-types");
	});

	test("empty rawName returns truncated id", () => {
		expect(sanitizeAgentName("", "a28e35948fb8bc659")).toBe("a28e3594");
	});
});

describe("resolveProjectRoot", () => {
	const ROOT = `/tmp/clens-test-resolve-root-${process.pid}`;

	beforeEach(() => {
		rmSync(ROOT, { recursive: true, force: true });
		mkdirSync(`${ROOT}/.clens/sessions`, { recursive: true });
		mkdirSync(`${ROOT}/packages/web/src/client/assets`, { recursive: true });
	});

	afterEach(() => {
		rmSync(ROOT, { recursive: true, force: true });
	});

	test("walks up from a nested cwd to the .clens project root", () => {
		expect(resolveProjectRoot(`${ROOT}/packages/web/src/client/assets`)).toBe(ROOT);
	});

	test("returns the start dir when it already contains .clens", () => {
		expect(resolveProjectRoot(ROOT)).toBe(ROOT);
	});

	test("prefers a nearer .clens over a farther .clens parent", () => {
		mkdirSync(`${ROOT}/packages/web/.clens`, { recursive: true });
		expect(resolveProjectRoot(`${ROOT}/packages/web/src/client/assets`)).toBe(
			`${ROOT}/packages/web`,
		);
	});

	test("falls back to .git when no .clens exists on the path", () => {
		rmSync(`${ROOT}/.clens`, { recursive: true, force: true });
		mkdirSync(`${ROOT}/.git`, { recursive: true });
		expect(resolveProjectRoot(`${ROOT}/packages/web/src/client/assets`)).toBe(ROOT);
	});

	test("falls back to the start dir when neither .clens nor .git is found", () => {
		const orphan = `${ROOT}/packages/web/src/client/assets`;
		rmSync(`${ROOT}/.clens`, { recursive: true, force: true });
		expect(resolveProjectRoot(orphan)).toBe(orphan);
	});
});

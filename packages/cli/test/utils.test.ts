import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

const markersIn = (dir: string) => [".clens", ".git"].filter((m) => existsSync(join(dir, m)));

// @adw clens-014#R1,R2: every root is a private mkdtemp dir; fallback cases use an injected
// fake `exists` so no parent marker on the host can change the result.
describe("resolveProjectRoot", () => {
	const ROOT_PREFIX = join(tmpdir(), "clens-test-resolve-root-");
	const seenRoots: string[] = [];
	let ROOT: string;

	beforeEach(() => {
		ROOT = mkdtempSync(ROOT_PREFIX);
		seenRoots.push(ROOT);
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
		const markers = new Set(["/p/.git"]);
		expect(resolveProjectRoot("/p/a/b/c", (path) => markers.has(path))).toBe("/p");
	});

	test("falls back to the start dir when neither .clens nor .git is found", () => {
		expect(resolveProjectRoot("/p/a/b/c", () => false)).toBe("/p/a/b/c");
	});

	test("prefers .clens over a nearer .git", () => {
		const markers = new Set(["/p/.clens", "/p/a/.git"]);
		expect(resolveProjectRoot("/p/a/b", (path) => markers.has(path))).toBe("/p");
	});

	// @adw clens-014#R2: boundary cases of the injected predicate — no real fs, so host-immune.
	test("returns the start dir when it contains the .git marker itself", () => {
		const markers = new Set(["/p/a/b/.git"]);
		expect(resolveProjectRoot("/p/a/b", (path) => markers.has(path))).toBe("/p/a/b");
	});

	test("finds a .clens at the filesystem root", () => {
		const markers = new Set(["/.clens"]);
		expect(resolveProjectRoot("/p/a", (path) => markers.has(path))).toBe("/");
	});

	test("terminates at the filesystem root when started there with no markers", () => {
		expect(resolveProjectRoot("/", () => false)).toBe("/");
	});

	test("probes every .clens level before any .git level, nearest first", () => {
		const probed: string[] = [];
		const result = resolveProjectRoot("/p/a", (path) => {
			probed.push(path);
			return false;
		});
		expect(result).toBe("/p/a");
		expect(probed).toEqual([
			"/p/a/.clens",
			"/p/.clens",
			"/.clens",
			"/p/a/.git",
			"/p/.git",
			"/.git",
		]);
	});

	test("stops probing at the first .clens hit", () => {
		const probed: string[] = [];
		const result = resolveProjectRoot("/p/a/b", (path) => {
			probed.push(path);
			return path === "/p/a/.clens";
		});
		expect(result).toBe("/p/a");
		expect(probed).toEqual(["/p/a/b/.clens", "/p/a/.clens"]);
	});

	test("ignores a .clens in the parent of the project root", () => {
		const outer = mkdtempSync(ROOT_PREFIX);
		try {
			mkdirSync(`${outer}/.clens`, { recursive: true });
			mkdirSync(`${outer}/proj/.clens`, { recursive: true });
			mkdirSync(`${outer}/proj/sub`, { recursive: true });
			expect(resolveProjectRoot(`${outer}/proj/sub`)).toBe(`${outer}/proj`);
		} finally {
			rmSync(outer, { recursive: true, force: true });
		}
	});

	test("R1: owns a private mkdtemp root and writes no marker to its parent", () => {
		expect(ROOT.startsWith(ROOT_PREFIX)).toBe(true);
		expect(ROOT).not.toBe(`/tmp/clens-test-resolve-root-${process.pid}`);
		const before = markersIn(dirname(ROOT));
		resolveProjectRoot(join(ROOT, "packages/web/src/client/assets"));
		expect(markersIn(dirname(ROOT))).toEqual(before);
	});

	test("R1: previous test roots were removed by afterEach", () => {
		expect(new Set(seenRoots).size).toBe(seenRoots.length);
		const previous = seenRoots.filter((root) => root !== ROOT);
		expect(previous.length).toBeGreaterThan(0);
		expect(previous.filter((root) => existsSync(root))).toEqual([]);
	});
});

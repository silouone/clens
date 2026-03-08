import { describe, expect, test } from "bun:test";
import { diffLinesToUnified } from "../src/utils";
import type { DiffLine } from "../src/types";

describe("diffLinesToUnified", () => {
	test("returns empty string for empty lines", () => {
		expect(diffLinesToUnified("src/foo.ts", [])).toBe("");
	});

	test("generates correct --- and +++ headers", () => {
		const lines: readonly DiffLine[] = [
			{ type: "add", content: "hello" },
		];
		const result = diffLinesToUnified("src/foo.ts", lines);
		expect(result).toContain("--- a/src/foo.ts");
		expect(result).toContain("+++ b/src/foo.ts");
	});

	test("generates correct @@ hunk header for adds only", () => {
		const lines: readonly DiffLine[] = [
			{ type: "add", content: "line1" },
			{ type: "add", content: "line2" },
		];
		const result = diffLinesToUnified("file.ts", lines);
		// 0 old lines (no removes or context), 2 new lines
		expect(result).toContain("@@ -1,0 +1,2 @@");
	});

	test("generates correct @@ hunk header for removes only", () => {
		const lines: readonly DiffLine[] = [
			{ type: "remove", content: "old1" },
			{ type: "remove", content: "old2" },
			{ type: "remove", content: "old3" },
		];
		const result = diffLinesToUnified("file.ts", lines);
		// 3 old lines, 0 new lines
		expect(result).toContain("@@ -1,3 +1,0 @@");
	});

	test("generates correct @@ hunk header for mixed changes", () => {
		const lines: readonly DiffLine[] = [
			{ type: "context", content: "unchanged" },
			{ type: "remove", content: "old" },
			{ type: "add", content: "new" },
			{ type: "context", content: "also unchanged" },
		];
		const result = diffLinesToUnified("file.ts", lines);
		// old: 2 context + 1 remove = 3, new: 2 context + 1 add = 3
		expect(result).toContain("@@ -1,3 +1,3 @@");
	});

	test("prefixes add lines with +", () => {
		const lines: readonly DiffLine[] = [
			{ type: "add", content: "new line" },
		];
		const result = diffLinesToUnified("f.ts", lines);
		expect(result).toContain("+new line");
	});

	test("prefixes remove lines with -", () => {
		const lines: readonly DiffLine[] = [
			{ type: "remove", content: "old line" },
		];
		const result = diffLinesToUnified("f.ts", lines);
		expect(result).toContain("-old line");
	});

	test("prefixes context lines with space", () => {
		const lines: readonly DiffLine[] = [
			{ type: "context", content: "same line" },
		];
		const result = diffLinesToUnified("f.ts", lines);
		expect(result).toContain(" same line");
	});

	test("full unified diff output for mixed changes", () => {
		const lines: readonly DiffLine[] = [
			{ type: "context", content: "const a = 1;" },
			{ type: "remove", content: "const b = 2;" },
			{ type: "add", content: "const b = 3;" },
			{ type: "context", content: "const c = 4;" },
		];
		const result = diffLinesToUnified("src/index.ts", lines);
		const expected = [
			"--- a/src/index.ts",
			"+++ b/src/index.ts",
			"@@ -1,3 +1,3 @@",
			" const a = 1;",
			"-const b = 2;",
			"+const b = 3;",
			" const c = 4;",
		].join("\n");
		expect(result).toBe(expected);
	});

	test("all additions", () => {
		const lines: readonly DiffLine[] = [
			{ type: "add", content: "line 1" },
			{ type: "add", content: "line 2" },
			{ type: "add", content: "line 3" },
		];
		const result = diffLinesToUnified("new-file.ts", lines);
		const expected = [
			"--- a/new-file.ts",
			"+++ b/new-file.ts",
			"@@ -1,0 +1,3 @@",
			"+line 1",
			"+line 2",
			"+line 3",
		].join("\n");
		expect(result).toBe(expected);
	});

	test("all deletions", () => {
		const lines: readonly DiffLine[] = [
			{ type: "remove", content: "gone 1" },
			{ type: "remove", content: "gone 2" },
		];
		const result = diffLinesToUnified("deleted.ts", lines);
		const expected = [
			"--- a/deleted.ts",
			"+++ b/deleted.ts",
			"@@ -1,2 +1,0 @@",
			"-gone 1",
			"-gone 2",
		].join("\n");
		expect(result).toBe(expected);
	});
});

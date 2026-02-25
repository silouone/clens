import { describe, expect, test } from "bun:test";
import {
	computePlanDrift,
	detectSpecRef,
	extractActualFiles,
	parseSpecExpectedFiles,
} from "../src/distill/plan-drift";
import type { FileMapEntry, FileMapResult } from "../src/types";

// --- Helpers ---

const makeFileMapEntry = (
	overrides: Partial<FileMapEntry> & { file_path: string },
): FileMapEntry => ({
	reads: 0,
	edits: 0,
	writes: 0,
	errors: 0,
	tool_use_ids: [],
	...overrides,
});

const makeFileMapResult = (entries: readonly FileMapEntry[]): FileMapResult => ({
	files: [...entries],
});

// =============================================================================
// parseSpecExpectedFiles
// =============================================================================

describe("parseSpecExpectedFiles", () => {
	test("returns empty array for empty content", () => {
		expect(parseSpecExpectedFiles("")).toEqual([]);
	});

	test("returns empty array for content with no file references", () => {
		const content = `# Overview\n\nThis is a description of the project.\n\n## Goals\n\n- Be fast\n- Be correct`;
		expect(parseSpecExpectedFiles(content)).toEqual([]);
	});

	test("extracts backtick paths from a Files section", () => {
		const content = [
			"# Plan",
			"",
			"## Files to Create",
			"",
			"- `src/distill/plan-drift.ts`",
			"- `test/distill-plan-drift.test.ts`",
			"",
			"## Other Section",
			"",
			"Some text.",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/distill/plan-drift.ts",
			"test/distill-plan-drift.test.ts",
		]);
	});

	test("extracts bare paths with file extensions from a Files section", () => {
		const content = ["## Relevant Files", "", "- src/types/distill.ts", "- src/utils.ts"].join(
			"\n",
		);
		expect(parseSpecExpectedFiles(content)).toEqual(["src/types/distill.ts", "src/utils.ts"]);
	});

	test("extracts bold paths from a Files section", () => {
		const content = [
			"## New Files",
			"",
			"- **src/distill/plan-drift.ts**",
			"- **test/plan-drift.test.ts**",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/distill/plan-drift.ts",
			"test/plan-drift.test.ts",
		]);
	});

	test("recognizes multiple section heading keywords", () => {
		const content = [
			"## Deliverables",
			"- `src/a.ts`",
			"## Modified Files",
			"- `src/b.ts`",
			"## Create",
			"- `src/c.ts`",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
	});

	test("stops extracting bullets when a non-files heading is hit", () => {
		const content = [
			"## Files",
			"- `src/a.ts`",
			"## Implementation Details",
			"- `src/not-a-file-ref.ts`",
		].join("\n");
		// The second bullet is under a non-files heading, so not extracted as a bullet
		// But it also doesn't match prefix patterns, so it should be excluded
		expect(parseSpecExpectedFiles(content)).toEqual(["src/a.ts"]);
	});

	test("extracts Create: and Modify: prefixed lines from anywhere", () => {
		const content = [
			"# Plan",
			"",
			"Create: `src/new-file.ts`",
			"Modify: src/existing.ts",
			"File: src/types/index.ts",
			"",
			"Some unrelated text.",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/existing.ts",
			"src/new-file.ts",
			"src/types/index.ts",
		]);
	});

	test("deduplicates paths", () => {
		const content = ["## Files", "- `src/a.ts`", "- `src/a.ts`", "Create: src/a.ts"].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/a.ts"]);
	});

	test("normalizes paths by stripping leading ./", () => {
		const content = ["## Files", "- `./src/a.ts`", "Create: ./src/b.ts"].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/a.ts", "src/b.ts"]);
	});

	test("returns sorted results", () => {
		const content = ["## Files", "- `src/z.ts`", "- `src/a.ts`", "- `src/m.ts`"].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
	});

	test("handles asterisk bullets in addition to dash bullets", () => {
		const content = ["## File Deliverables", "* `src/alpha.ts`", "* `src/beta.ts`"].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/alpha.ts", "src/beta.ts"]);
	});

	test("rejects function signatures containing parentheses", () => {
		const content = [
			"## Files",
			"- `aggregateTeamData(...)`",
			"- `computePlanDrift(specPath, specContent)`",
			"- `src/valid-file.ts`",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/valid-file.ts"]);
	});

	test("rejects bold function signatures with parentheses", () => {
		const content = [
			"## Files",
			"- **buildGraph(nodes)**",
			"- **src/graph.ts**",
		].join("\n");
		// buildGraph(nodes) has parens but also no file extension, so double-filtered
		// src/graph.ts is valid
		expect(parseSpecExpectedFiles(content)).toEqual(["src/graph.ts"]);
	});

	test("extracts paths from fenced code blocks", () => {
		const content = [
			"# Plan",
			"",
			"```",
			"src/distill/plan-drift.ts",
			"test/plan-drift.test.ts",
			"```",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/distill/plan-drift.ts",
			"test/plan-drift.test.ts",
		]);
	});

	test("skips code syntax lines inside fenced code blocks", () => {
		const content = [
			"```ts",
			"import { foo } from './bar';",
			"const x = foo();",
			"src/real/path.ts",
			"```",
		].join("\n");
		// import and const lines are skipped; only the bare path is extracted
		expect(parseSpecExpectedFiles(content)).toEqual(["src/real/path.ts"]);
	});

	test("extracts paths from table rows", () => {
		const content = [
			"| File | Description |",
			"|------|-------------|",
			"| src/distill/stats.ts | Statistics extraction |",
			"| src/types/distill.ts | Type definitions |",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/distill/stats.ts",
			"src/types/distill.ts",
		]);
	});

	test("extracts backtick-wrapped paths from table rows", () => {
		const content = [
			"| File | Action |",
			"|------|--------|",
			"| `src/distill/index.ts` | Modify |",
			"| `test/distill.test.ts` | Create |",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/distill/index.ts",
			"test/distill.test.ts",
		]);
	});

	test("extracts inline backtick paths from non-bullet text", () => {
		const content = [
			"# Overview",
			"",
			"We need to modify `src/distill/plan-drift.ts` and also update `src/types/distill.ts` accordingly.",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/distill/plan-drift.ts",
			"src/types/distill.ts",
		]);
	});

	test("does not double-extract backtick paths from bullet lines", () => {
		const content = [
			"## Files to Create",
			"- `src/new-file.ts`",
		].join("\n");
		// Should not appear twice despite both bullet and inline extractors matching
		expect(parseSpecExpectedFiles(content)).toEqual(["src/new-file.ts"]);
	});

	test("skips command-like strings in inline backticks", () => {
		const content = [
			"Run `bun test` and `npm install` then check `src/app.ts`.",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/app.ts"]);
	});

	test("skips command-like lines in code blocks", () => {
		const content = [
			"```",
			"bun run typecheck",
			"git status",
			"src/distill/stats.ts",
			"```",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual(["src/distill/stats.ts"]);
	});

	test("handles mixed code blocks, tables, and inline backticks", () => {
		const content = [
			"# Implementation Plan",
			"",
			"Modify `src/distill/index.ts` as the main orchestrator.",
			"",
			"## Files",
			"",
			"| File | Action |",
			"|------|--------|",
			"| src/types/distill.ts | Update |",
			"",
			"```",
			"src/distill/stats.ts",
			"src/distill/aggregate.ts",
			"```",
		].join("\n");
		expect(parseSpecExpectedFiles(content)).toEqual([
			"src/distill/aggregate.ts",
			"src/distill/index.ts",
			"src/distill/stats.ts",
			"src/types/distill.ts",
		]);
	});

	test("inline backtick extraction requires / in path", () => {
		const content = [
			"Check `README.md` and `src/app.ts` for details.",
		].join("\n");
		// README.md has no /, so only src/app.ts is extracted
		expect(parseSpecExpectedFiles(content)).toEqual(["src/app.ts"]);
	});
});

// =============================================================================
// extractActualFiles
// =============================================================================

describe("extractActualFiles", () => {
	test("returns empty array for empty file maps", () => {
		expect(extractActualFiles([])).toEqual([]);
	});

	test("returns empty array when file map has no files", () => {
		expect(extractActualFiles([makeFileMapResult([])])).toEqual([]);
	});

	test("includes files with edits > 0", () => {
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/a.ts", edits: 3 }),
			makeFileMapEntry({ file_path: "src/b.ts", edits: 1 }),
		]);
		expect(extractActualFiles([fm])).toEqual(["src/a.ts", "src/b.ts"]);
	});

	test("includes files with writes > 0", () => {
		const fm = makeFileMapResult([makeFileMapEntry({ file_path: "src/new.ts", writes: 1 })]);
		expect(extractActualFiles([fm])).toEqual(["src/new.ts"]);
	});

	test("excludes files with only reads", () => {
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/read-only.ts", reads: 5 }),
			makeFileMapEntry({ file_path: "src/edited.ts", edits: 1, reads: 2 }),
		]);
		expect(extractActualFiles([fm])).toEqual(["src/edited.ts"]);
	});

	test("excludes files with only errors and reads", () => {
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/errored.ts", errors: 2, reads: 1 }),
		]);
		expect(extractActualFiles([fm])).toEqual([]);
	});

	test("combines files from multiple file maps", () => {
		const fm1 = makeFileMapResult([makeFileMapEntry({ file_path: "src/a.ts", edits: 1 })]);
		const fm2 = makeFileMapResult([makeFileMapEntry({ file_path: "src/b.ts", writes: 1 })]);
		expect(extractActualFiles([fm1, fm2])).toEqual(["src/a.ts", "src/b.ts"]);
	});

	test("deduplicates across file maps", () => {
		const fm1 = makeFileMapResult([makeFileMapEntry({ file_path: "src/a.ts", edits: 1 })]);
		const fm2 = makeFileMapResult([makeFileMapEntry({ file_path: "src/a.ts", writes: 2 })]);
		expect(extractActualFiles([fm1, fm2])).toEqual(["src/a.ts"]);
	});

	test("returns sorted results", () => {
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/z.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/m.ts", writes: 1 }),
		]);
		expect(extractActualFiles([fm])).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
	});
});

// =============================================================================
// computePlanDrift
// =============================================================================

describe("computePlanDrift", () => {
	test("perfect adherence yields score 0", () => {
		const spec = ["## Files", "- `src/a.ts`", "- `src/b.ts`"].join("\n");
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/b.ts", writes: 1 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm]);
		expect(result.drift_score).toBe(0);
		expect(result.unexpected_files).toEqual([]);
		expect(result.missing_files).toEqual([]);
		expect(result.spec_path).toBe("specs/plan.md");
	});

	test("partial drift with missing and unexpected files", () => {
		const spec = ["## Files", "- `src/a.ts`", "- `src/b.ts`", "- `src/c.ts`"].join("\n");
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/d.ts", writes: 1 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm]);
		expect(result.missing_files).toEqual(["src/b.ts", "src/c.ts"]);
		expect(result.unexpected_files).toEqual(["src/d.ts"]);
		// drift = (2 missing + 1 unexpected) / 3 expected = 1.0
		expect(result.drift_score).toBe(1);
	});

	test("drift score capped at 1 even with extreme drift", () => {
		const spec = ["## Files", "- `src/a.ts`"].join("\n");
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/x.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/y.ts", writes: 1 }),
			makeFileMapEntry({ file_path: "src/z.ts", edits: 1 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm]);
		// 1 missing + 3 unexpected = 4, / max(1, 1) = 4, capped at 1
		expect(result.drift_score).toBe(1);
		expect(result.missing_files).toEqual(["src/a.ts"]);
		expect(result.unexpected_files).toEqual(["src/x.ts", "src/y.ts", "src/z.ts"]);
	});

	test("empty spec with actual files yields drift 1", () => {
		const fm = makeFileMapResult([makeFileMapEntry({ file_path: "src/a.ts", edits: 1 })]);
		const result = computePlanDrift("specs/empty.md", "", [fm]);
		// expected = 0, unexpected = 1, missing = 0
		// drift = 1 / max(0, 1) = 1
		expect(result.drift_score).toBe(1);
		expect(result.expected_files).toEqual([]);
		expect(result.unexpected_files).toEqual(["src/a.ts"]);
	});

	test("empty spec and no actual files yields score 0", () => {
		const result = computePlanDrift("specs/empty.md", "", []);
		expect(result.drift_score).toBe(0);
		expect(result.expected_files).toEqual([]);
		expect(result.actual_files).toEqual([]);
	});

	test("returns correct expected and actual arrays", () => {
		const spec = ["## Files", "- `src/a.ts`", "- `src/b.ts`"].join("\n");
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/b.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/c.ts", writes: 1 }),
			makeFileMapEntry({ file_path: "src/d.ts", reads: 5 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm]);
		expect(result.expected_files).toEqual(["src/a.ts", "src/b.ts"]);
		expect(result.actual_files).toEqual(["src/b.ts", "src/c.ts"]);
		expect(result.missing_files).toEqual(["src/a.ts"]);
		expect(result.unexpected_files).toEqual(["src/c.ts"]);
		// drift = (1 + 1) / 2 = 1.0
		expect(result.drift_score).toBe(1);
	});

	test("moderate drift score is a fraction", () => {
		const spec = ["## Files", "- `src/a.ts`", "- `src/b.ts`", "- `src/c.ts`", "- `src/d.ts`"].join(
			"\n",
		);
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/b.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "src/c.ts", writes: 1 }),
			makeFileMapEntry({ file_path: "src/e.ts", writes: 1 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm]);
		// missing: d.ts (1), unexpected: e.ts (1) => drift = 2/4 = 0.5
		expect(result.drift_score).toBe(0.5);
	});

	test("normalizes absolute actual paths to relative before comparison", () => {
		const spec = ["## Files", "- `src/app.ts`", "- `src/utils.ts`"].join("\n");
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "/Users/foo/project/src/app.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "/Users/foo/project/src/utils.ts", writes: 1 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm], "/Users/foo/project");
		expect(result.drift_score).toBe(0);
		expect(result.unexpected_files).toEqual([]);
		expect(result.missing_files).toEqual([]);
	});

	test("normalizes mixed absolute and relative paths", () => {
		const spec = ["## Files", "- `src/a.ts`", "- `test/b.test.ts`", "- `src/c.ts`"].join("\n");
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/a.ts", edits: 1 }),
			makeFileMapEntry({ file_path: "/home/user/repo/test/b.test.ts", writes: 1 }),
			makeFileMapEntry({ file_path: "/home/user/repo/src/c.ts", edits: 1 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm], "/home/user/repo");
		expect(result.drift_score).toBe(0);
		expect(result.missing_files).toEqual([]);
		expect(result.unexpected_files).toEqual([]);
	});

	test("does not match function signatures as expected files in drift", () => {
		const spec = [
			"## Files",
			"- `src/app.ts`",
			"- `aggregateTeamData(...)`",
		].join("\n");
		const fm = makeFileMapResult([
			makeFileMapEntry({ file_path: "src/app.ts", edits: 1 }),
		]);
		const result = computePlanDrift("specs/plan.md", spec, [fm]);
		// aggregateTeamData(...) is filtered out, so expected = [src/app.ts], actual = [src/app.ts]
		expect(result.drift_score).toBe(0);
		expect(result.expected_files).toEqual(["src/app.ts"]);
	});
});

// =============================================================================
// detectSpecRef
// =============================================================================

describe("detectSpecRef", () => {
	test("detects /build specs/X.md", () => {
		const prompts = ["/build specs/journey-stitching.md"];
		expect(detectSpecRef(prompts)).toBe("specs/journey-stitching.md");
	});

	test("detects /build with nested specs path", () => {
		const prompts = ["some context", "/build my-project/specs/plan.md"];
		expect(detectSpecRef(prompts)).toBe("my-project/specs/plan.md");
	});

	test("returns undefined when no spec ref is present", () => {
		const prompts = ["Fix the bug in src/main.ts", "Run tests"];
		expect(detectSpecRef(prompts)).toBeUndefined();
	});

	test("returns undefined for empty prompts", () => {
		expect(detectSpecRef([])).toBeUndefined();
	});

	test("returns first match when multiple prompts have spec refs", () => {
		const prompts = ["/build specs/first.md", "/build specs/second.md"];
		expect(detectSpecRef(prompts)).toBe("specs/first.md");
	});

	test("handles /build with extra whitespace", () => {
		const prompts = ["/build   specs/plan.md"];
		expect(detectSpecRef(prompts)).toBe("specs/plan.md");
	});

	test("does not match /build without specs/ in path", () => {
		const prompts = ["/build src/main.ts"];
		expect(detectSpecRef(prompts)).toBeUndefined();
	});

	test("does not match build without slash prefix", () => {
		const prompts = ["build specs/plan.md"];
		expect(detectSpecRef(prompts)).toBeUndefined();
	});
});

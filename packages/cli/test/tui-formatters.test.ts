import { describe, expect, test } from "bun:test";
import {
	groupFilesByAgent,
	groupFilesByDirectory,
	stripAnsi,
} from "../src/commands/tui-formatters";
import type { EditChain } from "../src/types";

// --- Test helpers ---

type FileEntry = { file_path: string; reads: number; edits: number; writes: number };

const makeFile = (file_path: string): FileEntry => ({
	file_path,
	reads: 1,
	edits: 0,
	writes: 0,
});

const makeChain = (overrides: Partial<EditChain> & { file_path: string }): EditChain => ({
	steps: [],
	total_edits: 0,
	total_failures: 0,
	total_reads: 0,
	effort_ms: 0,
	has_backtrack: false,
	surviving_edit_ids: [],
	abandoned_edit_ids: [],
	...overrides,
});

/** Find the single inverse-video line among rendered lines and return its filename token. */
const highlightedFileName = (lines: readonly string[]): string => {
	const inverseLines = lines.filter((l) => l.includes("\x1b[7m"));
	expect(inverseLines).toHaveLength(1);
	const stripped = stripAnsi(inverseLines[0]).trim();
	return stripped.split(/\s+/)[0];
};

// --- groupFilesByDirectory ---

describe("groupFilesByDirectory highlight/selection agreement", () => {
	// Flat, absolute-path selection order as getEditsFileList would produce it:
	// [a.ts, lib/b.ts, z.ts] (indices 0, 1, 2)
	const files = [
		makeFile("/proj/src/a.ts"),
		makeFile("/proj/src/lib/b.ts"),
		makeFile("/proj/src/z.ts"),
	];
	const projectDir = "/proj/src";

	test("highlightIndex=1 highlights files[1] (lib/b.ts), the file Enter opens", () => {
		const lines = groupFilesByDirectory(files, projectDir, undefined, undefined, undefined, 1);
		expect(highlightedFileName(lines)).toBe("b.ts");
	});

	test("highlightIndex=2 highlights files[2] (z.ts), the file Enter opens", () => {
		const lines = groupFilesByDirectory(files, projectDir, undefined, undefined, undefined, 2);
		expect(highlightedFileName(lines)).toBe("z.ts");
	});
});

// --- groupFilesByAgent ---

describe("groupFilesByAgent highlight/selection agreement", () => {
	// Flat, absolute-path selection order: [a.ts, z.ts] (indices 0, 1)
	const files = [makeFile("/proj/src/a.ts"), makeFile("/proj/src/z.ts")];
	const projectDir = "/proj/src";

	// Agent chronological order diverges from flat file order: alpha (t=1000, owns z.ts)
	// appears before beta (t=2000, owns a.ts).
	const editChains: EditChain[] = [
		makeChain({
			file_path: "/proj/src/a.ts",
			agent_name: "beta",
			steps: [{ tool_use_id: "1", t: 2000, tool_name: "Edit", outcome: "success" }],
			total_edits: 1,
		}),
		makeChain({
			file_path: "/proj/src/z.ts",
			agent_name: "alpha",
			steps: [{ tool_use_id: "2", t: 1000, tool_name: "Edit", outcome: "success" }],
			total_edits: 1,
		}),
	];
	const agentNames = ["alpha", "beta"];

	test("highlightIndex=0 highlights files[0] (a.ts), the file Enter opens", () => {
		const lines = groupFilesByAgent(files, projectDir, editChains, agentNames, undefined, 0);
		expect(highlightedFileName(lines)).toBe("a.ts");
	});

	test("highlightIndex=1 highlights files[1] (z.ts), the file Enter opens", () => {
		const lines = groupFilesByAgent(files, projectDir, editChains, agentNames, undefined, 1);
		expect(highlightedFileName(lines)).toBe("z.ts");
	});
});

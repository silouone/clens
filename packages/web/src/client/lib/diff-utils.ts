import type { DiffLine } from "../../shared/types";

type Hunk = {
	readonly oldStart: number;
	readonly newStart: number;
	readonly lines: readonly DiffLine[];
};

/**
 * Detect gaps in line_number values and split into separate hunks.
 * A gap is any jump > 1 between consecutive line numbers.
 * Uses reduce to stay functional (no mutation, no loops).
 */
const splitIntoHunks = (lines: readonly DiffLine[]): readonly Hunk[] => {
	const [first, ...rest] = lines;
	if (!first) return [];

	type Acc = {
		readonly hunks: readonly Hunk[];
		readonly currentLines: readonly DiffLine[];
		readonly prevLineNo: number;
	};

	const initial: Acc = {
		hunks: [],
		currentLines: [first],
		prevLineNo: first.line_number ?? 1,
	};

	const makeHunk = (hunkLines: readonly DiffLine[]): Hunk => {
		const [head] = hunkLines;
		const firstNo = head?.line_number ?? 1;
		return {
			oldStart: head?.type === "add" ? Math.max(1, firstNo) : firstNo,
			newStart: head?.type === "remove" ? Math.max(1, firstNo) : firstNo,
			lines: hunkLines,
		};
	};

	const result = rest.reduce<Acc>((acc, line) => {
		const lineNo = line.line_number ?? (acc.prevLineNo + 1);
		const expectedNext = acc.prevLineNo + 1;
		const isGap = line.line_number !== undefined && lineNo > expectedNext + 1;

		return isGap
			? {
					hunks: [...acc.hunks, makeHunk(acc.currentLines)],
					currentLines: [line],
					prevLineNo: lineNo,
				}
			: {
					hunks: acc.hunks,
					currentLines: [...acc.currentLines, line],
					prevLineNo: lineNo,
				};
	}, initial);

	return [...result.hunks, makeHunk(result.currentLines)];
};

const linePrefix = (type: DiffLine["type"]): string =>
	type === "add" ? "+" : type === "remove" ? "-" : " ";

/**
 * Convert DiffLine[] to unified diff string for diff2html.
 * Generates proper multi-hunk output based on line_number discontinuities.
 */
export const diffLinesToUnified = (
	filePath: string,
	lines: readonly DiffLine[],
): string => {
	if (lines.length === 0) return "";
	const header = `--- a/${filePath}\n+++ b/${filePath}`;

	const hunks = splitIntoHunks(lines);
	const hunkStrings = hunks.map((hunk) => {
		const oldCount = hunk.lines.filter(
			(l) => l.type === "remove" || l.type === "context",
		).length;
		const newCount = hunk.lines.filter(
			(l) => l.type === "add" || l.type === "context",
		).length;
		const hunkHeader = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
		const body = hunk.lines
			.map((l) => `${linePrefix(l.type)}${l.content}`)
			.join("\n");
		return `${hunkHeader}\n${body}`;
	});

	return `${header}\n${hunkStrings.join("\n")}`;
};

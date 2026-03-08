import type { FileMapResult, PlanDriftReport } from "../types";

// --- Section heading detection ---

const FILES_SECTION_KEYWORDS = [
	"file",
	"deliverable",
	"relevant",
	"new",
	"modified",
	"create",
] as const;

const isFilesSectionHeading = (line: string): boolean => {
	const trimmed = line.trim().toLowerCase();
	if (!trimmed.startsWith("#")) return false;
	return FILES_SECTION_KEYWORDS.some((kw) => trimmed.includes(kw));
};

const isAnyHeading = (line: string): boolean => line.trim().startsWith("#");

// --- Path extraction patterns ---

const BACKTICK_PATH_RE = /^[-*]\s+`([^`]+)`/;
const BOLD_PATH_RE = /^[-*]\s+\*\*([^*]+)\*\*/;
const BARE_PATH_RE = /^[-*]\s+([\w./@-]+\.\w+)/;
const PREFIX_PATH_RE = /^(?:Create|Modify|File):\s*`?([^\s`]+)`?/i;

const hasFileExtension = (s: string): boolean => /\.\w+$/.test(s);

const isFunctionSignature = (s: string): boolean => s.includes("(");

// --- Command detection ---

const COMMAND_KEYWORDS = [
	"bun", "npm", "npx", "git", "cd", "mkdir", "rm", "cp", "mv",
	"echo", "cat", "grep", "curl", "wget", "docker", "yarn", "pnpm",
	"node", "deno", "tsc", "eslint", "prettier", "jest", "vitest",
] as const;

const isCommandLike = (s: string): boolean => {
	const lower = s.trim().toLowerCase();
	return COMMAND_KEYWORDS.some((cmd) => lower === cmd || lower.startsWith(`${cmd} `));
};

/** Validate that a string looks like a file path (has / and extension, is not a command or function). */
const isValidFilePath = (s: string): boolean =>
	s.includes("/") && hasFileExtension(s) && !isFunctionSignature(s) && !isCommandLike(s);

// --- Fenced code block path extraction ---

const extractCodeBlockPaths = (line: string): readonly string[] => {
	const trimmed = line.trim();
	if (!trimmed) return [];
	// Skip lines with code syntax (imports, assignments, comments)
	if (trimmed.includes("=") || trimmed.includes("(") || trimmed.includes("{") || trimmed.startsWith("//") || trimmed.startsWith("#!")) return [];
	// Take first whitespace-separated token as potential path
	const firstToken = trimmed.split(/\s+/)[0];
	if (!firstToken || !isValidFilePath(firstToken)) return [];
	return [normalizePath(firstToken)];
};

// --- Table row path extraction ---

const TABLE_CELL_RE = /\|\s*([^|]+?)\s*(?=\|)/g;

const extractTablePaths = (line: string): readonly string[] => {
	if (!line.includes("|")) return [];
	const matches = [...line.matchAll(TABLE_CELL_RE)];
	return matches
		.map((m) => m[1].trim())
		// Strip surrounding backticks from table cells
		.map((s) => s.startsWith("`") && s.endsWith("`") ? s.slice(1, -1) : s)
		.filter((s) => isValidFilePath(s))
		.map(normalizePath);
};

// --- Inline backtick path extraction ---

const INLINE_BACKTICK_RE = /`([^`]+)`/g;

const extractInlineBacktickPaths = (line: string): readonly string[] => {
	if (!line.includes("`")) return [];
	// Skip bullet lines — those are handled by extractPathFromBullet
	if (/^\s*[-*]\s+`/.test(line)) return [];
	const matches = [...line.matchAll(INLINE_BACKTICK_RE)];
	return matches
		.map((m) => m[1])
		.filter((s) => isValidFilePath(s))
		.map(normalizePath);
};

const extractPathFromBullet = (line: string): string | undefined => {
	const trimmed = line.trim();
	const backtickMatch = trimmed.match(BACKTICK_PATH_RE);
	if (backtickMatch?.[1] && !isFunctionSignature(backtickMatch[1])) return backtickMatch[1];

	const boldMatch = trimmed.match(BOLD_PATH_RE);
	if (boldMatch?.[1] && hasFileExtension(boldMatch[1]) && !isFunctionSignature(boldMatch[1]))
		return boldMatch[1];

	const bareMatch = trimmed.match(BARE_PATH_RE);
	if (bareMatch?.[1] && hasFileExtension(bareMatch[1]) && !isFunctionSignature(bareMatch[1]))
		return bareMatch[1];

	return undefined;
};

const extractPrefixPath = (line: string): string | undefined => {
	const trimmed = line.trim();
	const match = trimmed.match(PREFIX_PATH_RE);
	return match?.[1] ?? undefined;
};

// --- Normalization ---

const normalizePath = (p: string): string => {
	const trimmed = p.trim();
	return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
};

const normalizeToRelative = (p: string, projectDir?: string): string => {
	const trimmed = p.startsWith("./") ? p.slice(2) : p;
	if (!trimmed.startsWith("/")) return trimmed;
	if (projectDir) {
		const prefix = projectDir.endsWith("/") ? projectDir : `${projectDir}/`;
		if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
	}
	return trimmed;
};

// --- parseSpecExpectedFiles ---

export const parseSpecExpectedFiles = (specContent: string): readonly string[] => {
	const lines = specContent.split("\n");

	const { paths } = lines.reduce<{
		readonly inFilesSection: boolean;
		readonly inCodeBlock: boolean;
		readonly paths: readonly string[];
	}>(
		(acc, line) => {
			// Track fenced code blocks
			if (line.trim().startsWith("```")) {
				return { ...acc, inCodeBlock: !acc.inCodeBlock };
			}

			// Inside code block: extract lines that look like file paths
			if (acc.inCodeBlock) {
				return { ...acc, paths: [...acc.paths, ...extractCodeBlockPaths(line)] };
			}

			// Check for prefix paths anywhere in the doc
			const prefixPath = extractPrefixPath(line);
			const prefixPaths = prefixPath ? [normalizePath(prefixPath)] : [];

			// Extract inline backtick paths from anywhere (non-bullet lines)
			const inlinePaths = extractInlineBacktickPaths(line);

			// Extract table row paths
			const tablePaths = extractTablePaths(line);

			// Track section context
			if (isFilesSectionHeading(line)) {
				return {
					inFilesSection: true,
					inCodeBlock: false,
					paths: [...acc.paths, ...prefixPaths, ...inlinePaths, ...tablePaths],
				};
			}

			if (isAnyHeading(line)) {
				return {
					inFilesSection: false,
					inCodeBlock: false,
					paths: [...acc.paths, ...prefixPaths, ...inlinePaths, ...tablePaths],
				};
			}

			// In a files section, extract bullet paths
			const bulletPath = acc.inFilesSection ? extractPathFromBullet(line) : undefined;
			const bulletPaths = bulletPath ? [normalizePath(bulletPath)] : [];

			return {
				...acc,
				paths: [...acc.paths, ...prefixPaths, ...bulletPaths, ...inlinePaths, ...tablePaths],
			};
		},
		{ inFilesSection: false, inCodeBlock: false, paths: [] },
	);

	const unique = [...new Set(paths)];
	return unique.sort();
};

// --- extractActualFiles ---

export const extractActualFiles = (fileMaps: readonly FileMapResult[]): readonly string[] => {
	const allPaths = fileMaps.flatMap((fm) =>
		fm.files.filter((entry) => entry.edits > 0 || entry.writes > 0).map((entry) => entry.file_path),
	);
	const unique = [...new Set(allPaths)];
	return unique.sort();
};

// --- computePlanDrift ---

export const computePlanDrift = (
	specPath: string,
	specContent: string,
	fileMaps: readonly FileMapResult[],
	projectDir?: string,
): PlanDriftReport => {
	const rawExpected = parseSpecExpectedFiles(specContent);
	const rawActual = extractActualFiles(fileMaps);

	const toRelative = (p: string) => normalizeToRelative(p, projectDir);
	const expected = [...new Set(rawExpected.map(toRelative))].sort();
	const actual = [...new Set(rawActual.map(toRelative))].sort();

	const expectedSet = new Set(expected);
	const actualSet = new Set(actual);

	const unexpected = actual.filter((f) => !expectedSet.has(f));
	const missing = expected.filter((f) => !actualSet.has(f));

	const driftScore = Math.min(
		1,
		(unexpected.length + missing.length) / Math.max(expected.length, 1),
	);

	return {
		spec_path: specPath,
		expected_files: expected,
		actual_files: actual,
		unexpected_files: unexpected,
		missing_files: missing,
		drift_score: driftScore,
	};
};

// --- detectSpecRef ---

const BUILD_SPEC_RE = /\/build\s+([\w./@-]*specs\/[\w./@-]+)/;

export const detectSpecRef = (prompts: readonly string[]): string | undefined => {
	const match = prompts.reduce<string | undefined>((found, prompt) => {
		if (found !== undefined) return found;
		const m = prompt.match(BUILD_SPEC_RE);
		return m?.[1] ?? undefined;
	}, undefined);
	return match;
};

import type { DiffLine, EditChainsResult, FileDiffAttribution, StoredEvent } from "../types";

// --- Helper types ---

export interface AgentEditEntry {
	readonly agent_name: string;
	readonly tool_use_id: string;
	readonly new_string_lines: ReadonlySet<string>;
	readonly old_string_lines: ReadonlySet<string>;
	readonly t: number;
}

// --- Pure functions ---

/**
 * Find the git commit hash from the first SessionStart event.
 */
export const getStartCommit = (events: readonly StoredEvent[]): string | undefined =>
	events.find((e) => e.event === "SessionStart" && e.context?.git_commit)?.context?.git_commit ??
	undefined;

/**
 * Convert an absolute file path to a relative path by stripping the projectDir prefix.
 */
const toRelativePath = (absolutePath: string, projectDir: string): string => {
	const normalized = projectDir.endsWith("/") ? projectDir : `${projectDir}/`;
	return absolutePath.startsWith(normalized) ? absolutePath.slice(normalized.length) : absolutePath;
};

/**
 * Parse a unified diff string into DiffLine[].
 * Tracks line numbers from @@ hunk headers.
 */
export const parseUnifiedDiff = (rawDiff: string): readonly DiffLine[] => {
	if (rawDiff.trim().length === 0 || rawDiff.includes("Binary files")) {
		return [];
	}

	const lines = rawDiff.split("\n");

	const { result } = lines.reduce<{
		readonly result: readonly DiffLine[];
		readonly oldLine: number;
		readonly newLine: number;
	}>(
		(acc, line) => {
			// Skip file headers, empty lines, diff --git lines
			if (
				line.startsWith("diff --git") ||
				line.startsWith("---") ||
				line.startsWith("+++") ||
				line.startsWith("index ") ||
				line === ""
			) {
				return acc;
			}

			// Parse hunk headers for line numbers
			const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (hunkMatch) {
				return {
					...acc,
					oldLine: parseInt(hunkMatch[1], 10),
					newLine: parseInt(hunkMatch[2], 10),
				};
			}

			// Addition line (but not +++ header, already handled above)
			if (line.startsWith("+")) {
				return {
					result: [
						...acc.result,
						{
							type: "add" as const,
							content: line.slice(1),
							line_number: acc.newLine,
						},
					],
					oldLine: acc.oldLine,
					newLine: acc.newLine + 1,
				};
			}

			// Removal line (but not --- header, already handled above)
			if (line.startsWith("-")) {
				return {
					result: [
						...acc.result,
						{
							type: "remove" as const,
							content: line.slice(1),
							line_number: acc.oldLine,
						},
					],
					oldLine: acc.oldLine + 1,
					newLine: acc.newLine,
				};
			}

			// Context line (starts with space)
			if (line.startsWith(" ")) {
				return {
					result: [
						...acc.result,
						{
							type: "context" as const,
							content: line.slice(1),
						},
					],
					oldLine: acc.oldLine + 1,
					newLine: acc.newLine + 1,
				};
			}

			// Skip any other line (e.g., "\ No newline at end of file")
			return acc;
		},
		{ result: [], oldLine: 0, newLine: 0 },
	);

	return result;
};

/**
 * Capture unified diffs from git for a set of file paths.
 * Spawns `git diff -U3 <startCommit> -- <file>` for each file.
 * Falls back to `git diff -U3 <startCommit> HEAD -- <file>` if the first returns empty.
 */
export const captureUnifiedDiff = (
	projectDir: string,
	startCommit: string,
	filePaths: readonly string[],
): ReadonlyMap<string, string> => {
	const entries = filePaths.flatMap((absolutePath): readonly [string, string][] => {
		const relativePath = toRelativePath(absolutePath, projectDir);

		try {
			// Try unstaged diff first
			const result = Bun.spawnSync(["git", "diff", "-U3", startCommit, "--", relativePath], {
				cwd: projectDir,
				stderr: "pipe",
			});

			if (result.exitCode === 0) {
				const output = result.stdout.toString().trim();
				if (output.length > 0) {
					return [[relativePath, output]];
				}
			}

			// Fallback: try diffing against HEAD
			const headResult = Bun.spawnSync(
				["git", "diff", "-U3", startCommit, "HEAD", "--", relativePath],
				{ cwd: projectDir, stderr: "pipe" },
			);

			if (headResult.exitCode === 0) {
				const headOutput = headResult.stdout.toString().trim();
				if (headOutput.length > 0) {
					return [[relativePath, headOutput]];
				}
			}

			return [];
		} catch {
			return [];
		}
	});

	return new Map(entries);
};

/**
 * Build an index of agent edit operations grouped by file path (relative).
 * Maps each file to the set of line strings that were added/removed by each agent.
 */
export const buildAgentEditIndex = (
	events: readonly StoredEvent[],
	editChains: EditChainsResult,
	projectDir: string,
): ReadonlyMap<string, readonly AgentEditEntry[]> => {
	// Build a set of tool_use_ids that resulted in failure
	const failureIds = new Set(
		events
			.filter((e) => e.event === "PostToolUseFailure")
			.map((e) => (typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined))
			.filter((id): id is string => id !== undefined),
	);

	// Build a lookup: tool_use_id -> PreToolUse event
	const preToolUseMap = events
		.filter((e) => e.event === "PreToolUse")
		.reduce<ReadonlyMap<string, StoredEvent>>((acc, e) => {
			const id = typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined;
			if (id === undefined) return acc;
			const next = new Map(acc);
			next.set(id, e);
			return next;
		}, new Map());

	// Process each chain's steps to extract agent edit entries
	const allEntries = editChains.chains.flatMap((chain) => {
		const relativePath = toRelativePath(chain.file_path, projectDir);
		const agentName = chain.agent_name ?? "session";

		const entries = chain.steps
			.filter((step) => step.tool_name === "Edit" || step.tool_name === "Write")
			.filter((step) => !failureIds.has(step.tool_use_id))
			.flatMap((step): readonly { readonly path: string; readonly entry: AgentEditEntry }[] => {
				const event = preToolUseMap.get(step.tool_use_id);
				if (event === undefined) return [];

				const toolInput = event.data.tool_input as Record<string, unknown> | undefined;
				if (toolInput === undefined) return [];

				const oldString = typeof toolInput.old_string === "string" ? toolInput.old_string : "";
				const newString =
					typeof toolInput.new_string === "string"
						? toolInput.new_string
						: typeof toolInput.content === "string"
							? toolInput.content
							: "";

				const newStringLines = new Set(
					newString
						.split("\n")
						.map((l) => l.trim())
						.filter((l) => l.length > 0),
				);
				const oldStringLines = new Set(
					oldString
						.split("\n")
						.map((l) => l.trim())
						.filter((l) => l.length > 0),
				);

				return [
					{
						path: relativePath,
						entry: {
							agent_name: agentName,
							tool_use_id: step.tool_use_id,
							new_string_lines: newStringLines,
							old_string_lines: oldStringLines,
							t: step.t,
						},
					},
				];
			});

		return entries;
	});

	// Group by relative file path
	return allEntries.reduce<ReadonlyMap<string, readonly AgentEditEntry[]>>(
		(acc, { path, entry }) => {
			const existing = acc.get(path) ?? [];
			const next = new Map(acc);
			next.set(path, [...existing, entry]);
			return next;
		},
		new Map(),
	);
};

/**
 * Attribute diff lines to agents by matching line content against edit index entries.
 * For "add" lines, matches against new_string_lines; for "remove" lines, against old_string_lines.
 * When multiple agents match, picks the chronologically latest (highest t).
 */
export const attributeDiffLines = (
	diffLines: readonly DiffLine[],
	editIndex: readonly AgentEditEntry[],
): readonly DiffLine[] =>
	diffLines.map((line): DiffLine => {
		if (line.type === "context") return line;

		const trimmed = line.content.trim();
		if (trimmed.length === 0) return line;

		const matchingEntries =
			line.type === "add"
				? editIndex.filter((entry) => entry.new_string_lines.has(trimmed))
				: editIndex.filter((entry) => entry.old_string_lines.has(trimmed));

		if (matchingEntries.length === 0) return line;

		// Pick the chronologically latest match
		const best = matchingEntries.reduce((latest, entry) => (entry.t > latest.t ? entry : latest));

		return { ...line, agent_name: best.agent_name };
	});

/**
 * Orchestrator: extract diff attribution for all files in edit chains.
 * Combines git diff capture, unified diff parsing, and agent attribution.
 */
export const extractDiffAttribution = (
	projectDir: string,
	events: readonly StoredEvent[],
	editChains: EditChainsResult,
): readonly FileDiffAttribution[] => {
	const startCommit = getStartCommit(events);
	if (startCommit === undefined) return [];

	if (editChains.chains.length === 0) return [];

	// Collect unique absolute file paths from chains
	const absolutePaths = [...new Set(editChains.chains.map((c) => c.file_path))];

	// Capture diffs (returns Map<relative_path, raw_diff>)
	const diffMap = captureUnifiedDiff(projectDir, startCommit, absolutePaths);

	if (diffMap.size === 0) return [];

	// Build agent edit index once (returns Map<relative_path, AgentEditEntry[]>)
	const agentEditIndex = buildAgentEditIndex(events, editChains, projectDir);

	// Process each file with diff output
	return Array.from(diffMap.entries()).flatMap(
		([relativePath, rawDiff]): readonly FileDiffAttribution[] => {
			const parsedLines = parseUnifiedDiff(rawDiff);
			if (parsedLines.length === 0) return [];

			// Find matching edit index entries - try exact match first, then endsWith fallback
			const fileEntries =
				agentEditIndex.get(relativePath) ??
				Array.from(agentEditIndex.entries()).find(
					([key]) => key.endsWith(relativePath) || relativePath.endsWith(key),
				)?.[1] ??
				[];

			const attributedLines = attributeDiffLines(parsedLines, fileEntries);

			const totalAdditions = attributedLines.filter((l) => l.type === "add").length;
			const totalDeletions = attributedLines.filter((l) => l.type === "remove").length;

			return [
				{
					file_path: relativePath,
					lines: attributedLines,
					total_additions: totalAdditions,
					total_deletions: totalDeletions,
				},
			];
		},
	);
};

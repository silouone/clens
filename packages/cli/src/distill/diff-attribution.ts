import type { DiffLine, EditChainsResult, FileDiffAttribution, StoredEvent, WorkingTreeChange } from "../types";

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
 * Falls back to InstructionsLoaded with load_reason "session_start" (sub-agents).
 */
export const getStartCommit = (events: readonly StoredEvent[]): string | undefined =>
	events.find((e) => e.event === "SessionStart" && e.context?.git_commit)?.context?.git_commit
	?? events.find((e) => e.event === "InstructionsLoaded" && e.context?.git_commit)?.context?.git_commit
	?? undefined;

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
 *
 * @deprecated Use `computeToolSourcedDiff` for git-independent attribution.
 * This function queries git at distill-time, so diffs may be stale if the user
 * committed or changed branches after the session.
 */
export const extractGitDiffAttribution = (
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

/**
 * Capture raw unified diffs for working tree / staged changes not already in diff_attribution.
 * Returns additional FileDiffAttribution entries (without agent attribution).
 */
export const captureMissingDiffs = (
	projectDir: string,
	events: readonly StoredEvent[],
	existingAttrs: readonly FileDiffAttribution[],
	workingTreeChanges: readonly WorkingTreeChange[],
): readonly FileDiffAttribution[] => {
	const startCommit = getStartCommit(events);
	if (startCommit === undefined) return [];

	if (workingTreeChanges.length === 0) return [];

	const coveredPaths = new Set(existingAttrs.map((a) => a.file_path));

	// Working tree changes already use relative paths
	const missingPaths = workingTreeChanges
		.map((c) => c.file_path)
		.filter((p) => !coveredPaths.has(p));

	if (missingPaths.length === 0) return [];

	// captureUnifiedDiff expects absolute paths, but also handles relative ones
	// Working tree changes use relative paths — pass them directly
	const diffMap = captureUnifiedDiff(projectDir, startCommit, missingPaths);

	return Array.from(diffMap.entries()).flatMap(
		([relativePath, rawDiff]): readonly FileDiffAttribution[] => {
			const parsedLines = parseUnifiedDiff(rawDiff);
			if (parsedLines.length === 0) return [];

			const totalAdditions = parsedLines.filter((l) => l.type === "add").length;
			const totalDeletions = parsedLines.filter((l) => l.type === "remove").length;

			return [
				{
					file_path: relativePath,
					lines: parsedLines,
					total_additions: totalAdditions,
					total_deletions: totalDeletions,
				},
			];
		},
	);
};

// --- Tool-sourced diff attribution (git-independent) ---

/** Multiset from string array — preserves duplicate counts. */
export const toBag = (lines: readonly string[]): ReadonlyMap<string, number> =>
	lines.reduce<ReadonlyMap<string, number>>((acc, line) => {
		const next = new Map(acc);
		next.set(line, (acc.get(line) ?? 0) + 1);
		return next;
	}, new Map());

/** Multiset difference: lines in `a` that exceed their count in `b`. */
export const bagDiff = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): readonly string[] =>
	Array.from(a.entries()).flatMap(([line, count]) => {
		const bCount = b.get(line) ?? 0;
		const excess = count - bCount;
		return excess > 0 ? Array.from({ length: excess }, () => line) : [];
	});

/**
 * For an Edit call: compute diff lines from old_string -> new_string.
 * Lines unique to old_string are deletions. Lines unique to new_string are additions.
 * Lines present in both are unchanged (not emitted -- they're context).
 */
export const computeEditDiffLines = (
	toolInput: Readonly<Record<string, unknown>>,
	agentName: string,
): readonly DiffLine[] => {
	const oldString = typeof toolInput.old_string === "string" ? toolInput.old_string : "";
	const newString = typeof toolInput.new_string === "string" ? toolInput.new_string : "";

	if (oldString === "" && newString === "") return [];

	const oldLines = oldString.split("\n");
	const newLines = newString.split("\n");

	// Build multiset (bag) counts to handle duplicate lines correctly
	const oldBag = toBag(oldLines);
	const newBag = toBag(newLines);

	const deletions: readonly DiffLine[] = bagDiff(oldBag, newBag)
		.filter((l) => l.trim().length > 0)
		.map((content) => ({ type: "remove" as const, content, agent_name: agentName }));

	const additions: readonly DiffLine[] = bagDiff(newBag, oldBag)
		.filter((l) => l.trim().length > 0)
		.map((content) => ({ type: "add" as const, content, agent_name: agentName }));

	return [...deletions, ...additions];
};

/**
 * For a Write call: all non-empty content lines are additions.
 * We don't have the previous file content, so deletions = 0.
 *
 * This is correct for new files. For overwrites of existing files,
 * it over-counts additions (shows total written lines, not delta).
 * This is a known trade-off: accuracy for new files, over-estimate
 * for overwrites -- but always git-independent and always attributed.
 */
export const computeWriteDiffLines = (
	toolInput: Readonly<Record<string, unknown>>,
	agentName: string,
): readonly DiffLine[] => {
	const content = typeof toolInput.content === "string" ? toolInput.content : "";
	if (content === "") return [];

	return content.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((line) => ({ type: "add" as const, content: line, agent_name: agentName }));
};

/**
 * Compute diff attribution from Edit/Write tool_input payloads.
 * Git-independent: works regardless of user commits, works for sub-agents.
 *
 * For Edit: old_string -> new_string is the exact change.
 *   - Lines in old_string but not new_string -> deletions
 *   - Lines in new_string but not old_string -> additions
 *   - Lines in both -> unchanged (not counted)
 *
 * For Write: content is the written output.
 *   - All content lines counted as additions
 *   - Deletions unknown without prior file state (counted as 0)
 *
 * Every line is attributed to the agent + tool_use_id that produced it.
 */
export const computeToolSourcedDiff = (
	events: readonly StoredEvent[],
	editChains: EditChainsResult,
	projectDir: string,
): readonly FileDiffAttribution[] => {
	// Build failure set to exclude failed tool calls
	const failureIds = new Set(
		events
			.filter((e) => e.event === "PostToolUseFailure")
			.map((e) => typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined)
			.filter((id): id is string => id !== undefined),
	);

	// Build lookup: tool_use_id -> PreToolUse event (for full tool_input)
	const preToolUseMap = new Map(
		events
			.filter((e) => e.event === "PreToolUse")
			.flatMap((e): readonly [string, StoredEvent][] => {
				const id = typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined;
				return id !== undefined ? [[id, e]] : [];
			}),
	);

	return editChains.chains.flatMap((chain): readonly FileDiffAttribution[] => {
		const relativePath = toRelativePath(chain.file_path, projectDir);
		const agentName = chain.agent_name ?? "session";

		// Process each successful Edit/Write step
		const lines: readonly DiffLine[] = chain.steps
			.filter((step) => step.tool_name === "Edit" || step.tool_name === "Write")
			.filter((step) => !failureIds.has(step.tool_use_id))
			.flatMap((step): readonly DiffLine[] => {
				const event = preToolUseMap.get(step.tool_use_id);
				if (event === undefined) return [];

				const toolInput = event.data.tool_input as Readonly<Record<string, unknown>> | undefined;
				if (toolInput === undefined) return [];

				if (step.tool_name === "Edit") {
					return computeEditDiffLines(toolInput, agentName);
				}
				// Write: content lines are additions
				return computeWriteDiffLines(toolInput, agentName);
			});

		if (lines.length === 0) return [];

		return [{
			file_path: relativePath,
			lines,
			total_additions: lines.filter((l) => l.type === "add").length,
			total_deletions: lines.filter((l) => l.type === "remove").length,
		}];
	});
};

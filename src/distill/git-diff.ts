import type { GitDiffHunk, GitDiffResult, StoredEvent, WorkingTreeChange } from "../types";

export const extractGitDiff = async (
	_sessionId: string,
	projectDir: string,
	events: StoredEvent[],
): Promise<GitDiffResult> => {
	if (events.length === 0) {
		return { commits: [], hunks: [] };
	}

	const startTime = events[0].t;
	const endTime = events[events.length - 1].t;

	// Find commits during session timeframe
	const startDate = new Date(startTime).toISOString();
	const endDate = new Date(endTime + 60000).toISOString(); // +1min buffer

	const commits = (() => {
		try {
			const result = Bun.spawnSync(
				["git", "log", `--since=${startDate}`, `--until=${endDate}`, "--format=%H"],
				{ cwd: projectDir, stderr: "pipe" },
			);

			return result.exitCode === 0
				? result.stdout.toString().trim().split("\n").filter(Boolean)
				: [];
		} catch {
			return [];
		}
	})();

	if (commits.length === 0) {
		return { commits: [], hunks: [] };
	}

	// Build a map of file edits by time for matching
	const editEvents = events
		.filter(
			(e) =>
				e.event === "PreToolUse" && (e.data.tool_name === "Edit" || e.data.tool_name === "Write"),
		)
		.map((e) => ({
			t: e.t,
			file_path: ((e.data.tool_input as Record<string, unknown>)?.file_path as string) ?? "",
			tool_use_id: (e.data.tool_use_id as string) ?? "",
		}));

	// Get hunks for each commit
	const hunks = commits.flatMap((commit): GitDiffHunk[] => {
		try {
			const diffResult = Bun.spawnSync(["git", "diff", "--numstat", `${commit}^..${commit}`], {
				cwd: projectDir,
				stderr: "pipe",
			});

			if (diffResult.exitCode !== 0) return [];

			const diffLines = diffResult.stdout.toString().trim().split("\n").filter(Boolean);

			return diffLines.flatMap((line): GitDiffHunk[] => {
				const [addStr, delStr, filePath] = line.split("\t");
				if (!filePath) return [];

				const additions = parseInt(addStr, 10) || 0;
				const deletions = parseInt(delStr, 10) || 0;

				// Try to match to an Edit/Write event by file path
				const matchedEdit = editEvents.find(
					(e) => e.file_path.endsWith(filePath) || filePath.endsWith(e.file_path),
				);

				return [
					{
						commit_hash: commit,
						file_path: filePath,
						additions,
						deletions,
						matched_tool_use_id: matchedEdit?.tool_use_id,
					},
				];
			});
		} catch {
			return [];
		}
	});

	// KNOWN LIMITATION: Working tree changes are captured at distill-time, not session-time.
	// These reflect the state of the working tree when `distill` is run, which may differ
	// from the state during the original agent session.
	const working_tree_changes = detectWorkingTreeChanges(projectDir, false);
	const staged_changes = detectWorkingTreeChanges(projectDir, true);

	return {
		commits,
		hunks,
		...(working_tree_changes.length > 0 ? { working_tree_changes } : {}),
		...(staged_changes.length > 0 ? { staged_changes } : {}),
	};
};

/**
 * Parse `git diff --numstat` output into WorkingTreeChange[].
 * Each line: `<additions>\t<deletions>\t<file_path>`
 */
export const parseNumstatOutput = (output: string): WorkingTreeChange[] =>
	output
		.trim()
		.split("\n")
		.filter(Boolean)
		.flatMap((line): WorkingTreeChange[] => {
			const [addStr, delStr, filePath] = line.split("\t");
			if (!filePath) return [];
			const additions = parseInt(addStr, 10) || 0;
			const deletions = parseInt(delStr, 10) || 0;
			const status: WorkingTreeChange["status"] =
				additions > 0 && deletions === 0
					? "added"
					: deletions > 0 && additions === 0
						? "deleted"
						: "modified";
			return [{ file_path: filePath, status, additions, deletions }];
		});

/**
 * Extract net changes from session start commit to current working tree.
 * Commit-independent: works regardless of whether the agent committed.
 */
export const extractNetChanges = (
	projectDir: string,
	events: readonly StoredEvent[],
): WorkingTreeChange[] => {
	const startEvent = events.find((e) => e.event === "SessionStart" && e.context?.git_commit);
	const startCommit = startEvent?.context?.git_commit;

	if (!startCommit) return [];

	try {
		const unstaged = Bun.spawnSync(["git", "diff", "--numstat", startCommit], {
			cwd: projectDir,
			stderr: "pipe",
		});

		const staged = Bun.spawnSync(["git", "diff", "--numstat", "--cached", startCommit], {
			cwd: projectDir,
			stderr: "pipe",
		});

		const unstagedChanges =
			unstaged.exitCode === 0 ? parseNumstatOutput(unstaged.stdout.toString()) : [];
		const stagedChanges = staged.exitCode === 0 ? parseNumstatOutput(staged.stdout.toString()) : [];

		const allPaths = new Set([
			...unstagedChanges.map((c) => c.file_path),
			...stagedChanges.map((c) => c.file_path),
		]);

		return Array.from(allPaths).map((filePath) => {
			const unstagedEntry = unstagedChanges.find((c) => c.file_path === filePath);
			const stagedEntry = stagedChanges.find((c) => c.file_path === filePath);
			const merged = unstagedEntry ?? stagedEntry;
			if (!merged)
				return { file_path: filePath, status: "modified" as const, additions: 0, deletions: 0 };
			return merged;
		});
	} catch {
		return [];
	}
};

/**
 * Detect working tree changes (unstaged or staged).
 * @param staged - if true, detect staged changes (--cached); otherwise unstaged vs HEAD
 */
const detectWorkingTreeChanges = (projectDir: string, staged: boolean): WorkingTreeChange[] => {
	try {
		// Check if HEAD exists (new repo with no commits)
		const headCheck = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
			cwd: projectDir,
			stderr: "pipe",
		});
		const hasHead = headCheck.exitCode === 0;

		const args = staged
			? ["git", "diff", "--numstat", "--cached"]
			: hasHead
				? ["git", "diff", "--numstat", "HEAD"]
				: ["git", "diff", "--numstat"];

		const result = Bun.spawnSync(args, { cwd: projectDir, stderr: "pipe" });
		if (result.exitCode !== 0) return [];

		return parseNumstatOutput(result.stdout.toString());
	} catch {
		return [];
	}
};

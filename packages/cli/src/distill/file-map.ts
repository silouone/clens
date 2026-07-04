import type { FileMapEntry, FileMapResult, StoredEvent } from "../types";

const FILE_TOOLS = new Set(["Edit", "Read", "Write", "Glob", "Grep"]);

/**
 * Heuristics for spotting a file argument inside a Bash command.
 *
 * Each pattern is anchored to the *start of a command segment* (`(?:^|[;&|]\s*)`)
 * so that operators appearing mid-command -- arrow functions (`=>`), comparisons
 * (`>=`), or `>`/`mkdir`/`touch` tokens embedded inside a quoted string or a
 * `node -e "..."` script -- do not get mistaken for a real redirect/command.
 * Without the anchor, `node -e "rows.map(r => r.id)"` matched the `>` redirect
 * rule and produced the garbage token `r.id)"` (see B: file-map-bash-regex-garbage-paths).
 */
const BASH_FILE_PATTERNS = [
	/(?:^|[;&|]\s*)mkdir\s+(?:-p\s+)?([^\s&|;<>()]+)/,
	/(?:^|[;&|]\s*)(?:cp|mv|rm)\s+(?:-\S+\s+)*\S+\s+([^\s&|;<>()]+)/,
	/(?:^|[;&|]\s*)(?:cp|mv|rm)\s+(?:-\S+\s+)*([^\s&|;<>()]+)/,
	/(?:^|\s)>>?\s*([^\s&|;<>()]+)/,
	/(?:^|[;&|]\s*)touch\s+([^\s&|;<>()]+)/,
] as const;

/**
 * Reject capture groups that cannot be a real file path: tokens carrying shell
 * syntax (quotes, parens, `=`, redirection/expansion sigils) are command
 * fragments, not files. This is the second line of defence after anchoring --
 * e.g. `if [ $x >= 5 ]` yields `=` from the redirect rule, which this filters out.
 */
const isPlausibleFilePath = (token: string): boolean =>
	token.length > 0 && !/["'`(){}=$<>;&|]/.test(token);

const extractBashFilePaths = (command: string): readonly string[] => {
	const tokens = BASH_FILE_PATTERNS.flatMap((pattern) => {
		const match = command.match(pattern);
		const token = match?.[1];
		return token && isPlausibleFilePath(token) ? [token] : [];
	});
	return [...new Set(tokens)];
};

/**
 * Resolve the session's repo root from captured events so that absolute tool
 * paths fold onto the same repo-relative key as git-diff and bash paths.
 *
 * Prefers the SessionStart context `project_dir` -- the hook resolves this to
 * the repo root via `resolveProjectRoot`, so normalizing against it produces
 * repo-root-relative paths that line up with git diff output (which git emits
 * relative to the repo root). Only when no `project_dir` was captured do we fall
 * back to `cwd` (which may be a subdirectory and therefore yield subdir-relative
 * keys that will NOT match git-diff paths). Returns undefined when nothing was
 * captured, in which case paths are left untouched.
 */
const resolveRepoRoot = (events: readonly StoredEvent[]): string | undefined => {
	const fromProjectDir = events
		.map((e) => e.context?.project_dir)
		.find((dir): dir is string => typeof dir === "string" && dir.length > 0);
	if (fromProjectDir) return fromProjectDir;

	const fromContextCwd = events
		.map((e) => e.context?.cwd)
		.find((dir): dir is string => typeof dir === "string" && dir.length > 0);
	if (fromContextCwd) return fromContextCwd;

	const fromData = events
		.map((e) => e.data.cwd)
		.find((dir): dir is string => typeof dir === "string" && dir.length > 0);
	return fromData;
};

/**
 * Normalize a file path to repo-relative form by stripping the repo-root prefix.
 * Absolute paths outside the root and already-relative paths are returned
 * unchanged. This collapses the abs/rel duplication where the same file is
 * captured as `/repo/package.json` by a tool event and `package.json` by a bash
 * heuristic or git diff.
 */
const normalizePath = (filePath: string, root: string | undefined): string => {
	if (!root) return filePath;
	const prefix = root.endsWith("/") ? root : `${root}/`;
	return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
};

const mergeToolUseId = (
	existing: readonly string[],
	toolUseId: string | undefined,
): readonly string[] =>
	toolUseId && !existing.includes(toolUseId) ? [...existing, toolUseId] : existing;

/**
 * Fold a single tool op (identified by its PreToolUse, or an orphan failure)
 * into the file map. `failed` reflects whether the op ultimately failed, which
 * is determined by the presence of a matching PostToolUseFailure -- NOT by the
 * event kind being processed. A failing Edit therefore records an error and no
 * edit, instead of double-counting as both (see B: file-map-failed-ops-counted-
 * as-success-and-dup-ids).
 */
const processToolEvent =
	(root: string | undefined, failed: boolean) =>
	(
		fileMap: ReadonlyMap<string, FileMapEntry>,
		event: StoredEvent,
	): ReadonlyMap<string, FileMapEntry> => {
		const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : "";
		if (!FILE_TOOLS.has(toolName)) return fileMap;

		const toolInput = event.data.tool_input as Record<string, unknown> | undefined;
		if (!toolInput) return fileMap;

		const rawPath = toolInput.file_path ?? toolInput.path;
		const filePath = typeof rawPath === "string" ? normalizePath(rawPath, root) : undefined;
		if (!filePath) return fileMap;

		const existing = fileMap.get(filePath) ?? {
			file_path: filePath,
			reads: 0,
			edits: 0,
			writes: 0,
			errors: 0,
			tool_use_ids: [],
			source: "tool" as const,
		};

		const toolUseId =
			typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : undefined;
		const updatedIds = mergeToolUseId(existing.tool_use_ids, toolUseId);

		const updated: FileMapEntry = {
			...existing,
			tool_use_ids: updatedIds,
			source: "tool",
			errors: existing.errors + (failed ? 1 : 0),
			reads: existing.reads + (!failed && toolName === "Read" ? 1 : 0),
			edits: existing.edits + (!failed && toolName === "Edit" ? 1 : 0),
			writes: existing.writes + (!failed && toolName === "Write" ? 1 : 0),
		};

		const next = new Map(fileMap);
		next.set(filePath, updated);
		return next;
	};

const processBashEvent =
	(root: string | undefined) =>
	(
		fileMap: ReadonlyMap<string, FileMapEntry>,
		event: StoredEvent,
	): ReadonlyMap<string, FileMapEntry> => {
		if (event.event !== "PreToolUse") return fileMap;

		const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : undefined;
		if (toolName !== "Bash") return fileMap;

		const toolInput = event.data.tool_input as Record<string, unknown> | undefined;
		const rawCommand = toolInput?.command;
		const command = typeof rawCommand === "string" ? rawCommand : undefined;
		if (!command) return fileMap;

		const bashPaths = extractBashFilePaths(command).map((p) => normalizePath(p, root));

		return bashPaths.reduce<ReadonlyMap<string, FileMapEntry>>((acc, filePath) => {
			if (acc.has(filePath)) return acc;

			const entry: FileMapEntry = {
				file_path: filePath,
				reads: 0,
				edits: 0,
				writes: 0,
				errors: 0,
				tool_use_ids: [],
				source: "bash",
			};

			const next = new Map(acc);
			next.set(filePath, entry);
			return next;
		}, fileMap);
	};

/**
 * Extract a per-file activity map from captured events.
 *
 * A tool op is represented across up to two events: a `PreToolUse` (always
 * present) and either a `PostToolUse` (success) or a `PostToolUseFailure`
 * (failure). We count each op exactly once -- driven by its `PreToolUse` -- and
 * mark it failed when a `PostToolUseFailure` shares its `tool_use_id`. Failures
 * with no matching `PreToolUse` (truncated capture) are still recorded so error
 * counts are never lost.
 */
export const extractFileMap = (events: readonly StoredEvent[]): FileMapResult => {
	const root = resolveRepoRoot(events);

	// tool_use_ids that ultimately failed (have a PostToolUseFailure).
	const failedIds = new Set(
		events
			.filter((e) => e.event === "PostToolUseFailure")
			.map((e) => (typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined))
			.filter((id): id is string => typeof id === "string"),
	);

	// tool_use_ids that have a PreToolUse -- used to detect orphan failures.
	const preIds = new Set(
		events
			.filter((e) => e.event === "PreToolUse")
			.map((e) => (typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined))
			.filter((id): id is string => typeof id === "string"),
	);

	// Pass 1a: count each op once via its PreToolUse; mark failed by tool_use_id.
	const afterPrePass = events
		.filter((e) => e.event === "PreToolUse")
		.reduce<ReadonlyMap<string, FileMapEntry>>((acc, event) => {
			const id = typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : undefined;
			const failed = id !== undefined && failedIds.has(id);
			return processToolEvent(root, failed)(acc, event);
		}, new Map());

	// Pass 1b: record orphan failures (PostToolUseFailure with no matching PreToolUse).
	const afterToolPass = events
		.filter((e) => {
			if (e.event !== "PostToolUseFailure") return false;
			const id = typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined;
			return id === undefined || !preIds.has(id);
		})
		.reduce<ReadonlyMap<string, FileMapEntry>>(
			(acc, event) => processToolEvent(root, true)(acc, event),
			afterPrePass,
		);

	// Pass 2: scan Bash PreToolUse events for file paths (same normalization, so
	// `> dist/out.js` folds onto the absolute tool path for the same file).
	const afterBashPass = events.reduce<ReadonlyMap<string, FileMapEntry>>(
		(acc, event) => processBashEvent(root)(acc, event),
		afterToolPass,
	);

	const files = Array.from(afterBashPass.values()).sort(
		(a, b) => b.edits + b.writes + b.errors - (a.edits + a.writes + a.errors),
	);

	return { files };
};

import type { FileMapEntry, FileMapResult, StoredEvent } from "../types";

const FILE_TOOLS = new Set(["Edit", "Read", "Write", "Glob", "Grep"]);

const BASH_FILE_PATTERNS = [
	/mkdir\s+(?:-p\s+)?([^\s&|;]+)/,
	/(?:cp|mv|rm)\s+.*?\s+([^\s&|;]+)/,
	/>\s*([^\s&|;]+)/,
	/touch\s+([^\s&|;]+)/,
] as const;

const extractBashFilePaths = (command: string): string[] =>
	BASH_FILE_PATTERNS.flatMap((pattern) => {
		const match = command.match(pattern);
		return match?.[1] ? [match[1]] : [];
	});

/**
 * Resolve the session's working directory from captured events so that absolute
 * tool paths can be folded onto the same key as relative bash/git paths.
 *
 * Prefers the SessionStart context (project_dir, then cwd), then falls back to
 * the first event that carries a `data.cwd`. Returns undefined when no cwd was
 * captured, in which case paths are left untouched.
 */
const resolveSessionCwd = (events: readonly StoredEvent[]): string | undefined => {
	const fromContext = events
		.map((e) => e.context?.project_dir ?? e.context?.cwd)
		.find((dir): dir is string => typeof dir === "string" && dir.length > 0);
	if (fromContext) return fromContext;

	const fromData = events
		.map((e) => e.data.cwd)
		.find((dir): dir is string => typeof dir === "string" && dir.length > 0);
	return fromData;
};

/**
 * Normalize a file path to repo-relative form by stripping the session cwd
 * prefix. Absolute paths outside the cwd and already-relative paths are returned
 * unchanged. This collapses the abs/rel duplication where the same file is
 * captured as `/repo/package.json` by a tool event and `package.json` by a bash
 * heuristic or git diff.
 */
const normalizePath = (filePath: string, cwd: string | undefined): string => {
	if (!cwd) return filePath;
	const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
	return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
};

const mergeToolUseId = (existing: readonly string[], toolUseId: string | undefined): string[] =>
	toolUseId ? [...existing, toolUseId] : [...existing];

const processToolEvent =
	(cwd: string | undefined) =>
	(
		fileMap: ReadonlyMap<string, FileMapEntry>,
		event: StoredEvent,
	): ReadonlyMap<string, FileMapEntry> => {
		const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : "";
		if (!FILE_TOOLS.has(toolName)) return fileMap;

		const toolInput = event.data.tool_input as Record<string, unknown> | undefined;
		if (!toolInput) return fileMap;

		const rawPath = toolInput.file_path ?? toolInput.path;
		const filePath = typeof rawPath === "string" ? normalizePath(rawPath, cwd) : undefined;
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

		const toolUseId = typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : undefined;
		const updatedIds = mergeToolUseId(existing.tool_use_ids, toolUseId);

		const isFailure = event.event === "PostToolUseFailure";

		const updated: FileMapEntry = {
			...existing,
			tool_use_ids: updatedIds,
			source: "tool",
			errors: existing.errors + (isFailure ? 1 : 0),
			reads: existing.reads + (!isFailure && toolName === "Read" ? 1 : 0),
			edits: existing.edits + (!isFailure && toolName === "Edit" ? 1 : 0),
			writes: existing.writes + (!isFailure && toolName === "Write" ? 1 : 0),
		};

		const next = new Map(fileMap);
		next.set(filePath, updated);
		return next;
	};

const processBashEvent =
	(cwd: string | undefined) =>
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

		const bashPaths = extractBashFilePaths(command).map((p) => normalizePath(p, cwd));

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

export const extractFileMap = (events: readonly StoredEvent[]): FileMapResult => {
	const cwd = resolveSessionCwd(events);

	// Pass 1: Process dedicated file tool events (paths normalized to repo-relative)
	const toolEvents = events.filter(
		(e) => e.event === "PreToolUse" || e.event === "PostToolUseFailure",
	);
	const afterToolPass = toolEvents.reduce<ReadonlyMap<string, FileMapEntry>>(
		(acc, event) => processToolEvent(cwd)(acc, event),
		new Map(),
	);

	// Pass 2: Scan Bash PreToolUse events for file paths (same normalization, so
	// `> dist/out.js` folds onto the absolute tool path for the same file)
	const afterBashPass = events.reduce<ReadonlyMap<string, FileMapEntry>>(
		(acc, event) => processBashEvent(cwd)(acc, event),
		afterToolPass,
	);

	const files = Array.from(afterBashPass.values()).sort(
		(a, b) => b.edits + b.writes + b.errors - (a.edits + a.writes + a.errors),
	);

	return { files };
};

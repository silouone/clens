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

const mergeToolUseId = (existing: readonly string[], toolUseId: string | undefined): string[] =>
	toolUseId ? [...existing, toolUseId] : [...existing];

const processToolEvent = (
	fileMap: ReadonlyMap<string, FileMapEntry>,
	event: StoredEvent,
): ReadonlyMap<string, FileMapEntry> => {
	const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : "";
	if (!FILE_TOOLS.has(toolName)) return fileMap;

	const toolInput = event.data.tool_input as Record<string, unknown> | undefined;
	if (!toolInput) return fileMap;

	const rawPath = toolInput.file_path ?? toolInput.path;
	const filePath = typeof rawPath === "string" ? rawPath : undefined;
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

const processBashEvent = (
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

	const bashPaths = extractBashFilePaths(command);

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
	// Pass 1: Process dedicated file tool events
	const toolEvents = events.filter(
		(e) => e.event === "PreToolUse" || e.event === "PostToolUseFailure",
	);
	const afterToolPass = toolEvents.reduce<ReadonlyMap<string, FileMapEntry>>(
		(acc, event) => processToolEvent(acc, event),
		new Map(),
	);

	// Pass 2: Scan Bash PreToolUse events for file paths
	const afterBashPass = events.reduce<ReadonlyMap<string, FileMapEntry>>(
		(acc, event) => processBashEvent(acc, event),
		afterToolPass,
	);

	const files = Array.from(afterBashPass.values()).sort(
		(a, b) => b.edits + b.writes + b.errors - (a.edits + a.writes + a.errors),
	);

	return { files };
};

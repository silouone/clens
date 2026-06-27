import {
	type ClaudeMdInEffect,
	type EffortLevel,
	isEffortLevel,
	isPermissionMode,
	type McpServerUsage,
	type PermissionMode,
	type SessionConfig,
	type StoredEvent,
} from "../types";

/**
 * MCP tool naming convention: `mcp__<server>__<tool>`. Server names may contain
 * underscores (e.g. `mcp__claude_ai_Atlassian__search`, `mcp__ide__executeCode`),
 * so the server segment is captured non-greedily up to the first `__` delimiter.
 */
const MCP_TOOL_PATTERN = /^mcp__(.+?)__/;

/** Extract the MCP server name from a tool name, or undefined if it is not an MCP tool. */
const mcpServerOf = (toolName: string): string | undefined => {
	const match = MCP_TOOL_PATTERN.exec(toolName);
	return match ? match[1] : undefined;
};

/** Most-recent value of a data field across the stream that satisfies `accept`. */
const latestField = <T>(
	events: readonly StoredEvent[],
	field: string,
	accept: (value: unknown) => value is T,
): T | undefined =>
	events.reduceRight<T | undefined>((found, e) => {
		if (found !== undefined) return found;
		const value = e.data[field];
		return accept(value) ? value : undefined;
	}, undefined);

const VALID_MEMORY_TYPES = new Set(["User", "Project", "Local", "Managed"]);

/**
 * Realize CLAUDE.md-in-effect entries from captured `InstructionsLoaded` events.
 * Returns undefined when none were captured (the installed binary may predate the
 * event — see CFG-5 BLOCKED-VERIFY), letting the caller fall back to an inferred
 * list. Deduped by `file_path`, preserving first-seen order. Pure (zero I/O).
 */
const realizeClaudeMd = (events: readonly StoredEvent[]): readonly ClaudeMdInEffect[] | undefined => {
	const seen = new Set<string>();
	const realized: ClaudeMdInEffect[] = [];
	for (const e of events) {
		if (e.event !== "InstructionsLoaded") continue;
		const filePath = e.data.file_path;
		if (typeof filePath !== "string" || filePath.length === 0 || seen.has(filePath)) continue;
		const rawType = e.data.memory_type;
		const memory_type = typeof rawType === "string" && VALID_MEMORY_TYPES.has(rawType)
			? (rawType as ClaudeMdInEffect["memory_type"])
			: "inferred";
		const loadReason = e.data.load_reason;
		seen.add(filePath);
		realized.push({
			file_path: filePath,
			memory_type,
			...(typeof loadReason === "string" && loadReason.length > 0 ? { load_reason: loadReason } : {}),
		});
	}
	return realized.length > 0 ? realized : undefined;
};

export interface SessionConfigOptions {
	/**
	 * Inferred CLAUDE.md fallback (CFG-5), used only when no `InstructionsLoaded`
	 * events were captured. Produced by `capture/settings.ts:inferClaudeMd` at the
	 * (impure) call site so this extractor stays I/O-free.
	 */
	readonly claudeMdFallback?: readonly ClaudeMdInEffect[];
}

/**
 * Pure extraction of a session's effective configuration from its event stream.
 *
 * - `permission_mode` and `effort` are lifted as the most-recent *recognized*
 *   values observed on event payloads (unknown raw values are dropped, never
 *   thrown on); later events override earlier ones.
 * - `mcp_servers` aggregates the distinct MCP servers whose tools were invoked,
 *   counted from `PreToolUse` events (matching `tool_call_count` in stats; Post/
 *   Failure events are NOT counted to avoid double-counting a single call).
 *   The result is deduped by server name and sorted by count desc, then name asc.
 * - `claude_md_in_effect` is realized from `InstructionsLoaded` events when the
 *   live binary emits them, otherwise the inferred fallback (if provided).
 *
 * Performs zero I/O.
 */
export const extractSessionConfig = (
	events: readonly StoredEvent[],
	options: SessionConfigOptions = {},
): SessionConfig => {
	const permission_mode: PermissionMode | undefined = latestField(
		events,
		"permission_mode",
		isPermissionMode,
	);
	const effort: EffortLevel | undefined = latestField(events, "effort", isEffortLevel);

	const counts = events.reduce<Map<string, number>>((acc, e) => {
		if (e.event !== "PreToolUse") return acc;
		const toolName = e.data.tool_name;
		if (typeof toolName !== "string") return acc;
		const server = mcpServerOf(toolName);
		if (server === undefined) return acc;
		return acc.set(server, (acc.get(server) ?? 0) + 1);
	}, new Map());

	const mcp_servers: readonly McpServerUsage[] = [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

	const claude_md_in_effect = realizeClaudeMd(events) ?? options.claudeMdFallback;

	return {
		...(permission_mode !== undefined ? { permission_mode } : {}),
		...(effort !== undefined ? { effort } : {}),
		mcp_servers,
		...(claude_md_in_effect && claude_md_in_effect.length > 0 ? { claude_md_in_effect } : {}),
	};
};

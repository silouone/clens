import type { McpServerUsage, SessionConfig, StoredEvent } from "../types";

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

/** Most-recent non-empty string value of a data field across the event stream. */
const latestStringField = (
	events: readonly StoredEvent[],
	field: string,
): string | undefined =>
	events.reduceRight<string | undefined>((found, e) => {
		if (found !== undefined) return found;
		const value = e.data[field];
		return typeof value === "string" && value.length > 0 ? value : undefined;
	}, undefined);

/**
 * Pure extraction of a session's effective configuration from its event stream.
 *
 * - `permission_mode` and `effort` are lifted as the most-recent non-empty values
 *   observed on event payloads (later events override earlier ones).
 * - `mcp_servers` aggregates the distinct MCP servers whose tools were invoked,
 *   counted from `PreToolUse` events (matching `tool_call_count` in stats; Post/
 *   Failure events are NOT counted to avoid double-counting a single call).
 *   The result is deduped by server name and sorted by count desc, then name asc.
 *
 * Performs zero I/O.
 */
export const extractSessionConfig = (events: readonly StoredEvent[]): SessionConfig => {
	const permission_mode = latestStringField(events, "permission_mode");
	// OPEN-DECISION: `effort` source field is unverified (no event type or fixture
	// defines it). Extracting defensively from `data.effort`; confirm against real
	// capture and widen the fallback chain if the field lives elsewhere.
	const effort = latestStringField(events, "effort");

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

	return {
		...(permission_mode !== undefined ? { permission_mode } : {}),
		...(effort !== undefined ? { effort } : {}),
		mcp_servers,
	};
};

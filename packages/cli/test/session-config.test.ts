import { describe, expect, test } from "bun:test";
import { extractSessionConfig } from "../src/distill/session-config";
import type { ClaudeMdInEffect, HookEventType, StoredEvent } from "../src/types";

const ev = (event: HookEventType, data: Record<string, unknown>, t = 1000): StoredEvent => ({
	t,
	event,
	sid: "s1",
	data,
});

describe("extractSessionConfig — permission_mode + effort (CFG-2)", () => {
	test("lifts recognized permission_mode + effort as typed values (latest wins)", () => {
		const cfg = extractSessionConfig([
			ev("UserPromptSubmit", { permission_mode: "plan" }, 1),
			ev("PreToolUse", { permission_mode: "acceptEdits", effort: "low", tool_name: "Read" }, 2),
			ev("Stop", { permission_mode: "acceptEdits", effort: "high" }, 3),
		]);
		expect(cfg.permission_mode).toBe("acceptEdits");
		expect(cfg.effort).toBe("high");
	});

	test("drops unrecognized raw values instead of surfacing or throwing", () => {
		const cfg = extractSessionConfig([
			ev("PreToolUse", { permission_mode: "weirdMode", effort: "extreme", tool_name: "Read" }, 1),
		]);
		expect(cfg.permission_mode).toBeUndefined();
		expect(cfg.effort).toBeUndefined();
	});

	test("falls back to an earlier recognized value when the latest is unknown", () => {
		const cfg = extractSessionConfig([
			ev("PreToolUse", { permission_mode: "default", effort: "medium", tool_name: "Read" }, 1),
			ev("Stop", { permission_mode: "???", effort: "???" }, 2),
		]);
		expect(cfg.permission_mode).toBe("default");
		expect(cfg.effort).toBe("medium");
	});
});

describe("extractSessionConfig — MCP server aggregation (CFG-4)", () => {
	test("dedupes + counts servers from mcp__ tool names, sorted by count then name", () => {
		const cfg = extractSessionConfig([
			ev("PreToolUse", { tool_name: "mcp__filesystem__read_file" }, 1),
			ev("PreToolUse", { tool_name: "mcp__filesystem__write_file" }, 2),
			ev("PreToolUse", { tool_name: "mcp__claude_ai_Atlassian__editJiraIssue" }, 3),
			ev("PreToolUse", { tool_name: "Read" }, 4),
		]);
		expect(cfg.mcp_servers).toEqual([
			{ name: "filesystem", count: 2 },
			{ name: "claude_ai_Atlassian", count: 1 },
		]);
	});

	test("server name with underscores is parsed up to the first __ delimiter", () => {
		const cfg = extractSessionConfig([
			ev("PreToolUse", { tool_name: "mcp__claude_ai_Atlassian__search" }, 1),
		]);
		expect(cfg.mcp_servers[0]?.name).toBe("claude_ai_Atlassian");
	});

	test("does not double-count Post/Failure events for a single call", () => {
		const cfg = extractSessionConfig([
			ev("PreToolUse", { tool_name: "mcp__ide__executeCode" }, 1),
			ev("PostToolUse", { tool_name: "mcp__ide__executeCode" }, 2),
		]);
		expect(cfg.mcp_servers).toEqual([{ name: "ide", count: 1 }]);
	});

	test("empty MCP list when no mcp__ tools were used", () => {
		const cfg = extractSessionConfig([ev("PreToolUse", { tool_name: "Bash" }, 1)]);
		expect(cfg.mcp_servers).toEqual([]);
	});
});

describe("extractSessionConfig — CLAUDE.md realization (CFG-5)", () => {
	test("realizes claude_md_in_effect from InstructionsLoaded events (deduped)", () => {
		const cfg = extractSessionConfig([
			ev(
				"InstructionsLoaded",
				{
					file_path: "/p/CLAUDE.md",
					memory_type: "Project",
					load_reason: "session_start",
				},
				1,
			),
			ev("InstructionsLoaded", { file_path: "/p/CLAUDE.md", memory_type: "Project" }, 2),
			ev("InstructionsLoaded", { file_path: "/u/CLAUDE.md", memory_type: "User" }, 3),
		]);
		expect(cfg.claude_md_in_effect).toEqual([
			{ file_path: "/p/CLAUDE.md", memory_type: "Project", load_reason: "session_start" },
			{ file_path: "/u/CLAUDE.md", memory_type: "User" },
		]);
	});

	test("uses inferred fallback only when no InstructionsLoaded events were captured", () => {
		const fallback: readonly ClaudeMdInEffect[] = [
			{ file_path: "/p/CLAUDE.md", memory_type: "inferred" },
		];
		const cfg = extractSessionConfig([ev("PreToolUse", { tool_name: "Read" }, 1)], {
			claudeMdFallback: fallback,
		});
		expect(cfg.claude_md_in_effect).toEqual(fallback);
	});

	test("realized events take precedence over the inferred fallback", () => {
		const cfg = extractSessionConfig(
			[ev("InstructionsLoaded", { file_path: "/p/CLAUDE.md", memory_type: "Project" }, 1)],
			{ claudeMdFallback: [{ file_path: "/x/CLAUDE.md", memory_type: "inferred" }] },
		);
		expect(cfg.claude_md_in_effect).toEqual([
			{ file_path: "/p/CLAUDE.md", memory_type: "Project" },
		]);
	});

	test("omits claude_md_in_effect entirely when neither source yields entries", () => {
		const cfg = extractSessionConfig([ev("PreToolUse", { tool_name: "Read" }, 1)]);
		expect(cfg.claude_md_in_effect).toBeUndefined();
	});
});

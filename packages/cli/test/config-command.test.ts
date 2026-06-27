import { describe, expect, test } from "bun:test";
import { renderConfigSection } from "../src/commands/report";
import { formatConfigLine } from "../src/commands/what";
import type { SessionConfig } from "../src/types";

// -- ANSI stripping helper --

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const makeConfig = (overrides: Partial<SessionConfig> = {}): SessionConfig => ({
	permission_mode: "acceptEdits",
	effort: "high",
	mcp_servers: [
		{ name: "claude_ai_Atlassian", count: 5 },
		{ name: "filesystem", count: 2 },
	],
	...overrides,
});

describe("formatConfigLine (clens what)", () => {
	test("renders all segments joined with a dot separator", () => {
		const line = formatConfigLine(makeConfig());
		expect(line).toBe(
			"perm:acceptEdits · effort:high · mcp:claude_ai_Atlassian,filesystem",
		);
	});

	test("omits segments that have no data", () => {
		const line = formatConfigLine({ mcp_servers: [], effort: "low" });
		expect(line).toBe("effort:low");
	});

	test("returns undefined for undefined config", () => {
		expect(formatConfigLine(undefined)).toBeUndefined();
	});

	test("returns undefined when nothing is known", () => {
		expect(formatConfigLine({ mcp_servers: [] })).toBeUndefined();
	});
});

describe("renderConfigSection (clens report)", () => {
	test("returns [] for undefined config (old distills)", () => {
		expect(renderConfigSection(undefined)).toEqual([]);
	});

	test("returns [] when no fields are populated", () => {
		expect(renderConfigSection({ mcp_servers: [] })).toEqual([]);
	});

	test("renders a CONFIG / ENVIRONMENT heading with rows", () => {
		const out = renderConfigSection(makeConfig()).map(stripAnsi);
		expect(out.some((l) => l.includes("Config / Environment:"))).toBe(true);
		expect(out.some((l) => l.includes("Permission: acceptEdits"))).toBe(true);
		expect(out.some((l) => l.includes("Effort: high"))).toBe(true);
		expect(out.some((l) => l.includes("MCP servers: claude_ai_Atlassian (5), filesystem (2)"))).toBe(true);
	});

	test("uses a green LED for safe permission modes", () => {
		const raw = renderConfigSection(makeConfig({ permission_mode: "plan" }));
		const permRow = raw.find((l) => stripAnsi(l).includes("Permission:"));
		expect(permRow).toContain("\x1b[32m"); // green
		expect(permRow).not.toContain("\x1b[33m"); // not amber
	});

	test("uses an amber LED for relaxed permission modes", () => {
		for (const mode of ["bypassPermissions", "dontAsk"]) {
			const raw = renderConfigSection(makeConfig({ permission_mode: mode }));
			const permRow = raw.find((l) => stripAnsi(l).includes("Permission:"));
			expect(permRow).toContain("\x1b[33m"); // amber/yellow
		}
	});
});

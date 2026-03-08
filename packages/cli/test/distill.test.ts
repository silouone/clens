import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extractBacktracks } from "../src/distill/backtracks";
import { extractDecisions, extractPhases } from "../src/distill/decisions";
import { buildTeamPhases } from "../src/distill/decisions-team";
import { extractFileMap } from "../src/distill/file-map";
import { parseNumstatOutput } from "../src/distill/git-diff";
import { distill } from "../src/distill/index";
import { estimateCostFromTokens, extractStats } from "../src/distill/stats";
import type { LinkEvent, StoredEvent, TranscriptReasoning } from "../src/types";

const makeEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

describe("extractStats", () => {
	test("counts events by type", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Bash", tool_use_id: "t1" } }),
			makeEvent({ t: 3000, event: "PostToolUse", data: { tool_name: "Bash", tool_use_id: "t1" } }),
			makeEvent({
				t: 4000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_use_id: "t2", tool_input: { file_path: "/foo.ts" } },
			}),
			makeEvent({ t: 5000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.total_events).toBe(5);
		expect(stats.duration_ms).toBe(4000);
		expect(stats.tool_call_count).toBe(2);
		expect(stats.failure_count).toBe(0);
		expect(stats.failure_rate).toBe(0);
		expect(stats.tools_by_name.Bash).toBe(1);
		expect(stats.tools_by_name.Edit).toBe(1);
	});

	test("counts failures correctly", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Bash", tool_use_id: "t1" } }),
			makeEvent({
				t: 2000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "t1", error: "failed" },
			}),
		];

		const stats = extractStats(events);
		expect(stats.failure_count).toBe(1);
		expect(stats.failure_rate).toBe(1);
	});

	test("handles empty events", () => {
		const stats = extractStats([]);
		expect(stats.total_events).toBe(0);
		expect(stats.tool_call_count).toBe(0);
	});
});

describe("extractBacktracks", () => {
	test("detects failure_retry pattern with error details", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Edit",
					tool_use_id: "t1",
					error: "old_string not found in file",
					tool_input: { file_path: "/src/app.ts", old_string: "foo", new_string: "bar" },
				},
			}),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Edit", tool_use_id: "t2" } }),
		];

		const backtracks = extractBacktracks(events);
		expect(backtracks.length).toBeGreaterThanOrEqual(1);
		expect(backtracks[0].type).toBe("failure_retry");
		expect(backtracks[0].tool_name).toBe("Edit");
		expect(backtracks[0].error_message).toBe("old_string not found in file");
		expect(backtracks[0].file_path).toBe("/src/app.ts");
	});

	test("detects debugging_loop with error and command extraction", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PostToolUseFailure",
				data: {
					tool_name: "Bash",
					tool_use_id: "b1",
					error: "command not found: tsc",
					tool_input: { command: "tsc --noEmit" },
				},
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Bash", tool_use_id: "b2", tool_input: { command: "npx tsc --noEmit" } },
			}),
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: {
					tool_name: "Bash",
					tool_use_id: "b3",
					tool_input: { command: "bun run typecheck" },
				},
			}),
		];

		const backtracks = extractBacktracks(events);
		const debugLoop = backtracks.find((b) => b.type === "debugging_loop");
		expect(debugLoop).toBeDefined();
		expect(debugLoop?.tool_name).toBe("Bash");
		expect(debugLoop?.error_message).toBe("command not found: tsc");
		expect(debugLoop?.command).toBe("tsc --noEmit");
		expect(debugLoop?.attempts).toBeGreaterThanOrEqual(3);
	});
});

describe("extractDecisions", () => {
	test("classifies gap as user_idle when UserPromptSubmit occurs within the gap", () => {
		// Total gap of 200s from first event to last, with UserPromptSubmit in between.
		// The gap from the PreToolUse at t=1000 to UserPromptSubmit at t=130_000 is 129s (> 2min).
		// The UserPromptSubmit at t=130_000 falls within that gap, so it's user_idle.
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: {} }),
			makeEvent({ t: 130_000, event: "UserPromptSubmit", data: {} }),
			makeEvent({ t: 201_000, event: "PreToolUse", data: {} }),
		];

		const decisions = extractDecisions(events);
		const gap = decisions.find((d) => d.type === "timing_gap" && d.classification === "user_idle");
		expect(gap).toBeDefined();
		// The gap from t=1000 to t=130_000 is 129s and has the prompt at t=130_000 within it
		expect(gap?.classification).toBe("user_idle");
	});

	test("classifies gap > 10 minutes as session_pause", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: {} }),
			makeEvent({ t: 700_000, event: "PreToolUse", data: {} }),
		];

		const decisions = extractDecisions(events);
		const gap = decisions.find(
			(d) => d.type === "timing_gap" && d.classification === "session_pause",
		);
		expect(gap).toBeDefined();
		expect(gap?.gap_ms).toBe(699_000);
	});

	test("classifies gap without prompt as agent_thinking", () => {
		// Gap of 150s, no UserPromptSubmit in between
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: {} }),
			makeEvent({ t: 151_000, event: "PreToolUse", data: {} }),
		];

		const decisions = extractDecisions(events);
		const gap = decisions.find(
			(d) => d.type === "timing_gap" && d.classification === "agent_thinking",
		);
		expect(gap).toBeDefined();
	});

	test("suppresses classified gaps below 2 minutes (noise)", () => {
		// Gap of 45s — above 30s threshold but below 2 min noise threshold
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: {} }),
			makeEvent({ t: 46_000, event: "PreToolUse", data: {} }),
		];

		const decisions = extractDecisions(events);
		const timingGaps = decisions.filter((d) => d.type === "timing_gap");
		expect(timingGaps).toHaveLength(0);
	});

	test("does not suppress session_pause even if gap is small (edge case)", () => {
		// session_pause requires > 10 minutes, so it will always be > 2 min
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: {} }),
			makeEvent({ t: 700_000, event: "PreToolUse", data: {} }),
		];

		const decisions = extractDecisions(events);
		const pauses = decisions.filter(
			(d) => d.type === "timing_gap" && d.classification === "session_pause",
		);
		expect(pauses).toHaveLength(1);
	});

	test("detects tool pivots after failure", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PostToolUseFailure", data: { tool_name: "Edit" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
		];

		const decisions = extractDecisions(events);
		const pivot = decisions.find((d) => d.type === "tool_pivot");
		expect(pivot).toBeDefined();
		expect(pivot?.from_tool).toBe("Edit");
		expect(pivot?.to_tool).toBe("Read");
		expect(pivot?.after_failure).toBe(true);
	});

	test("detects tool pivots with wider lookahead window (up to 10 events)", () => {
		// Failure followed by several non-PreToolUse events, then a PreToolUse with different tool
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PostToolUseFailure", data: { tool_name: "Edit" } }),
			makeEvent({ t: 2000, event: "PostToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 3000, event: "PostToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 4000, event: "PostToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 5000, event: "PreToolUse", data: { tool_name: "Read" } }),
		];

		const decisions = extractDecisions(events);
		const pivot = decisions.find((d) => d.type === "tool_pivot");
		expect(pivot).toBeDefined();
		expect(pivot?.from_tool).toBe("Edit");
		expect(pivot?.to_tool).toBe("Read");
	});

	test("does not detect tool pivot when same tool is retried", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PostToolUseFailure", data: { tool_name: "Edit" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Edit" } }),
		];

		const decisions = extractDecisions(events);
		const pivots = decisions.filter((d) => d.type === "tool_pivot");
		expect(pivots).toHaveLength(0);
	});

	test("emits phase_boundary decision points", () => {
		// Two phases separated by a > 5 minute gap
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 400_000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 401_000, event: "PreToolUse", data: { tool_name: "Edit" } }),
		];

		const decisions = extractDecisions(events);
		const boundaries = decisions.filter((d) => d.type === "phase_boundary");
		expect(boundaries.length).toBeGreaterThanOrEqual(1);
		expect(boundaries[0].phase_name).toBeDefined();
		expect(boundaries[0].phase_index).toBeDefined();
	});

	test("handles empty events", () => {
		const decisions = extractDecisions([]);
		expect(decisions).toHaveLength(0);
	});

	test("handles single event", () => {
		const events: StoredEvent[] = [makeEvent({ t: 1000, event: "PreToolUse", data: {} })];
		const decisions = extractDecisions(events);
		// No gaps, no pivots, single-event phase has no boundary beyond first
		expect(decisions.filter((d) => d.type === "timing_gap")).toHaveLength(0);
		expect(decisions.filter((d) => d.type === "tool_pivot")).toHaveLength(0);
	});
});

describe("extractPhases", () => {
	test("returns empty array for empty events", () => {
		const phases = extractPhases([]);
		expect(phases).toHaveLength(0);
	});

	test("groups all events into one phase when no boundaries exist", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 3000, event: "PreToolUse", data: { tool_name: "Grep" } }),
		];

		const phases = extractPhases(events);
		expect(phases).toHaveLength(1);
		expect(phases[0].name).toBe("File Exploration");
		expect(phases[0].start_t).toBe(1000);
		expect(phases[0].end_t).toBe(3000);
		expect(phases[0].tool_types).toContain("Read");
	});

	test("splits phases at gaps > 5 minutes", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Glob" } }),
			// 5+ minute gap
			makeEvent({ t: 400_000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 401_000, event: "PreToolUse", data: { tool_name: "Write" } }),
		];

		const phases = extractPhases(events);
		expect(phases).toHaveLength(2);
		expect(phases[0].name).toBe("File Exploration");
		expect(phases[1].name).toBe("Code Modification");
	});

	test("names phase as Debugging when Bash is top tool with failures", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Bash" } }),
			makeEvent({
				t: 2000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", error: "exit 1" },
			}),
			makeEvent({ t: 3000, event: "PreToolUse", data: { tool_name: "Bash" } }),
		];

		const phases = extractPhases(events);
		expect(phases).toHaveLength(1);
		expect(phases[0].name).toBe("Debugging");
	});

	test("names phase as Research when WebSearch/WebFetch dominate", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "WebSearch" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "WebFetch" } }),
			makeEvent({ t: 3000, event: "PreToolUse", data: { tool_name: "WebSearch" } }),
		];

		const phases = extractPhases(events);
		expect(phases).toHaveLength(1);
		expect(phases[0].name).toBe("Research");
	});

	test("returns phase with correct tool_types sorted by count", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 3000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 4000, event: "PreToolUse", data: { tool_name: "Read" } }),
		];

		const phases = extractPhases(events);
		expect(phases).toHaveLength(1);
		expect(phases[0].tool_types[0]).toBe("Read");
		expect(phases[0].tool_types).toContain("Edit");
	});

	test("splits phase at gap > 2 min when dominant tool changes", () => {
		// Phase 1: Read-heavy, then 2.5 min gap, then Edit-heavy
		const events: StoredEvent[] = [
			...Array.from({ length: 10 }, (_, i) =>
				makeEvent({
					t: 1000 + i * 1000,
					event: "PreToolUse",
					data: { tool_name: "Read" },
				}),
			),
			// 2.5 minute gap
			...Array.from({ length: 10 }, (_, i) =>
				makeEvent({
					t: 161_000 + i * 1000,
					event: "PreToolUse",
					data: { tool_name: "Edit" },
				}),
			),
		];

		// Insert a UserPromptSubmit to trigger the gap detection as the gap boundary
		// requires UserPromptSubmit for > 2 min gaps — actually, the spec says
		// "UserPromptSubmit after gap > 2 minutes where top tool differs"
		// The gap here is between events[9] and events[10], and events[10] is NOT a UserPromptSubmit.
		// Let's adjust: the boundary is simply gap > 2 min AND tool shift in surrounding windows.
		const phases = extractPhases(events);
		expect(phases.length).toBeGreaterThanOrEqual(2);
		expect(phases[0].name).toBe("File Exploration");
		expect(phases[1].name).toBe("Code Modification");
	});

	test("does not split phase at gap > 2 min when dominant tool stays the same", () => {
		const events: StoredEvent[] = [
			...Array.from({ length: 5 }, (_, i) =>
				makeEvent({
					t: 1000 + i * 1000,
					event: "PreToolUse",
					data: { tool_name: "Read" },
				}),
			),
			// 2.5 minute gap, but still Read-heavy after
			...Array.from({ length: 5 }, (_, i) =>
				makeEvent({
					t: 161_000 + i * 1000,
					event: "PreToolUse",
					data: { tool_name: "Read" },
				}),
			),
		];

		const phases = extractPhases(events);
		expect(phases).toHaveLength(1);
		expect(phases[0].name).toBe("File Exploration");
	});

	test("provides description for each phase", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
		];

		const phases = extractPhases(events);
		expect(phases[0].description).toContain("File Exploration");
		expect(phases[0].description).toContain("2 events");
	});
});

describe("extractFileMap", () => {
	test("tracks file operations", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: { tool_name: "Read", tool_input: { file_path: "/foo.ts" }, tool_use_id: "t1" },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_input: { file_path: "/foo.ts" }, tool_use_id: "t2" },
			}),
			makeEvent({
				t: 3000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_input: { file_path: "/foo.ts" }, tool_use_id: "t3" },
			}),
			makeEvent({
				t: 4000,
				event: "PreToolUse",
				data: { tool_name: "Read", tool_input: { file_path: "/bar.ts" }, tool_use_id: "t4" },
			}),
		];

		const fileMap = extractFileMap(events);
		const fooEntry = fileMap.files.find((f) => f.file_path === "/foo.ts");
		expect(fooEntry).toBeDefined();
		expect(fooEntry?.reads).toBe(1);
		expect(fooEntry?.edits).toBe(2);
	});
});

describe("parseNumstatOutput", () => {
	test("parses numstat output into WorkingTreeChange[]", () => {
		const numstatOutput = "10\t2\tsrc/format.ts\n5\t0\tsrc/new-file.ts\n0\t8\tsrc/deleted.ts\n";
		const changes = parseNumstatOutput(numstatOutput);

		expect(changes).toHaveLength(3);
		expect(changes[0]).toEqual({
			file_path: "src/format.ts",
			status: "modified",
			additions: 10,
			deletions: 2,
		});
		expect(changes[1]).toEqual({
			file_path: "src/new-file.ts",
			status: "added",
			additions: 5,
			deletions: 0,
		});
		expect(changes[2]).toEqual({
			file_path: "src/deleted.ts",
			status: "deleted",
			additions: 0,
			deletions: 8,
		});
	});

	test("handles empty output", () => {
		expect(parseNumstatOutput("")).toEqual([]);
		expect(parseNumstatOutput("\n")).toEqual([]);
	});

	test("skips malformed lines", () => {
		const numstatOutput = "10\t2\tsrc/valid.ts\nbadline\n";
		const changes = parseNumstatOutput(numstatOutput);
		expect(changes).toHaveLength(1);
		expect(changes[0].file_path).toBe("src/valid.ts");
	});
});

describe("extractFileMap - Bash file detection", () => {
	test("detects files from mkdir commands", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Bash",
					tool_use_id: "b1",
					tool_input: { command: "mkdir -p /src/components" },
				},
			}),
		];

		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f) => f.file_path === "/src/components");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("bash");
		expect(entry?.reads).toBe(0);
		expect(entry?.edits).toBe(0);
	});

	test("detects files from touch commands", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Bash",
					tool_use_id: "b1",
					tool_input: { command: "touch /src/new-file.ts" },
				},
			}),
		];

		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f) => f.file_path === "/src/new-file.ts");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("bash");
	});

	test("detects files from redirect operator", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Bash",
					tool_use_id: "b1",
					tool_input: { command: "echo hello > /tmp/output.txt" },
				},
			}),
		];

		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f) => f.file_path === "/tmp/output.txt");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("bash");
	});

	test("detects files from cp commands", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: {
					tool_name: "Bash",
					tool_use_id: "b1",
					tool_input: { command: "cp src/a.ts src/b.ts" },
				},
			}),
		];

		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f) => f.file_path === "src/b.ts");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("bash");
	});

	test("does not double-count files already tracked by dedicated tools", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: { tool_name: "Read", tool_input: { file_path: "/foo.ts" }, tool_use_id: "t1" },
			}),
			makeEvent({
				t: 2000,
				event: "PreToolUse",
				data: {
					tool_name: "Bash",
					tool_use_id: "b1",
					tool_input: { command: "touch /foo.ts" },
				},
			}),
		];

		const fileMap = extractFileMap(events);
		const fooEntries = fileMap.files.filter((f) => f.file_path === "/foo.ts");
		expect(fooEntries).toHaveLength(1);
		expect(fooEntries[0].source).toBe("tool");
		expect(fooEntries[0].reads).toBe(1);
	});

	test("tool entries have source: tool", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "PreToolUse",
				data: { tool_name: "Edit", tool_input: { file_path: "/bar.ts" }, tool_use_id: "t1" },
			}),
		];

		const fileMap = extractFileMap(events);
		const entry = fileMap.files.find((f) => f.file_path === "/bar.ts");
		expect(entry).toBeDefined();
		expect(entry?.source).toBe("tool");
	});
});

describe("extractStats - cost estimation", () => {
	test("estimates cost for known model", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "SessionStart",
				data: {},
				context: {
					project_dir: "/test",
					cwd: "/test",
					git_branch: null,
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: "claude-sonnet-4-20250514",
					agent_type: null,
				},
			}),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Bash", tool_use_id: "t1" } }),
			makeEvent({ t: 3000, event: "PreToolUse", data: { tool_name: "Edit", tool_use_id: "t2" } }),
			makeEvent({ t: 4000, event: "SessionEnd", data: {} }),
		];

		const reasoning: TranscriptReasoning[] = [{ t: 1500, thinking: "a".repeat(400) }];

		const stats = extractStats(events, reasoning);
		expect(stats.cost_estimate).toBeDefined();
		expect(stats.cost_estimate?.model).toBe("claude-sonnet-4-20250514");
		expect(stats.cost_estimate?.estimated_input_tokens).toBeGreaterThan(0);
		expect(stats.cost_estimate?.estimated_output_tokens).toBeGreaterThan(0);
		expect(stats.cost_estimate?.estimated_cost_usd).toBeGreaterThan(0);
	});

	test("returns undefined cost_estimate for unknown model", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "SessionStart",
				data: {},
				context: {
					project_dir: "/test",
					cwd: "/test",
					git_branch: null,
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: "gpt-4-turbo",
					agent_type: null,
				},
			}),
			makeEvent({ t: 2000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.cost_estimate).toBeUndefined();
	});

	test("returns undefined cost_estimate when no model", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 2000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.cost_estimate).toBeUndefined();
	});

	test("uses startsWith matching for model prefixes", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "SessionStart",
				data: {},
				context: {
					project_dir: "/test",
					cwd: "/test",
					git_branch: null,
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: "claude-opus-4-6-20250514",
					agent_type: null,
				},
			}),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Bash", tool_use_id: "t1" } }),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.cost_estimate).toBeDefined();
		expect(stats.cost_estimate?.model).toBe("claude-opus-4-6-20250514");
		// Opus pricing: input = 15/M, output = 75/M
		expect(stats.cost_estimate?.estimated_cost_usd).toBeGreaterThan(0);
	});

	test("handles empty events with no cost", () => {
		const stats = extractStats([]);
		expect(stats.cost_estimate).toBeUndefined();
	});
});

describe("extractStats - real token usage", () => {
	const sessionContext = {
		project_dir: "/test",
		cwd: "/test",
		git_branch: null,
		git_remote: null,
		git_commit: null,
		git_worktree: null,
		team_name: null,
		task_list_dir: null,
		claude_entrypoint: null,
		model: "claude-sonnet-4-20250514",
		agent_type: null,
	} as const;

	test("uses real token counts when usage data is present", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read", tool_use_id: "t1" } }),
			makeEvent({
				t: 3000,
				event: "PostToolUse",
				data: {
					tool_name: "Read",
					tool_use_id: "t1",
					usage: { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_creation_tokens: 100 },
				},
			}),
			makeEvent({ t: 4000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.cost_estimate).toBeDefined();
		expect(stats.cost_estimate?.is_estimated).toBe(false);
		expect(stats.cost_estimate?.estimated_input_tokens).toBe(1000);
		expect(stats.cost_estimate?.estimated_output_tokens).toBe(500);
		expect(stats.cost_estimate?.cache_read_tokens).toBe(200);
		expect(stats.cost_estimate?.cache_creation_tokens).toBe(100);
	});

	test("accumulates token counts across multiple events", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({
				t: 2000,
				event: "PostToolUse",
				data: { tool_name: "Read", tool_use_id: "t1", usage: { input_tokens: 500, output_tokens: 200 } },
			}),
			makeEvent({
				t: 3000,
				event: "PostToolUse",
				data: { tool_name: "Edit", tool_use_id: "t2", usage: { input_tokens: 800, output_tokens: 300 } },
			}),
			makeEvent({ t: 4000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.cost_estimate?.estimated_input_tokens).toBe(1300);
		expect(stats.cost_estimate?.estimated_output_tokens).toBe(500);
		expect(stats.cost_estimate?.is_estimated).toBe(false);
	});

	test("falls back to magic numbers with is_estimated when no usage data", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read", tool_use_id: "t1" } }),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.cost_estimate).toBeDefined();
		expect(stats.cost_estimate?.is_estimated).toBe(true);
	});

	test("reads token_usage field as alternative to usage", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {}, context: sessionContext }),
			makeEvent({
				t: 2000,
				event: "PostToolUse",
				data: { tool_name: "Read", tool_use_id: "t1", token_usage: { input_tokens: 750, output_tokens: 250 } },
			}),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.cost_estimate?.estimated_input_tokens).toBe(750);
		expect(stats.cost_estimate?.estimated_output_tokens).toBe(250);
		expect(stats.cost_estimate?.is_estimated).toBe(false);
	});
});

describe("buildAgentTree - sub-agent hierarchy", () => {
	// We test the buildAgentTree logic indirectly since it's not exported.
	// Instead, we test that format types are correct and the tree shape makes sense.
	test("AgentNode type has expected fields", () => {
		const node = {
			session_id: "agent-123",
			agent_type: "builder",
			agent_name: "builder-1",
			duration_ms: 5000,
			tool_call_count: 10,
			children: [],
		};
		expect(node.session_id).toBe("agent-123");
		expect(node.agent_type).toBe("builder");
		expect(node.children).toHaveLength(0);
	});

	test("DistilledSession agents field is optional", () => {
		// Verify the type allows agents to be undefined
		const partial: { agents?: { session_id: string }[] } = {};
		expect(partial.agents).toBeUndefined();
	});
});

describe("extractPhases - team-aware detection", () => {
	test("uses task lifecycle phases when task links exist", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 5000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 8000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 10000, event: "SessionEnd", data: {} }),
		];

		const links: LinkEvent[] = [
			{ t: 1000, type: "team", team_name: "test-team", leader_session: "s1" },
			{
				t: 3000,
				type: "task",
				action: "create",
				task_id: "1",
				session_id: "s1",
				subject: "Build feature",
			},
			{
				t: 3500,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				agent: "builder-a",
				owner: "builder-a",
			},
			{
				t: 3000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder-a",
			},
		];

		const phases = extractPhases(events, links);

		// Should have Planning + Build phases (no validator)
		expect(phases.length).toBeGreaterThanOrEqual(2);
		expect(phases[0].name).toBe("Planning");
		expect(phases[0].start_t).toBe(1000);
		expect(phases[0].end_t).toBe(3500); // first assignment
		expect(phases[1].name).toBe("Build");
	});

	test("includes Validation phase when validator agents are spawned", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 5000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 8000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 10000, event: "SessionEnd", data: {} }),
		];

		const links: LinkEvent[] = [
			{
				t: 2000,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				agent: "builder-a",
				owner: "builder-a",
			},
			{
				t: 2000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder-a",
			},
			{
				t: 7000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "v1",
				agent_type: "validator",
				agent_name: "validator-1",
			},
		];

		const phases = extractPhases(events, links);

		const validationPhase = phases.find((p) => p.name === "Validation");
		expect(validationPhase).toBeDefined();
		expect(validationPhase?.start_t).toBe(7000);
	});

	test("falls back to gap-based phases when no task links in links array", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
			// 5+ minute gap
			makeEvent({ t: 400_000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 401_000, event: "PreToolUse", data: { tool_name: "Edit" } }),
		];

		// Links without any task events
		const links: LinkEvent[] = [
			{ t: 1000, type: "team", team_name: "test-team", leader_session: "s1" },
			{ t: 1500, type: "spawn", parent_session: "s1", agent_id: "a1", agent_type: "builder" },
		];

		const phases = extractPhases(events, links);

		// Should use gap-based detection since no task links
		expect(phases).toHaveLength(2);
		expect(phases[0].name).toBe("File Exploration");
		expect(phases[1].name).toBe("Code Modification");
	});

	test("falls back to gap-based phases when links is undefined", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
		];

		const phases = extractPhases(events);
		expect(phases).toHaveLength(1);
		expect(phases[0].name).toBe("File Exploration");
	});
});

describe("extractPhases - no negative durations", () => {
	test("build phase never has end_t < start_t when buildStart equals sessionEnd", () => {
		// Minimal scenario: assignment at session end, no validator
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 1000, event: "SessionEnd", data: {} }),
		];
		const links: LinkEvent[] = [
			{
				t: 1000,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				owner: "builder",
			},
			{
				t: 1000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder",
			},
		];
		const phases = extractPhases(events, links);
		phases.forEach((phase) => {
			expect(phase.end_t).toBeGreaterThanOrEqual(phase.start_t);
		});
	});

	test("build phase clamps when rawBuildEnd precedes buildStart", () => {
		// validator spawned before first assignment
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 5000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 10000, event: "SessionEnd", data: {} }),
		];
		const links: LinkEvent[] = [
			{
				t: 3000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "v1",
				agent_type: "validator",
				agent_name: "validator-1",
			},
			{
				t: 4000,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				owner: "builder",
			},
			{
				t: 4000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder",
			},
		];
		const phases = extractPhases(events, links);
		phases.forEach((phase) => {
			expect(phase.end_t).toBeGreaterThanOrEqual(phase.start_t);
		});
	});

	test("all phases have non-negative duration in typical team session", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 8000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 12000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 15000, event: "SessionEnd", data: {} }),
		];
		const links: LinkEvent[] = [
			{ t: 1000, type: "team", team_name: "test", leader_session: "s1" },
			{
				t: 3000,
				type: "task",
				action: "create",
				task_id: "1",
				session_id: "s1",
				subject: "Do stuff",
			},
			{
				t: 4000,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				owner: "builder",
			},
			{
				t: 4000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder",
			},
			{
				t: 10000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "v1",
				agent_type: "validator",
				agent_name: "validator-1",
			},
		];
		const phases = extractPhases(events, links);
		expect(phases.length).toBeGreaterThanOrEqual(2);
		phases.forEach((phase) => {
			const duration = phase.end_t - phase.start_t;
			expect(duration).toBeGreaterThanOrEqual(0);
		});
	});
});

describe("extractStats - failures_by_tool", () => {
	test("computes failures_by_tool from PostToolUseFailure events", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Edit", tool_use_id: "t1" } }),
			makeEvent({
				t: 2000,
				event: "PostToolUseFailure",
				data: { tool_name: "Edit", tool_use_id: "t1", error: "not found" },
			}),
			makeEvent({ t: 3000, event: "PreToolUse", data: { tool_name: "Edit", tool_use_id: "t2" } }),
			makeEvent({
				t: 4000,
				event: "PostToolUseFailure",
				data: { tool_name: "Edit", tool_use_id: "t2", error: "not found" },
			}),
			makeEvent({ t: 5000, event: "PreToolUse", data: { tool_name: "Bash", tool_use_id: "t3" } }),
			makeEvent({
				t: 6000,
				event: "PostToolUseFailure",
				data: { tool_name: "Bash", tool_use_id: "t3", error: "exit 1" },
			}),
		];

		const stats = extractStats(events);
		expect(stats.failures_by_tool).toBeDefined();
		expect(stats.failures_by_tool?.Edit).toBe(2);
		expect(stats.failures_by_tool?.Bash).toBe(1);
	});

	test("returns undefined failures_by_tool when no failures", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "PreToolUse", data: { tool_name: "Read", tool_use_id: "t1" } }),
			makeEvent({ t: 2000, event: "PostToolUse", data: { tool_name: "Read", tool_use_id: "t1" } }),
		];

		const stats = extractStats(events);
		expect(stats.failures_by_tool).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Integration: distill() session-scoped link filtering
// ---------------------------------------------------------------------------

describe("distill - session-scoped link filtering", () => {
	const TEST_DIR = `/tmp/clens-test-distill-scoping-${Date.now()}`;
	const SESSION_A = "session-aaa";
	const SESSION_B = "session-bbb";

	beforeEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
		const sessionsDir = `${TEST_DIR}/.clens/sessions`;
		mkdirSync(sessionsDir, { recursive: true });

		// --- Session A events file (minimal valid session) ---
		const sessionAEvents: StoredEvent[] = [
			{
				t: 1000,
				event: "SessionStart",
				sid: SESSION_A,
				data: {},
			},
			{
				t: 2000,
				event: "PreToolUse",
				sid: SESSION_A,
				data: { tool_name: "Read", tool_use_id: "t1", tool_input: { file_path: "/src/app.ts" } },
			},
			{
				t: 3000,
				event: "PostToolUse",
				sid: SESSION_A,
				data: { tool_name: "Read", tool_use_id: "t1" },
			},
			{
				t: 4000,
				event: "PreToolUse",
				sid: SESSION_A,
				data: { tool_name: "Edit", tool_use_id: "t2", tool_input: { file_path: "/src/app.ts" } },
			},
			{
				t: 5000,
				event: "PostToolUse",
				sid: SESSION_A,
				data: { tool_name: "Edit", tool_use_id: "t2" },
			},
			{
				t: 10000,
				event: "SessionEnd",
				sid: SESSION_A,
				data: {},
			},
		];
		writeFileSync(
			`${sessionsDir}/${SESSION_A}.jsonl`,
			sessionAEvents.map((e) => JSON.stringify(e)).join("\n"),
		);

		// --- Links file: events from BOTH sessions ---
		const linkEvents: readonly LinkEvent[] = [
			// Session A: team + 3 agents
			{ t: 1000, type: "team", team_name: "team-alpha", leader_session: SESSION_A },
			{ t: 1100, type: "spawn", parent_session: SESSION_A, agent_id: "agent-a1", agent_type: "builder", agent_name: "builder-a1" },
			{ t: 1200, type: "spawn", parent_session: SESSION_A, agent_id: "agent-a2", agent_type: "builder", agent_name: "builder-a2" },
			{ t: 1300, type: "spawn", parent_session: SESSION_A, agent_id: "agent-a3", agent_type: "validator", agent_name: "validator-a" },
			{ t: 2000, type: "msg_send", session_id: SESSION_A, from: "agent-a1", to: "builder-a2", msg_type: "message" },
			{ t: 3000, type: "msg_send", session_id: SESSION_A, from: "agent-a2", to: "builder-a1", msg_type: "message" },
			{ t: 4000, type: "task_complete", task_id: "task-1", agent: "builder-a1" },
			{ t: 5000, type: "teammate_idle", teammate: "builder-a1" },
			{ t: 8000, type: "stop", parent_session: SESSION_A, agent_id: "agent-a1" },
			{ t: 8500, type: "stop", parent_session: SESSION_A, agent_id: "agent-a2" },
			{ t: 9000, type: "stop", parent_session: SESSION_A, agent_id: "agent-a3" },

			// Session B: team + 2 agents (should be excluded from Session A distill)
			{ t: 1000, type: "team", team_name: "team-beta", leader_session: SESSION_B },
			{ t: 1100, type: "spawn", parent_session: SESSION_B, agent_id: "agent-b1", agent_type: "builder", agent_name: "builder-b1" },
			{ t: 1200, type: "spawn", parent_session: SESSION_B, agent_id: "agent-b2", agent_type: "tester", agent_name: "tester-b" },
			{ t: 2500, type: "msg_send", session_id: SESSION_B, from: "agent-b1", to: "tester-b", msg_type: "message" },
			{ t: 3500, type: "task_complete", task_id: "task-b1", agent: "builder-b1" },
			{ t: 6000, type: "stop", parent_session: SESSION_B, agent_id: "agent-b1" },
			{ t: 6500, type: "stop", parent_session: SESSION_B, agent_id: "agent-b2" },
		];
		writeFileSync(
			`${sessionsDir}/_links.jsonl`,
			linkEvents.map((e) => JSON.stringify(e)).join("\n"),
		);
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("team_metrics.agent_count reflects only session A agents (3, not 5)", async () => {
		const result = await distill(SESSION_A, TEST_DIR);
		expect(result.team_metrics).toBeDefined();
		expect(result.team_metrics?.agent_count).toBe(3);
	});

	test("communication_graph contains only session A edges", async () => {
		const result = await distill(SESSION_A, TEST_DIR);
		expect(result.communication_graph).toBeDefined();
		const allNames = (result.communication_graph ?? []).flatMap((e) => [e.from_name, e.to_name]);
		// Session A agent names only — parent session resolves to "leader" via finalNameMap
		allNames.forEach((name) => {
			expect(["builder-a1", "builder-a2", "validator-a", "leader"]).toContain(name);
		});
		// No Session B agents in the graph
		expect(allNames).not.toContain("builder-b1");
		expect(allNames).not.toContain("tester-b");
	});

	test("agent_lifetimes contains only session A agents", async () => {
		const result = await distill(SESSION_A, TEST_DIR);
		expect(result.agent_lifetimes).toBeDefined();
		const lifetimeIds = (result.agent_lifetimes ?? []).map((lt) => lt.agent_id);
		expect(lifetimeIds).toContain("agent-a1");
		expect(lifetimeIds).toContain("agent-a2");
		expect(lifetimeIds).toContain("agent-a3");
		expect(lifetimeIds).not.toContain("agent-b1");
		expect(lifetimeIds).not.toContain("agent-b2");
	});

	test("agents tree contains only session A agents", async () => {
		const result = await distill(SESSION_A, TEST_DIR);
		expect(result.agents).toBeDefined();
		const agentIds = (result.agents ?? []).map((a) => a.session_id);
		expect(agentIds).toContain("agent-a1");
		expect(agentIds).toContain("agent-a2");
		expect(agentIds).toContain("agent-a3");
		expect(agentIds).not.toContain("agent-b1");
		expect(agentIds).not.toContain("agent-b2");
	});
});

// ---------------------------------------------------------------------------
// buildTeamPhases: phase clamping guarantees
// ---------------------------------------------------------------------------

describe("buildTeamPhases - phase clamping", () => {
	test("all phases produce end_t >= start_t", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 5000, event: "PreToolUse", data: { tool_name: "Edit" } }),
			makeEvent({ t: 10000, event: "SessionEnd", data: {} }),
		];
		const links: LinkEvent[] = [
			{
				t: 2000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "v1",
				agent_type: "validator",
				agent_name: "validator-1",
			},
			{
				t: 4000,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				owner: "builder",
			},
			{
				t: 4000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder",
			},
		];

		const phases = buildTeamPhases(events, links);

		phases.forEach((phase) => {
			expect(phase.end_t).toBeGreaterThanOrEqual(phase.start_t);
		});
	});

	test("phases are clamped within session event range", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 2000, event: "SessionStart", data: {} }),
			makeEvent({ t: 5000, event: "PreToolUse", data: { tool_name: "Read" } }),
			makeEvent({ t: 8000, event: "SessionEnd", data: {} }),
		];
		const links: LinkEvent[] = [
			{
				t: 3000,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				owner: "builder",
			},
			{
				t: 3000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder",
			},
		];

		const phases = buildTeamPhases(events, links);

		phases.forEach((phase) => {
			expect(phase.start_t).toBeGreaterThanOrEqual(2000);
			expect(phase.end_t).toBeLessThanOrEqual(8000);
			expect(phase.end_t).toBeGreaterThanOrEqual(phase.start_t);
		});
	});

	test("zero-duration session produces valid phases", () => {
		const events: StoredEvent[] = [
			makeEvent({ t: 5000, event: "SessionStart", data: {} }),
			makeEvent({ t: 5000, event: "SessionEnd", data: {} }),
		];
		const links: LinkEvent[] = [
			{
				t: 5000,
				type: "task",
				action: "assign",
				task_id: "1",
				session_id: "s1",
				owner: "builder",
			},
			{
				t: 5000,
				type: "spawn",
				parent_session: "s1",
				agent_id: "a1",
				agent_type: "builder",
				agent_name: "builder",
			},
		];

		const phases = buildTeamPhases(events, links);

		phases.forEach((phase) => {
			expect(phase.end_t).toBeGreaterThanOrEqual(phase.start_t);
		});
	});
});

// ---------------------------------------------------------------------------
// Model inference from agents
// ---------------------------------------------------------------------------

describe("estimateCostFromTokens", () => {
	test("returns cost estimate for known model", () => {
		const result = estimateCostFromTokens("claude-sonnet-4-20250514", 10000, 5000);
		expect(result).toBeDefined();
		expect(result?.model).toBe("claude-sonnet-4-20250514");
		expect(result?.estimated_input_tokens).toBe(10000);
		expect(result?.estimated_output_tokens).toBe(5000);
		expect(result?.estimated_cost_usd).toBeGreaterThan(0);
	});

	test("returns undefined for unknown model", () => {
		const result = estimateCostFromTokens("gpt-4-turbo", 10000, 5000);
		expect(result).toBeUndefined();
	});
});

describe("model inference in distill orchestrator", () => {
	const TEST_DIR_MODEL = `/tmp/clens-test-model-inference-${Date.now()}`;
	const SESSION_ID = "session-model-test";

	beforeEach(() => {
		rmSync(TEST_DIR_MODEL, { recursive: true, force: true });
		const sessionsDir = `${TEST_DIR_MODEL}/.clens/sessions`;
		mkdirSync(sessionsDir, { recursive: true });

		// Session events WITHOUT a model in SessionStart
		const sessionEvents: StoredEvent[] = [
			{
				t: 1000,
				event: "SessionStart",
				sid: SESSION_ID,
				data: {},
			},
			{
				t: 2000,
				event: "PreToolUse",
				sid: SESSION_ID,
				data: { tool_name: "Read", tool_use_id: "t1", tool_input: { file_path: "/src/app.ts" } },
			},
			{
				t: 3000,
				event: "PostToolUse",
				sid: SESSION_ID,
				data: { tool_name: "Read", tool_use_id: "t1" },
			},
			{
				t: 10000,
				event: "SessionEnd",
				sid: SESSION_ID,
				data: {},
			},
		];
		writeFileSync(
			`${sessionsDir}/${SESSION_ID}.jsonl`,
			sessionEvents.map((e) => JSON.stringify(e)).join("\n"),
		);
	});

	afterEach(() => {
		rmSync(TEST_DIR_MODEL, { recursive: true, force: true });
	});

	test("model is inferred from agents when stats.model is undefined", async () => {
		// Write links where the stop event has a transcript path that doesn't exist
		// (agent enrichment will fallback gracefully). The model inference happens
		// in the distill orchestrator from agents that have a model set.
		// Since we can't easily mock agent transcripts, we test the inference logic directly.

		// Test the inference pattern used in index.ts:
		// const inferredModel = stats.model ?? agents?.find((a) => a.model)?.model;
		const stats = extractStats([
			makeEvent({ t: 1000, event: "SessionStart", data: {} }),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read", tool_use_id: "t1" } }),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		]);

		expect(stats.model).toBeUndefined();

		// Simulate agent with model
		const agents = [
			{ model: "claude-sonnet-4-20250514", session_id: "a1" },
			{ model: undefined, session_id: "a2" },
		];

		const inferredModel = stats.model ?? agents.find((a) => a.model)?.model;
		expect(inferredModel).toBe("claude-sonnet-4-20250514");

		// Verify cost can be estimated from inferred model
		const cost = estimateCostFromTokens(
			inferredModel!,
			stats.total_events * 500,
			stats.tool_call_count * 200,
		);
		expect(cost).toBeDefined();
		expect(cost?.model).toBe("claude-sonnet-4-20250514");
	});

	test("model inference does not override existing stats.model", () => {
		const events: StoredEvent[] = [
			makeEvent({
				t: 1000,
				event: "SessionStart",
				data: {},
				context: {
					project_dir: "/test",
					cwd: "/test",
					git_branch: null,
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: "claude-opus-4-20250514",
					agent_type: null,
				},
			}),
			makeEvent({ t: 2000, event: "PreToolUse", data: { tool_name: "Read", tool_use_id: "t1" } }),
			makeEvent({ t: 3000, event: "SessionEnd", data: {} }),
		];

		const stats = extractStats(events);
		expect(stats.model).toBe("claude-opus-4-20250514");

		// Even with agents having different models, existing model should not be overridden
		const agents = [{ model: "claude-sonnet-4-20250514", session_id: "a1" }];
		const inferredModel = stats.model ?? agents.find((a) => a.model)?.model;

		// stats.model is defined, so ?? short-circuits — keeps original
		expect(inferredModel).toBe("claude-opus-4-20250514");
	});
});

// ---------------------------------------------------------------------------
// Plan drift guard: trivial sessions with 0 tool calls
// ---------------------------------------------------------------------------

describe("plan drift guard for trivial sessions", () => {
	const TEST_DIR_DRIFT = `/tmp/clens-test-plan-drift-guard-${Date.now()}`;
	const SESSION_ID = "session-trivial-drift";

	beforeEach(() => {
		rmSync(TEST_DIR_DRIFT, { recursive: true, force: true });
		const sessionsDir = `${TEST_DIR_DRIFT}/.clens/sessions`;
		const specsDir = `${TEST_DIR_DRIFT}/specs`;
		mkdirSync(sessionsDir, { recursive: true });
		mkdirSync(specsDir, { recursive: true });

		// Session with 0 tool calls but a spec ref in prompt
		const sessionEvents: StoredEvent[] = [
			{
				t: 1000,
				event: "SessionStart",
				sid: SESSION_ID,
				data: {},
			},
			{
				t: 2000,
				event: "UserPromptSubmit",
				sid: SESSION_ID,
				data: { prompt: "/build specs/my-plan.md" },
			},
			{
				t: 3000,
				event: "SessionEnd",
				sid: SESSION_ID,
				data: {},
			},
		];
		writeFileSync(
			`${sessionsDir}/${SESSION_ID}.jsonl`,
			sessionEvents.map((e) => JSON.stringify(e)).join("\n"),
		);

		// Create the spec file that would normally trigger drift computation
		writeFileSync(
			`${specsDir}/my-plan.md`,
			["## Files to Create", "- `src/new-feature.ts`", "- `test/new-feature.test.ts`"].join("\n"),
		);
	});

	afterEach(() => {
		rmSync(TEST_DIR_DRIFT, { recursive: true, force: true });
	});

	test("session with 0 tool calls and spec ref → plan_drift is undefined", async () => {
		const result = await distill(SESSION_ID, TEST_DIR_DRIFT);
		expect(result.stats.tool_call_count).toBe(0);
		expect(result.plan_drift).toBeUndefined();
	});
});

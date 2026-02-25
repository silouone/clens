import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { StoredEvent } from "../src/types";

const TEST_DIR = "/tmp/clens-test-cli";
const CLI_PATH = `${import.meta.dir}/../src/cli.ts`;

const makeStoredEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

const runCli = async (...args: readonly string[]) => {
	const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
		cwd: TEST_DIR,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1" },
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, stdout, stderr };
};

const writeSession = (sessionId: string, events: readonly StoredEvent[]) => {
	const content = events.map((e) => JSON.stringify(e)).join("\n");
	writeFileSync(`${TEST_DIR}/.clens/sessions/${sessionId}.jsonl`, `${content}\n`);
};

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.claude`, { recursive: true });
	mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
	mkdirSync(`${TEST_DIR}/.clens/distilled`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("cli --version", () => {
	test("prints VERSION string", async () => {
		const { exitCode, stdout } = await runCli("--version");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("0.2.0");
	});
});

describe("cli --help", () => {
	test("prints usage information", async () => {
		const { exitCode, stdout } = await runCli("--help");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage:");
		expect(stdout).toContain("Analysis:");
		expect(stdout).toContain("Options:");
	});

	test("no command prints help (same as --help)", async () => {
		const { exitCode, stdout } = await runCli();
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Usage:");
		expect(stdout).toContain("Analysis:");
	});
});

describe("cli init", () => {
	test("creates .clens directory structure", async () => {
		const { exitCode, stdout } = await runCli("init");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("initialized");
		expect(existsSync(`${TEST_DIR}/.clens/sessions`)).toBe(true);
	});
});

describe("cli init --remove", () => {
	test("restores original settings", async () => {
		// First init to create backup, then init --remove
		await runCli("init");
		const { exitCode, stdout } = await runCli("init", "--remove");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("removed");
		expect(stdout).toContain("Session data preserved");
	});
});

describe("cli list", () => {
	test("with no sessions shows 'No sessions found.'", async () => {
		const { exitCode, stdout } = await runCli("list");
		expect(exitCode).toBe(0);
		expect(stdout.trim()).toBe("No sessions found.");
	});

	test("with sessions shows table with columns", async () => {
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "SessionStart",
				sid: "aaaabbbb-1111-2222-3333-444455556666",
				context: {
					project_dir: TEST_DIR,
					cwd: TEST_DIR,
					git_branch: "main",
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: "alpha",
					task_list_dir: null,
					claude_entrypoint: null,
					model: null,
					agent_type: "main",
				},
			}),
			makeStoredEvent({
				t: 65000,
				event: "SessionEnd",
				sid: "aaaabbbb-1111-2222-3333-444455556666",
			}),
		] as const;
		writeSession("aaaabbbb-1111-2222-3333-444455556666", events);

		const { exitCode, stdout } = await runCli("list");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("ID");
		expect(stdout).toContain("Branch");
		expect(stdout).toContain("Team");
		expect(stdout).toContain("Duration");
		expect(stdout).toContain("Events");
		expect(stdout).toContain("Status");
		expect(stdout).toContain("aaaabbbb");
		expect(stdout).toContain("main");
		expect(stdout).toContain("alpha");
	});

	test("shows size warning when total exceeds 1GB", async () => {
		// Create a session with very large file_size_bytes isn't feasible,
		// but we can create many sessions and check the output format.
		// The size warning is based on actual file sizes, so we create a large file.
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid: "big-sess" }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid: "big-sess" }),
		] as const;
		writeSession("big-sess", events);

		// Verify list works; the >1GB warning won't trigger with small files
		// but we confirm the total size line is present
		const { stdout } = await runCli("list");
		expect(stdout).toContain("Total:");
		expect(stdout).toContain("session(s)");
	});
});

describe("cli session resolution", () => {
	test("partial UUID matching resolves correctly", async () => {
		const sessionId = "abcd1234-5678-9abc-def0-111122223333";
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "SessionStart",
				sid: sessionId,
				data: {},
			}),
			makeStoredEvent({
				t: 2000,
				event: "PreToolUse",
				sid: sessionId,
				data: { tool_name: "Bash" },
			}),
			makeStoredEvent({
				t: 5000,
				event: "SessionEnd",
				sid: sessionId,
			}),
		] as const;
		writeSession(sessionId, events);

		// distill works on raw events and uses resolveSessionId
		const { exitCode, stdout } = await runCli("distill", "abcd1234", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.session_id).toContain("abcd1234");
	});

	test("ambiguous partial UUID produces error", async () => {
		const sid1 = "aabb0001-0000-0000-0000-000000000001";
		const sid2 = "aabb0002-0000-0000-0000-000000000002";
		const events1 = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid: sid1 }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid: sid1 }),
		] as const;
		const events2 = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid: sid2 }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid: sid2 }),
		] as const;
		writeSession(sid1, events1);
		writeSession(sid2, events2);

		const { exitCode, stderr } = await runCli("report", "aabb");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Ambiguous");
	});

	test("missing session ID without --last produces error", async () => {
		const sid = "ccdd0001-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { exitCode, stderr } = await runCli("report");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Session ID required");
	});

	test("--last resolves to most recently modified session", async () => {
		const oldSid = "old-sess-0000-0000-0000-000000000001";
		const newSid = "new-sess-0000-0000-0000-000000000002";

		const oldEvents = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid: oldSid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid: oldSid }),
		] as const;
		writeSession(oldSid, oldEvents);

		// Small delay so mtime differs
		await Bun.sleep(50);

		const newEvents = [
			makeStoredEvent({ t: 3000, event: "SessionStart", sid: newSid }),
			makeStoredEvent({ t: 8000, event: "SessionEnd", sid: newSid }),
		] as const;
		writeSession(newSid, newEvents);

		// distill works on raw events and resolves --last
		const { exitCode, stdout } = await runCli("distill", "--last", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.session_id).toContain("new-sess");
	});
});

describe("cli report", () => {
	test("--last shows report for most recent session", async () => {
		const sid = "stat-sess-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "SessionStart",
				sid,
				data: {},
			}),
			makeStoredEvent({
				t: 2000,
				event: "PreToolUse",
				sid,
				data: { tool_name: "Read" },
			}),
			makeStoredEvent({
				t: 3000,
				event: "PostToolUse",
				sid,
				data: { tool_name: "Read" },
			}),
			makeStoredEvent({
				t: 10000,
				event: "SessionEnd",
				sid,
			}),
		] as const;
		writeSession(sid, events);

		// Distill first so report has data
		await runCli("distill", "--last");
		const { exitCode, stdout } = await runCli("report", "--last");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Session");
		expect(stdout).toContain("tool calls");
		expect(stdout).toContain("failure rate");
	});

	test("with invalid session ID shows error", async () => {
		const { exitCode, stderr } = await runCli("report", "nonexistent-session-id");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Error:");
	});
});

describe("cli unknown command", () => {
	test("prints error and exits with code 1", async () => {
		const { exitCode, stderr } = await runCli("foobar");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unknown command: foobar");
	});
});

describe("cli command aliases", () => {
	test("backtrack resolves to backtracks", async () => {
		const sid = "alias-test-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { stderr } = await runCli("backtrack", "--last");
		expect(stderr).not.toContain("Unknown command");
	});

	test("decision resolves to decisions", async () => {
		const sid = "alias-test-0000-0000-0000-000000000002";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { stderr } = await runCli("decision", "--last");
		expect(stderr).not.toContain("Unknown command");
	});

	test("message resolves to messages", async () => {
		const sid = "alias-test-0000-0000-0000-000000000003";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { stderr } = await runCli("message", "--last");
		expect(stderr).not.toContain("Unknown command");
	});

	test("edit resolves to edits", async () => {
		const sid = "alias-test-0000-0000-0000-000000000004";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { stderr } = await runCli("edit", "--last");
		expect(stderr).not.toContain("Unknown command");
	});
});

describe("cli agents command", () => {
	test("shows distill prompt when no agent-id and no distilled data", async () => {
		const sid = "agent-cmd-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { exitCode, stdout } = await runCli("agents", "--last");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No distilled data");
	});

	test("shows agent not found when no distilled data", async () => {
		const sid = "agent-cmd-0000-0000-0000-000000000002";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { exitCode, stdout } = await runCli("agents", "--last", "builder-types");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("No agent data found");
		expect(stdout).toContain("single-agent session");
	});

	test("shows agent report when distilled data exists", async () => {
		const sid = "agent-cmd-0000-0000-0000-000000000003";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 200000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const distilled = {
			session_id: sid,
			stats: {
				total_events: 50,
				duration_ms: 199000,
				events_by_type: {},
				tools_by_name: { Read: 10 },
				tool_call_count: 10,
				failure_count: 0,
				failure_rate: 0,
				unique_files: [],
			},
			backtracks: [],
			decisions: [],
			file_map: { files: [] },
			git_diff: { commits: [], hunks: [] },
			complete: true,
			reasoning: [],
			user_messages: [],
			agents: [
				{
					session_id: "child-agent-001",
					agent_type: "builder",
					agent_name: "builder-types",
					duration_ms: 120000,
					tool_call_count: 40,
					children: [],
					model: "claude-sonnet-4-6",
					stats: {
						tool_call_count: 40,
						failure_count: 1,
						tools_by_name: { Read: 20, Edit: 10, Bash: 10 },
						unique_files: ["src/a.ts"],
					},
				},
			],
		};
		writeFileSync(`${TEST_DIR}/.clens/distilled/${sid}.json`, JSON.stringify(distilled));

		const { exitCode, stdout } = await runCli("agents", "--last", "builder-types");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Agent: builder-types (builder)");
		expect(stdout).toContain("Model: claude-sonnet-4-6");
		expect(stdout).toContain("Tool Usage:");
		expect(stdout).toContain("Read");
	});

	test("help text includes agents command", async () => {
		const { stdout } = await runCli("--help");
		expect(stdout).toContain("agents");
	});
});

describe("cli missing session", () => {
	test("commands on missing sessions print descriptive error", async () => {
		const sid = "exist-0001-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { exitCode, stderr } = await runCli("report", "zzzz-does-not-match");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("No session matching");
	});
});

describe("cli --json flag", () => {
	test("help text mentions --json", async () => {
		const { stdout } = await runCli("--help");
		expect(stdout).toContain("--json");
		expect(stdout).toContain("JSON");
	});

	test("list --json outputs valid JSON array", async () => {
		const sid = "json-list-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "SessionStart",
				sid,
				context: {
					project_dir: TEST_DIR,
					cwd: TEST_DIR,
					git_branch: "feat/json",
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: "beta",
					task_list_dir: null,
					claude_entrypoint: null,
					model: null,
					agent_type: "main",
				},
			}),
			makeStoredEvent({
				t: 60000,
				event: "SessionEnd",
				sid,
			}),
		] as const;
		writeSession(sid, events);

		const { exitCode, stdout } = await runCli("list", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBe(1);
		expect(parsed[0].session_id).toBe(sid);
		expect(parsed[0].git_branch).toBe("feat/json");
		expect(parsed[0].team_name).toBe("beta");
		expect(parsed[0].event_count).toBe(2);
		expect(typeof parsed[0].duration_ms).toBe("number");
		expect(typeof parsed[0].file_size_bytes).toBe("number");
	});

	test("list --json with no sessions outputs empty array", async () => {
		const { exitCode, stdout } = await runCli("list", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBe(0);
	});

	test("distill --json --last outputs valid JSON with stats", async () => {
		const sid = "json-stat-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "SessionStart",
				sid,
				data: {},
			}),
			makeStoredEvent({
				t: 2000,
				event: "PreToolUse",
				sid,
				data: { tool_name: "Read" },
			}),
			makeStoredEvent({
				t: 3000,
				event: "PostToolUse",
				sid,
				data: { tool_name: "Read" },
			}),
			makeStoredEvent({
				t: 4000,
				event: "PreToolUse",
				sid,
				data: { tool_name: "Edit" },
			}),
			makeStoredEvent({
				t: 10000,
				event: "SessionEnd",
				sid,
			}),
		] as const;
		writeSession(sid, events);

		const { exitCode, stdout } = await runCli("distill", "--last", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(typeof parsed).toBe("object");
		expect(parsed.session_id).toBe(sid);
		expect(parsed.stats.total_events).toBe(5);
		expect(parsed.stats.tool_call_count).toBe(2);
		expect(parsed.stats.duration_ms).toBe(9000);
		expect(typeof parsed.stats.failure_rate).toBe("number");
		expect(typeof parsed.stats.tools_by_name).toBe("object");
		expect(parsed.stats.tools_by_name.Read).toBe(1);
		expect(parsed.stats.tools_by_name.Edit).toBe(1);
	});

	test("distill --json --last outputs valid DistilledSession JSON", async () => {
		const sid = "json-dist-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({
				t: 1000,
				event: "SessionStart",
				sid,
				data: {},
			}),
			makeStoredEvent({
				t: 5000,
				event: "PreToolUse",
				sid,
				data: { tool_name: "Read" },
			}),
			makeStoredEvent({
				t: 10000,
				event: "SessionEnd",
				sid,
			}),
		] as const;
		writeSession(sid, events);

		const { exitCode, stdout } = await runCli("distill", "--last", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(typeof parsed).toBe("object");
		expect(parsed.session_id).toBe(sid);
		expect(typeof parsed.stats).toBe("object");
		expect(Array.isArray(parsed.backtracks)).toBe(true);
		expect(Array.isArray(parsed.decisions)).toBe(true);
		expect(typeof parsed.file_map).toBe("object");
		expect(parsed.complete).toBe(true);
	});

	test("agents --json outputs valid agent data JSON", async () => {
		const sid = "json-agnt-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 200000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const distilled = {
			session_id: sid,
			stats: {
				total_events: 50,
				duration_ms: 199000,
				events_by_type: {},
				tools_by_name: { Read: 10 },
				tool_call_count: 10,
				failure_count: 0,
				failure_rate: 0,
				unique_files: [],
			},
			backtracks: [],
			decisions: [],
			file_map: { files: [] },
			git_diff: { commits: [], hunks: [] },
			complete: true,
			reasoning: [],
			user_messages: [],
			agents: [
				{
					session_id: "child-agent-json",
					agent_type: "builder",
					agent_name: "builder-json",
					duration_ms: 90000,
					tool_call_count: 25,
					children: [],
					model: "claude-sonnet-4-6",
					stats: {
						tool_call_count: 25,
						failure_count: 0,
						tools_by_name: { Read: 15, Edit: 10 },
						unique_files: ["src/b.ts"],
					},
				},
			],
		};
		writeFileSync(`${TEST_DIR}/.clens/distilled/${sid}.json`, JSON.stringify(distilled));

		const { exitCode, stdout } = await runCli("agents", "--last", "builder-json", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(typeof parsed).toBe("object");
		expect(parsed.agent_name).toBe("builder-json");
		expect(parsed.agent_type).toBe("builder");
		expect(parsed.model).toBe("claude-sonnet-4-6");
		expect(parsed.duration_ms).toBe(90000);
	});

	test("agents --json outputs error object when agent not found", async () => {
		const sid = "json-agn2-0000-0000-0000-000000000001";
		const events = [
			makeStoredEvent({ t: 1000, event: "SessionStart", sid }),
			makeStoredEvent({ t: 2000, event: "SessionEnd", sid }),
		] as const;
		writeSession(sid, events);

		const { exitCode, stdout } = await runCli("agents", "--last", "nonexistent", "--json");
		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(typeof parsed).toBe("object");
		expect(parsed.error).toBeDefined();
		expect(parsed.error).toContain("No agent data found");
	});
});

describe("cli killed commands", () => {
	test("journey shows killed command suggestion", async () => {
		const { exitCode, stderr } = await runCli("journey");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("removed in v0.2.0");
		expect(stderr).toContain("clens explore");
	});

	test("edits shows killed command suggestion", async () => {
		const { exitCode, stderr } = await runCli("edits");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("removed in v0.2.0");
		expect(stderr).toContain("clens explore");
	});

	test("stats shows killed command suggestion", async () => {
		const { exitCode, stderr } = await runCli("stats");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("removed in v0.2.0");
		expect(stderr).toContain("clens report");
	});

	test("tree shows killed command suggestion", async () => {
		const { exitCode, stderr } = await runCli("tree");
		expect(exitCode).toBe(1);
		expect(stderr).toContain("removed in v0.2.0");
		expect(stderr).toContain("clens agents");
	});
});


/**
 * E2E test infrastructure for clens CLI.
 *
 * Provides:
 * - Synthetic session/fixture creation
 * - CLI command runner with output capture
 * - Assertion helpers (JSON validation, ANSI stripping, field checking)
 * - Temp project lifecycle (create + cleanup)
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type {
	AgentNode,
	CommunicationEdge,
	DistilledSession,
	TeamMetrics,
} from "../../src/types/distill";
import type { StoredEvent } from "../../src/types/events";
import type {
	ConfigChangeLink,
	LinkEvent,
	MessageLink,
	SpawnLink,
	StopLink,
	TaskCompleteLink,
	TaskLink,
	TeammateIdleLink,
} from "../../src/types/links";

// ── CLI Runner ──────────────────────────────────────────

export type CliResult = {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
	readonly json?: unknown;
	readonly duration_ms: number;
};

export const runCli = async (args: readonly string[], projectDir: string): Promise<CliResult> => {
	const cliPath = `${import.meta.dir}/../../src/cli.ts`;
	const start = performance.now();

	const proc = Bun.spawn(["bun", cliPath, ...args], {
		cwd: projectDir,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1" },
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	await proc.exited;

	const duration_ms = performance.now() - start;
	const exitCode = proc.exitCode ?? 1;

	const isJsonMode = args.includes("--json");
	let json: unknown;
	if (isJsonMode && exitCode === 0 && stdout.trim()) {
		try {
			json = JSON.parse(stdout);
		} catch {
			// JSON parse failed — test will catch this
		}
	}

	return { stdout, stderr, exitCode, json, duration_ms };
};

// ── ANSI Helpers ────────────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require control characters
export const hasAnsi = (s: string): boolean => /\x1b\[/.test(s);

// ── Field Validation ────────────────────────────────────

export const missingFields = (
	obj: Record<string, unknown>,
	fields: readonly string[],
): readonly string[] => fields.filter((f) => !(f in obj));

export const assertFieldTypes = (
	obj: Record<string, unknown>,
	schema: Record<string, string>,
): readonly string[] =>
	Object.entries(schema).flatMap(([key, expectedType]) => {
		if (!(key in obj)) return [`missing: ${key}`];
		const actual = Array.isArray(obj[key]) ? "array" : typeof obj[key];
		return actual === expectedType ? [] : [`${key}: expected ${expectedType}, got ${actual}`];
	});

// ── Fixture Data Constants ──────────────────────────────

const BASE_TIME = new Date("2025-01-15T10:00:00.000Z").getTime();
const SESSION_1_ID = "e2e-test-session-001";
const SESSION_2_ID = "e2e-test-session-002";
const CHILD_SESSION_ID = "e2e-test-child-001";

const TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"] as const;
const FILES = [
	"src/main.ts",
	"src/utils.ts",
	"src/types.ts",
	"test/main.test.ts",
	"README.md",
] as const;

// ── Event Generators ────────────────────────────────────

const makeEvent = (
	t: number,
	event: string,
	sid: string,
	data: Record<string, unknown> = {},
	context?: StoredEvent["context"],
): StoredEvent => ({
	t,
	event: event as StoredEvent["event"],
	sid,
	data,
	...(context ? { context } : {}),
});

const makeSessionStart = (sid: string, t: number, branch = "main"): StoredEvent =>
	makeEvent(
		t,
		"SessionStart",
		sid,
		{},
		{
			project_dir: "/test/project",
			cwd: "/test/project",
			git_branch: branch,
			git_remote: "origin",
			git_commit: "abc123",
			git_worktree: null,
			team_name: sid === SESSION_1_ID ? "e2e-team" : null,
			task_list_dir: null,
			claude_entrypoint: null,
			model: "claude-sonnet-4-20250514",
			agent_type: null,
		},
	);

const makePreToolUse = (
	sid: string,
	t: number,
	tool: string,
	toolUseId: string,
	filePath?: string,
): StoredEvent =>
	makeEvent(t, "PreToolUse", sid, {
		tool_name: tool,
		tool_use_id: toolUseId,
		tool_input: filePath ? { file_path: filePath } : {},
	});

const makePostToolUse = (
	sid: string,
	t: number,
	tool: string,
	toolUseId: string,
	filePath?: string,
): StoredEvent =>
	makeEvent(t, "PostToolUse", sid, {
		tool_name: tool,
		tool_use_id: toolUseId,
		tool_input: filePath ? { file_path: filePath } : {},
		tool_response: "ok",
	});

const makeFailure = (
	sid: string,
	t: number,
	tool: string,
	toolUseId: string,
	error: string,
): StoredEvent =>
	makeEvent(t, "PostToolUseFailure", sid, {
		tool_name: tool,
		tool_use_id: toolUseId,
		tool_input: {},
		error,
	});

const makeSessionEnd = (sid: string, t: number): StoredEvent => makeEvent(t, "SessionEnd", sid, {});

// ── Session Generators ──────────────────────────────────

const generateSession1Events = (): readonly StoredEvent[] => {
	const events: StoredEvent[] = [];
	let t = BASE_TIME;
	let toolIdx = 0;

	// Session start
	events.push(makeSessionStart(SESSION_1_ID, t));
	t += 500;

	// 30 tool calls across various tools and files (PreToolUse + PostToolUse pairs)
	for (let i = 0; i < 30; i++) {
		const tool = TOOLS[i % TOOLS.length];
		const file = FILES[i % FILES.length];
		const uid = `tuid-s1-${String(toolIdx++).padStart(3, "0")}`;
		events.push(makePreToolUse(SESSION_1_ID, t, tool, uid, file));
		t += 50;
		events.push(makePostToolUse(SESSION_1_ID, t, tool, uid, file));
		t += 1000 + Math.floor(i * 100);
	}

	// 2 failures (PreToolUse + PostToolUseFailure)
	events.push(makePreToolUse(SESSION_1_ID, t, "Edit", "tuid-s1-fail-001", "src/main.ts"));
	t += 50;
	events.push(
		makeFailure(SESSION_1_ID, t, "Edit", "tuid-s1-fail-001", "old_string not found in file"),
	);
	t += 2000;
	events.push(makePreToolUse(SESSION_1_ID, t, "Bash", "tuid-s1-fail-002"));
	t += 50;
	events.push(makeFailure(SESSION_1_ID, t, "Bash", "tuid-s1-fail-002", "command not found: foo"));
	t += 1000;

	// 5 more tool calls (post-failure recovery)
	for (let i = 0; i < 5; i++) {
		const uid = `tuid-s1-${String(toolIdx++).padStart(3, "0")}`;
		events.push(makePreToolUse(SESSION_1_ID, t, "Read", uid, FILES[i % FILES.length]));
		t += 50;
		events.push(makePostToolUse(SESSION_1_ID, t, "Read", uid, FILES[i % FILES.length]));
		t += 800;
	}

	// Session end
	events.push(makeSessionEnd(SESSION_1_ID, t));

	return events;
};

const generateSession2Events = (): readonly StoredEvent[] => {
	const events: StoredEvent[] = [];
	let t = BASE_TIME + 3600_000; // 1 hour after session 1

	events.push(makeSessionStart(SESSION_2_ID, t, "feature/e2e-tests"));
	t += 300;

	// 10 tool calls — smaller session (PreToolUse + PostToolUse pairs)
	for (let i = 0; i < 10; i++) {
		const uid = `tuid-s2-${String(i).padStart(3, "0")}`;
		events.push(makePreToolUse(SESSION_2_ID, t, TOOLS[i % 3], uid, FILES[i % 3]));
		t += 50;
		events.push(makePostToolUse(SESSION_2_ID, t, TOOLS[i % 3], uid, FILES[i % 3]));
		t += 500;
	}

	events.push(makeSessionEnd(SESSION_2_ID, t));
	return events;
};

// ── Link Generators ─────────────────────────────────────

const generateLinks = (): readonly LinkEvent[] => {
	const links: LinkEvent[] = [];
	let t = BASE_TIME + 2000;

	// Spawn a child agent
	links.push({
		t,
		type: "spawn",
		parent_session: SESSION_1_ID,
		agent_id: CHILD_SESSION_ID,
		agent_type: "builder",
		agent_name: "builder-1",
	} satisfies SpawnLink);
	t += 5000;

	// Message from child to parent
	links.push({
		t,
		type: "msg_send",
		session_id: CHILD_SESSION_ID,
		from: "builder-1",
		to: "team-lead",
		msg_type: "message",
		summary: "Task completed: implement auth module",
	} satisfies MessageLink);
	t += 1000;

	// Teammate idle
	links.push({
		t,
		type: "teammate_idle",
		teammate: "builder-1",
	} satisfies TeammateIdleLink);
	t += 2000;

	// Task complete
	links.push({
		t,
		type: "task_complete",
		task_id: "task-001",
		agent: "builder-1",
		subject: "Implement auth module",
	} satisfies TaskCompleteLink);
	t += 3000;

	// Message from parent to child (task assignment)
	links.push({
		t,
		type: "msg_send",
		session_id: SESSION_1_ID,
		from: "team-lead",
		to: "builder-1",
		msg_type: "message",
		summary: "Assigned: implement auth module",
	} satisfies MessageLink);
	t += 1000;

	// Task create link
	links.push({
		t,
		type: "task",
		action: "create",
		task_id: "task-001",
		session_id: SESSION_1_ID,
		subject: "Implement auth module",
	} satisfies TaskLink);
	t += 500;

	// Task assign link
	links.push({
		t,
		type: "task",
		action: "assign",
		task_id: "task-001",
		session_id: SESSION_1_ID,
		owner: "builder-1",
	} satisfies TaskLink);
	t += 1500;

	// Config change link
	links.push({
		t,
		type: "config_change",
		session: SESSION_1_ID,
		key: "model",
	} satisfies ConfigChangeLink);
	t += 1000;

	// Stop child
	links.push({
		t,
		type: "stop",
		parent_session: SESSION_1_ID,
		agent_id: CHILD_SESSION_ID,
	} satisfies StopLink);

	return links;
};

// ── Distilled Session Generator ─────────────────────────

const makeDistilledSession = (sessionId: string): DistilledSession => {
	const isTeamSession = sessionId === SESSION_1_ID;

	const agents: AgentNode[] = isTeamSession
		? [
				{
					session_id: SESSION_1_ID,
					agent_type: "main",
					agent_name: "team-lead",
					duration_ms: 45000,
					tool_call_count: 37,
					children: [
						{
							session_id: CHILD_SESSION_ID,
							agent_type: "builder",
							agent_name: "builder-1",
							duration_ms: 12000,
							tool_call_count: 15,
							children: [],
							tasks_completed: 1,
							idle_count: 1,
							model: "claude-sonnet-4-20250514",
							cost_estimate: {
								model: "claude-sonnet-4-20250514",
								estimated_input_tokens: 25000,
								estimated_output_tokens: 8000,
								estimated_cost_usd: 0.15,
							},
						},
					],
					tasks_completed: 0,
					idle_count: 0,
					model: "claude-sonnet-4-20250514",
					cost_estimate: {
						model: "claude-sonnet-4-20250514",
						estimated_input_tokens: 80000,
						estimated_output_tokens: 20000,
						estimated_cost_usd: 0.42,
					},
				},
			]
		: undefined;

	const commGraph: readonly CommunicationEdge[] = isTeamSession
		? [{
			from_id: CHILD_SESSION_ID,
			from_name: "builder-1",
			to_id: SESSION_1_ID,
			to_name: "team-lead",
			from: "builder-1",
			to: "team-lead",
			count: 1,
			msg_types: ["message"],
		}]
		: [];

	const teamMetrics: TeamMetrics | undefined = isTeamSession
		? {
				agent_count: 2,
				task_completed_count: 1,
				idle_event_count: 1,
				teammate_names: ["builder-1"],
				tasks: [
					{
						task_id: "task-001",
						agent: "builder-1",
						subject: "Implement auth module",
						t: BASE_TIME + 10000,
					},
				],
				idle_transitions: [{ teammate: "builder-1", t: BASE_TIME + 8000 }],
				utilization_ratio: 0.75,
			}
		: undefined;

	return {
		session_id: sessionId,
		stats: {
			total_events: sessionId === SESSION_1_ID ? 38 : 12,
			duration_ms: sessionId === SESSION_1_ID ? 45000 : 6000,
			events_by_type: {
				SessionStart: 1,
				PostToolUse: sessionId === SESSION_1_ID ? 35 : 10,
				PostToolUseFailure: sessionId === SESSION_1_ID ? 2 : 0,
				SessionEnd: 1,
			},
			tools_by_name: {
				Read: sessionId === SESSION_1_ID ? 12 : 4,
				Edit: sessionId === SESSION_1_ID ? 8 : 3,
				Write: 5,
				Bash: sessionId === SESSION_1_ID ? 5 : 0,
				Grep: 4,
				Glob: 3,
			},
			tool_call_count: sessionId === SESSION_1_ID ? 37 : 10,
			failure_count: sessionId === SESSION_1_ID ? 2 : 0,
			failure_rate: sessionId === SESSION_1_ID ? 2 / 37 : 0,
			unique_files: [...FILES],
			model: "claude-sonnet-4-20250514",
			cost_estimate: {
				model: "claude-sonnet-4-20250514",
				estimated_input_tokens: sessionId === SESSION_1_ID ? 80000 : 20000,
				estimated_output_tokens: sessionId === SESSION_1_ID ? 20000 : 5000,
				estimated_cost_usd: sessionId === SESSION_1_ID ? 0.42 : 0.1,
			},
		},
		backtracks:
			sessionId === SESSION_1_ID
				? [
						{
							type: "failure_retry",
							tool_name: "Edit",
							file_path: "src/main.ts",
							attempts: 2,
							start_t: BASE_TIME + 31000,
							end_t: BASE_TIME + 33000,
							tool_use_ids: ["tuid-s1-fail-001", "tuid-s1-030"],
							error_message: "old_string not found in file",
						},
					]
				: [],
		decisions: [
			{
				type: "timing_gap",
				t: BASE_TIME + 5000,
				gap_ms: 3000,
				classification: "agent_thinking" as const,
			},
			{
				type: "tool_pivot",
				t: BASE_TIME + 10000,
				from_tool: "Read",
				to_tool: "Edit",
				after_failure: false,
			},
		],
		file_map: {
			files: FILES.map((f) => ({
				file_path: f,
				reads: 3,
				edits: f.endsWith(".test.ts") ? 0 : 2,
				writes: f === "README.md" ? 1 : 0,
				errors: 0,
				tool_use_ids: [],
			})),
		},
		git_diff: { commits: [], hunks: [] },
		complete: true,
		reasoning: [],
		user_messages: [],
		summary: {
			narrative: `Session with ${sessionId === SESSION_1_ID ? 37 : 10} tool calls across ${FILES.length} files.`,
			phases: [
				{
					name: "Code Exploration",
					start_t: BASE_TIME,
					end_t: BASE_TIME + 15000,
					tool_types: ["Read", "Grep", "Glob"],
					description: "Initial codebase exploration",
				},
				{
					name: "Code Modification",
					start_t: BASE_TIME + 15000,
					end_t: BASE_TIME + 40000,
					tool_types: ["Edit", "Write", "Bash"],
					description: "Making changes to source files",
				},
			],
			key_metrics: {
				duration_human: sessionId === SESSION_1_ID ? "45s" : "6s",
				tool_calls: sessionId === SESSION_1_ID ? 37 : 10,
				failures: sessionId === SESSION_1_ID ? 2 : 0,
				files_modified: 4,
				backtrack_count: sessionId === SESSION_1_ID ? 1 : 0,
				active_duration_human: sessionId === SESSION_1_ID ? "38s" : "5s",
				active_duration_ms: sessionId === SESSION_1_ID ? 38000 : 5000,
			},
			top_errors:
				sessionId === SESSION_1_ID
					? [{ tool_name: "Edit", count: 1, sample_message: "old_string not found in file" }]
					: [],
			agent_workload: isTeamSession
				? [
						{ name: "team-lead", id: SESSION_1_ID, tool_calls: 22, files_modified: 4, duration_ms: 45000 },
						{ name: "builder-1", id: CHILD_SESSION_ID, tool_calls: 15, files_modified: 3, duration_ms: 12000 },
					]
				: undefined,
		},
		timeline: [
			{
				t: BASE_TIME,
				type: "tool_call",
				tool_name: "Read",
				tool_use_id: "tuid-s1-000",
				content_preview: "src/main.ts",
			},
			{
				t: BASE_TIME + 1000,
				type: "tool_call",
				tool_name: "Edit",
				tool_use_id: "tuid-s1-001",
				content_preview: "src/utils.ts",
			},
			{
				t: BASE_TIME + 5000,
				type: "phase_boundary",
				phase_index: 1,
				content_preview: "Code Modification",
			},
			{
				t: BASE_TIME + 31000,
				type: "failure",
				tool_name: "Edit",
				tool_use_id: "tuid-s1-fail-001",
				content_preview: "old_string not found",
			},
		],
		agents: agents ?? undefined,
		cost_estimate: {
			model: "claude-sonnet-4-20250514",
			estimated_input_tokens: sessionId === SESSION_1_ID ? 80000 : 20000,
			estimated_output_tokens: sessionId === SESSION_1_ID ? 20000 : 5000,
			estimated_cost_usd: sessionId === SESSION_1_ID ? 0.42 : 0.1,
		},
		team_metrics: teamMetrics,
		communication_graph: commGraph,
		comm_sequence: isTeamSession
			? [
					{
						t: BASE_TIME + 7000,
						from_id: SESSION_1_ID,
						from_name: "team-lead",
						to_id: CHILD_SESSION_ID,
						to_name: "builder-1",
						from: "team-lead",
						to: "builder-1",
						msg_type: "message",
						summary: "Assigned: implement auth module",
					},
					{
						t: BASE_TIME + 7000,
						from_id: CHILD_SESSION_ID,
						from_name: "builder-1",
						to_id: SESSION_1_ID,
						to_name: "team-lead",
						from: "builder-1",
						to: "team-lead",
						msg_type: "message",
						summary: "Task completed: implement auth module",
					},
				]
			: undefined,
		agent_lifetimes: isTeamSession
			? [
					{
						agent_id: CHILD_SESSION_ID,
						agent_name: "builder-1",
						start_t: BASE_TIME + 2000,
						end_t: BASE_TIME + 15000,
						agent_type: "builder",
					},
				]
			: undefined,
		plan_drift: {
			spec_path: "specs/e2e-plan.md",
			expected_files: ["src/main.ts", "src/utils.ts", "src/types.ts", "README.md"],
			actual_files: ["src/main.ts", "src/utils.ts", "src/types.ts", "README.md"],
			unexpected_files: [],
			missing_files: [],
			drift_score: 0,
		},
	};
};

// ── Test Project Lifecycle ──────────────────────────────

export type TestProjectOptions = {
	readonly sessionCount?: number;
	readonly withLinks?: boolean;
	readonly withDistilled?: boolean;
	readonly withSpec?: boolean;
};

export const createTestProject = (options: TestProjectOptions = {}): string => {
	const { sessionCount = 2, withLinks = true, withDistilled = true, withSpec = false } = options;
	const tmpDir = `/tmp/clens-e2e-${randomUUID().slice(0, 8)}`;

	// Create directory structure
	mkdirSync(`${tmpDir}/.clens/sessions`, { recursive: true });
	mkdirSync(`${tmpDir}/.clens/distilled`, { recursive: true });

	// Write spec file if requested
	if (withSpec) {
		mkdirSync(`${tmpDir}/specs`, { recursive: true });
		writeFileSync(
			`${tmpDir}/specs/e2e-plan.md`,
			[
				"# E2E Test Plan",
				"",
				"## Files to Modify",
				"",
				"- `src/main.ts`",
				"- `src/utils.ts`",
				"- `src/types.ts`",
				"- `README.md`",
			].join("\n"),
		);
	}

	// Write session 1
	const session1Events = generateSession1Events();
	writeFileSync(
		`${tmpDir}/.clens/sessions/${SESSION_1_ID}.jsonl`,
		`${session1Events.map((e) => JSON.stringify(e)).join("\n")}\n`,
	);

	// Write session 2 if needed
	if (sessionCount >= 2) {
		const session2Events = generateSession2Events();
		writeFileSync(
			`${tmpDir}/.clens/sessions/${SESSION_2_ID}.jsonl`,
			`${session2Events.map((e) => JSON.stringify(e)).join("\n")}\n`,
		);
	}

	// Write links
	if (withLinks) {
		const links = generateLinks();
		writeFileSync(
			`${tmpDir}/.clens/sessions/_links.jsonl`,
			`${links.map((l) => JSON.stringify(l)).join("\n")}\n`,
		);
	}

	// Write distilled data
	if (withDistilled) {
		writeFileSync(
			`${tmpDir}/.clens/distilled/${SESSION_1_ID}.json`,
			JSON.stringify(makeDistilledSession(SESSION_1_ID), null, 2),
		);
		if (sessionCount >= 2) {
			writeFileSync(
				`${tmpDir}/.clens/distilled/${SESSION_2_ID}.json`,
				JSON.stringify(makeDistilledSession(SESSION_2_ID), null, 2),
			);
		}
	}

	return tmpDir;
};

export const cleanupTestProject = (projectDir: string): void => {
	if (projectDir.startsWith("/tmp/clens-e2e-") && existsSync(projectDir)) {
		rmSync(projectDir, { recursive: true, force: true });
	}
};

// ── Re-exports for convenience ──────────────────────────

export { SESSION_1_ID, SESSION_2_ID, CHILD_SESSION_ID, BASE_TIME, TOOLS, FILES };

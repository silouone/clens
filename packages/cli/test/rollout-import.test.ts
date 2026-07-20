import { describe, expect, test } from "bun:test";
import { rolloutToStoredEvents } from "../src/session/rollout";
import type { StoredEvent } from "../src/types";

// A tiny hand-built rollout (real 60 MB files are never committed). Exercises
// every mapped record kind: session_meta, turn_context (model slug), user_message,
// function_call/_output (exec_command), apply_patch (custom_tool_call +
// patch_apply_end + its dropped output twin), token_count (cumulative), and
// task_complete.
const FIXTURE: readonly unknown[] = [
	{
		timestamp: "2026-07-20T10:00:00.000Z",
		type: "session_meta",
		payload: {
			session_id: "019f-codex-sid",
			cwd: "/home/dev/proj",
			cli_version: "0.144.4",
			model_provider: "openai",
			git: { commit_hash: "abc123", branch: "main", repository_url: "git@x:proj.git" },
		},
	},
	{
		timestamp: "2026-07-20T10:00:01.000Z",
		type: "turn_context",
		payload: { turn_id: "t1", model: "gpt-5.6-sol", cwd: "/home/dev/proj" },
	},
	{
		timestamp: "2026-07-20T10:00:02.000Z",
		type: "event_msg",
		payload: { type: "task_started", turn_id: "t1" },
	},
	{
		timestamp: "2026-07-20T10:00:03.000Z",
		type: "event_msg",
		payload: { type: "user_message", message: "fix the bug", images: [] },
	},
	{
		timestamp: "2026-07-20T10:00:04.000Z",
		type: "response_item",
		payload: {
			type: "function_call",
			name: "exec_command",
			id: "fc_deadbeef",
			call_id: "call_exec1",
			arguments: '{"cmd":"pwd","workdir":"/home/dev/proj"}',
		},
	},
	{
		timestamp: "2026-07-20T10:00:05.000Z",
		type: "response_item",
		payload: {
			type: "function_call_output",
			call_id: "call_exec1",
			output: "/home/dev/proj\n",
		},
	},
	{
		timestamp: "2026-07-20T10:00:06.000Z",
		type: "response_item",
		payload: {
			type: "custom_tool_call",
			name: "apply_patch",
			id: "ctc_1",
			call_id: "call_patch1",
			input: "*** Begin Patch\n*** Update File: app.ts\n@@\n-old\n+new\n*** End Patch",
		},
	},
	{
		timestamp: "2026-07-20T10:00:07.000Z",
		type: "event_msg",
		payload: {
			type: "patch_apply_end",
			call_id: "call_patch1",
			success: true,
			changes: [
				{ path: "/home/dev/proj/app.ts", type: "update", unified_diff: "@@ -1 +1 @@\n-old\n+new" },
			],
		},
	},
	{
		// The apply_patch custom_tool_call_output twin — must be dropped so the
		// PostToolUse for call_patch1 is not duplicated.
		timestamp: "2026-07-20T10:00:08.000Z",
		type: "response_item",
		payload: { type: "custom_tool_call_output", call_id: "call_patch1", output: "Success" },
	},
	{
		timestamp: "2026-07-20T10:00:09.000Z",
		type: "event_msg",
		payload: {
			type: "token_count",
			info: {
				total_token_usage: {
					input_tokens: 100,
					cached_input_tokens: 40,
					output_tokens: 10,
					reasoning_output_tokens: 5,
					total_tokens: 110,
				},
				last_token_usage: { input_tokens: 100, total_tokens: 110 },
				model_context_window: 258400,
			},
		},
	},
	{
		// A LATER cumulative token_count — this is the one that should win.
		timestamp: "2026-07-20T10:00:10.000Z",
		type: "event_msg",
		payload: {
			type: "token_count",
			info: {
				total_token_usage: {
					input_tokens: 250,
					cached_input_tokens: 90,
					output_tokens: 30,
					reasoning_output_tokens: 12,
					total_tokens: 280,
				},
				last_token_usage: { input_tokens: 150, total_tokens: 170 },
				model_context_window: 258400,
			},
		},
	},
	{
		timestamp: "2026-07-20T10:00:11.000Z",
		type: "event_msg",
		payload: {
			type: "task_complete",
			turn_id: "t1",
			duration_ms: 11000,
			last_agent_message: "done",
		},
	},
];

const map = (): StoredEvent[] => rolloutToStoredEvents(FIXTURE);
const usageEvents = (events: readonly StoredEvent[]) =>
	events.filter((e) => e.data.usage !== undefined);

describe("rolloutToStoredEvents", () => {
	test("emits SessionStart with model slug from turn_context and git context", () => {
		const events = map();
		const start = events[0];
		expect(start.event).toBe("SessionStart");
		expect(start.sid).toBe("019f-codex-sid");
		expect(start.context?.model).toBe("gpt-5.6-sol");
		expect(start.context?.git_branch).toBe("main");
		expect(start.context?.git_commit).toBe("abc123");
		expect(start.context?.git_remote).toBe("git@x:proj.git");
	});

	test("all events carry the session_meta sid", () => {
		const events = map();
		expect(events.every((e) => e.sid === "019f-codex-sid")).toBe(true);
	});

	test("user_message → UserPromptSubmit with data.prompt", () => {
		const prompt = map().find((e) => e.event === "UserPromptSubmit");
		expect(prompt?.data.prompt).toBe("fix the bug");
	});

	test("exec_command function_call → PreToolUse Bash, tool_use_id = call_id (not fc_ id)", () => {
		const pre = map().find((e) => e.event === "PreToolUse" && e.data.tool_name === "Bash");
		expect(pre).toBeDefined();
		const data = pre?.data ?? {};
		expect(data.tool_use_id).toBe("call_exec1");
		expect((data.tool_input as Record<string, unknown>).cmd).toBe("pwd");
	});

	test("function_call_output → PostToolUse Bash paired by call_id", () => {
		const post = map().find(
			(e) => e.event === "PostToolUse" && e.data.tool_use_id === "call_exec1",
		);
		const data = post?.data ?? {};
		expect(data.tool_name).toBe("Bash");
		expect((data.tool_response as Record<string, unknown>).output).toBe("/home/dev/proj\n");
	});

	test("apply_patch → PreToolUse Edit with file_path from patch_apply_end", () => {
		const pre = map().find((e) => e.event === "PreToolUse" && e.data.tool_use_id === "call_patch1");
		const data = pre?.data ?? {};
		expect(data.tool_name).toBe("Edit");
		expect((data.tool_input as Record<string, unknown>).file_path).toBe("/home/dev/proj/app.ts");
	});

	test("patch_apply_end is the sole PostToolUse for the patch (output twin dropped)", () => {
		const posts = map().filter(
			(e) => e.event === "PostToolUse" && e.data.tool_use_id === "call_patch1",
		);
		expect(posts.length).toBe(1);
		expect(posts[0].data.tool_name).toBe("Edit");
		const resp = posts[0].data.tool_response as Record<string, unknown>;
		expect(resp.success).toBe(true);
		expect(Array.isArray(resp.changes)).toBe(true);
	});

	test("cumulative usage lands on exactly ONE terminal SessionEnd event", () => {
		const events = map();
		const withUsage = usageEvents(events);
		expect(withUsage.length).toBe(1);
		const last = events[events.length - 1];
		expect(last.event).toBe("SessionEnd");
		// Codex `input_tokens` (250) is INCLUSIVE of `cached_input_tokens` (90); cLens
		// follows Claude semantics where input EXCLUDES cache and the two are summed
		// independently for cost, so the cached slice is subtracted out: 250 − 90 = 160.
		expect(last.data.usage).toEqual({
			input_tokens: 160,
			output_tokens: 30,
			cache_read_tokens: 90,
			cache_creation_tokens: 0,
		});
	});

	test("task_complete → Stop with last_agent_message + duration", () => {
		const stop = map().find((e) => e.event === "Stop");
		expect(stop?.data.last_agent_message).toBe("done");
		expect(stop?.data.duration_ms).toBe(11000);
	});

	test("events are chronologically ordered by timestamp", () => {
		const ts = map().map((e) => e.t);
		expect(ts).toEqual([...ts].sort((a, b) => a - b));
	});
});

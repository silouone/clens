import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { renderMessages } from "../src/commands/messages";

const TEST_DIR = "/tmp/clens-test-messages";

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("renderMessages", () => {
	test("returns 'No inter-agent data found' when _links.jsonl missing", () => {
		const result = renderMessages("any-session", TEST_DIR);
		expect(result).toContain("No inter-agent data found");
	});

	test("returns contextual info when spawn links exist but no msg_send events", () => {
		// Write _links.jsonl with only spawn events (no messages)
		const spawnLink = JSON.stringify({
			t: 1000,
			type: "spawn",
			parent_session: "parent-id",
			agent_id: "child-id",
			agent_type: "builder",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawnLink}\n`);

		const result = renderMessages("parent-id", TEST_DIR);
		expect(result).toContain("subagent coordination");
		expect(result).toContain("No direct messages");
	});

	test("formats messages with timestamp, from, to, summary", () => {
		const msg = JSON.stringify({
			t: 1706000000000,
			type: "msg_send",
			session_id: "sess-1",
			from: "team-lead-abc",
			to: "builder-xyz",
			msg_type: "task",
			summary: "Build the login page",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${msg}\n`);

		const result = renderMessages("sess-1", TEST_DIR);
		// Should contain from and to (truncated to 12 chars)
		expect(result).toContain("team-lead-ab");
		expect(result).toContain("builder-xyz");
		// Summary in quotes
		expect(result).toContain('"Build the login page"');
		// Arrow separator
		expect(result).toContain("→");
	});

	test("sorts messages chronologically", () => {
		const msg1 = JSON.stringify({
			t: 1706000003000,
			type: "msg_send",
			session_id: "sess-1",
			from: "agent-a",
			to: "agent-b",
			msg_type: "text",
			summary: "third",
		});
		const msg2 = JSON.stringify({
			t: 1706000001000,
			type: "msg_send",
			session_id: "sess-1",
			from: "agent-b",
			to: "agent-a",
			msg_type: "text",
			summary: "first",
		});
		const msg3 = JSON.stringify({
			t: 1706000002000,
			type: "msg_send",
			session_id: "sess-1",
			from: "agent-a",
			to: "agent-c",
			msg_type: "text",
			summary: "second",
		});
		const content = [msg1, msg2, msg3].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${content}\n`);

		const result = renderMessages("sess-1", TEST_DIR);
		const lines = result.split("\n");
		// First line should contain "first", second "second", third "third"
		expect(lines[0]).toContain("first");
		expect(lines[1]).toContain("second");
		expect(lines[2]).toContain("third");
	});

	test("handles messages without summary field", () => {
		const msg = JSON.stringify({
			t: 1706000000000,
			type: "msg_send",
			session_id: "sess-1",
			from: "agent-a",
			to: "agent-b",
			msg_type: "delegation",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${msg}\n`);

		const result = renderMessages("sess-1", TEST_DIR);
		// Without summary, should fall back to showing [msg_type]
		expect(result).toContain("[delegation]");
		expect(result).not.toContain('""');
	});

	test("includes teammate_idle events formatted as [idle]", () => {
		const spawn = JSON.stringify({
			t: 1706000000000,
			type: "spawn",
			parent_session: "sess-1",
			agent_id: "agent-alpha-id",
			agent_type: "builder",
			agent_name: "builder-alpha",
		});
		const idle = JSON.stringify({
			t: 1706000001000,
			type: "teammate_idle",
			teammate: "builder-alpha",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawn}\n${idle}\n`);

		const result = renderMessages("sess-1", TEST_DIR);
		expect(result).toContain("builder-alpha");
		expect(result).toContain("[idle]");
	});

	test("includes task_complete events with subject", () => {
		const spawn = JSON.stringify({
			t: 1706000001000,
			type: "spawn",
			parent_session: "sess-1",
			agent_id: "agent-beta-id",
			agent_type: "builder",
			agent_name: "builder-beta",
		});
		const tc = JSON.stringify({
			t: 1706000002000,
			type: "task_complete",
			task_id: "task-42",
			agent: "builder-beta",
			subject: "Fix auth bug",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawn}\n${tc}\n`);

		const result = renderMessages("sess-1", TEST_DIR);
		expect(result).toContain("builder-beta");
		expect(result).toContain("completed: Fix auth bug");
	});

	test("falls back to task_id when subject is missing", () => {
		const spawn = JSON.stringify({
			t: 1706000001000,
			type: "spawn",
			parent_session: "sess-1",
			agent_id: "agent-gamma-id",
			agent_type: "builder",
			agent_name: "builder-gamma",
		});
		const tc = JSON.stringify({
			t: 1706000002000,
			type: "task_complete",
			task_id: "task-99",
			agent: "builder-gamma",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawn}\n${tc}\n`);

		const result = renderMessages("sess-1", TEST_DIR);
		expect(result).toContain("completed: task-99");
	});

	test("sorts messages, idle, and task_complete events chronologically", () => {
		const events = [
			JSON.stringify({
				t: 1706000000000,
				type: "spawn",
				parent_session: "sess-1",
				agent_id: "agent-x-id",
				agent_type: "builder",
				agent_name: "builder-x",
			}),
			JSON.stringify({
				t: 1706000000000,
				type: "spawn",
				parent_session: "sess-1",
				agent_id: "agent-se-id",
				agent_type: "builder",
				agent_name: "second-event",
			}),
			JSON.stringify({
				t: 1706000003000,
				type: "task_complete",
				task_id: "t1",
				agent: "builder-x",
				subject: "third-event",
			}),
			JSON.stringify({
				t: 1706000001000,
				type: "msg_send",
				session_id: "sess-1",
				from: "agent-a",
				to: "agent-b",
				msg_type: "text",
				summary: "first-event",
			}),
			JSON.stringify({
				t: 1706000002000,
				type: "teammate_idle",
				teammate: "second-event",
			}),
		].join("\n");
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${events}\n`);

		const result = renderMessages("sess-1", TEST_DIR);
		const lines = result.split("\n");
		expect(lines[0]).toContain("first-event");
		expect(lines[1]).toContain("second-event");
		expect(lines[2]).toContain("third-event");
	});

	test("returns contextual info when only spawn events exist", () => {
		const spawnLink = JSON.stringify({
			t: 1000,
			type: "spawn",
			parent_session: "parent-id",
			agent_id: "child-id",
			agent_type: "builder",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawnLink}\n`);

		const result = renderMessages("parent-id", TEST_DIR);
		expect(result).toContain("subagent coordination");
		expect(result).toContain("Task-based coordination visible in: clens agents");
	});
});

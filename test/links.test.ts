import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { appendLink, extractLinkEvent, isLinkEvent } from "../src/capture/links";

const TEST_DIR = "/tmp/clens-test-links";

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("isLinkEvent", () => {
	test("SubagentStart is always a link event", () => {
		expect(isLinkEvent("SubagentStart", {})).toBe(true);
	});

	test("SubagentStop is always a link event", () => {
		expect(isLinkEvent("SubagentStop", {})).toBe(true);
	});

	test("SessionEnd is always a link event", () => {
		expect(isLinkEvent("SessionEnd", {})).toBe(true);
	});

	test("TeammateIdle is always a link event", () => {
		expect(isLinkEvent("TeammateIdle", {})).toBe(true);
	});

	test("TaskCompleted is always a link event", () => {
		expect(isLinkEvent("TaskCompleted", {})).toBe(true);
	});

	test("PreToolUse with SendMessage is a link event", () => {
		expect(isLinkEvent("PreToolUse", { tool_name: "SendMessage" })).toBe(true);
	});

	test("PreToolUse with TaskCreate is a link event", () => {
		expect(isLinkEvent("PreToolUse", { tool_name: "TaskCreate" })).toBe(true);
	});

	test("PreToolUse with TaskUpdate is a link event", () => {
		expect(isLinkEvent("PreToolUse", { tool_name: "TaskUpdate" })).toBe(true);
	});

	test("PreToolUse with TeamCreate is a link event", () => {
		expect(isLinkEvent("PreToolUse", { tool_name: "TeamCreate" })).toBe(true);
	});

	test("PreToolUse with Edit is NOT a link event", () => {
		expect(isLinkEvent("PreToolUse", { tool_name: "Edit" })).toBe(false);
	});

	test("PostToolUse is NOT a link event", () => {
		expect(isLinkEvent("PostToolUse", { tool_name: "SendMessage" })).toBe(false);
	});

	test("Notification is NOT a link event", () => {
		expect(isLinkEvent("Notification", {})).toBe(false);
	});
});

describe("extractLinkEvent", () => {
	test("SubagentStart produces spawn link with all fields", () => {
		const link = extractLinkEvent("SubagentStart", {
			session_id: "parent-1",
			agent_id: "child-1",
			agent_type: "builder",
			agent_name: "my-builder",
		});
		expect(link.type).toBe("spawn");
		if (link.type === "spawn") {
			expect(link.parent_session).toBe("parent-1");
			expect(link.agent_id).toBe("child-1");
			expect(link.agent_type).toBe("builder");
			expect(link.agent_name).toBe("my-builder");
			expect(link.t).toBeGreaterThan(0);
		}
	});

	test("SubagentStop produces stop link", () => {
		const link = extractLinkEvent("SubagentStop", {
			session_id: "parent-2",
			agent_id: "child-2",
			agent_transcript_path: "/tmp/transcript.jsonl",
		});
		expect(link.type).toBe("stop");
		if (link.type === "stop") {
			expect(link.parent_session).toBe("parent-2");
			expect(link.agent_id).toBe("child-2");
			expect(link.transcript_path).toBe("/tmp/transcript.jsonl");
		}
	});

	test("SubagentStop defaults agent_id to empty string when missing", () => {
		const link = extractLinkEvent("SubagentStop", {
			session_id: "parent-3",
		});
		expect(link.type).toBe("stop");
		if (link.type === "stop") {
			expect(link.agent_id).toBe("");
			expect(link.transcript_path).toBeUndefined();
		}
	});

	test("PreToolUse SendMessage produces msg_send link", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-1",
			tool_name: "SendMessage",
			tool_input: {
				recipient: "builder",
				type: "message",
				summary: "Test message",
				content: "Hello builder",
			},
		});
		expect(link.type).toBe("msg_send");
		if (link.type === "msg_send") {
			expect(link.to).toBe("builder");
			expect(link.msg_type).toBe("message");
			expect(link.summary).toBe("Test message");
			expect(link.content_hash).toBeDefined();
			expect(link.session_id).toBe("sess-1");
		}
	});

	test("PreToolUse SendMessage uses 'to' field as fallback when no recipient", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-msg-2",
			tool_name: "SendMessage",
			tool_input: {
				to: "reviewer",
				type: "update",
			},
		});
		expect(link.type).toBe("msg_send");
		if (link.type === "msg_send") {
			expect(link.to).toBe("reviewer");
			expect(link.msg_type).toBe("update");
		}
	});

	test("PreToolUse TaskCreate produces task link with create action", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-tc",
			tool_name: "TaskCreate",
			tool_input: {
				taskId: "task-42",
				subject: "Implement feature X",
			},
		});
		expect(link.type).toBe("task");
		if (link.type === "task") {
			expect(link.action).toBe("create");
			expect(link.task_id).toBe("task-42");
			expect(link.session_id).toBe("sess-tc");
			expect(link.agent).toBe("sess-tc");
			expect(link.subject).toBe("Implement feature X");
		}
	});

	test("PreToolUse TaskUpdate with status produces status_change action", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-tu",
			tool_name: "TaskUpdate",
			tool_input: {
				taskId: "task-99",
				status: "completed",
			},
		});
		expect(link.type).toBe("task");
		if (link.type === "task") {
			expect(link.action).toBe("status_change");
			expect(link.task_id).toBe("task-99");
			expect(link.status).toBe("completed");
		}
	});

	test("PreToolUse TaskUpdate without status produces assign action", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-tu2",
			tool_name: "TaskUpdate",
			tool_input: {
				taskId: "task-100",
				owner: "agent-builder",
			},
		});
		expect(link.type).toBe("task");
		if (link.type === "task") {
			expect(link.action).toBe("assign");
			expect(link.task_id).toBe("task-100");
			expect(link.owner).toBe("agent-builder");
		}
	});

	test("PreToolUse TeamCreate produces team link", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-team",
			tool_name: "TeamCreate",
			tool_input: {
				team_name: "backend-squad",
			},
		});
		expect(link.type).toBe("team");
		if (link.type === "team") {
			expect(link.team_name).toBe("backend-squad");
			expect(link.leader_session).toBe("sess-team");
		}
	});

	test("SessionEnd produces session_end link", () => {
		const link = extractLinkEvent("SessionEnd", {
			session_id: "sess-1",
			reason: "completed",
		});
		expect(link.type).toBe("session_end");
		if (link.type === "session_end") {
			expect(link.session).toBe("sess-1");
		}
	});

	test("TeammateIdle produces teammate_idle link", () => {
		const link = extractLinkEvent("TeammateIdle", {
			session_id: "sess-idle",
			agent_name: "builder-1",
			team_name: "my-team",
		});
		expect(link.type).toBe("teammate_idle");
		if (link.type === "teammate_idle") {
			expect(link.teammate).toBe("builder-1");
			expect(link.team).toBe("my-team");
		}
	});

	test("TeammateIdle falls back to agent_id when agent_name is missing", () => {
		const link = extractLinkEvent("TeammateIdle", {
			session_id: "sess-idle2",
			agent_id: "agent-fallback",
		});
		expect(link.type).toBe("teammate_idle");
		if (link.type === "teammate_idle") {
			expect(link.teammate).toBe("agent-fallback");
		}
	});

	test("TaskCompleted produces task_complete link", () => {
		const link = extractLinkEvent("TaskCompleted", {
			session_id: "sess-done",
			task_id: "task-77",
			agent_name: "builder-agent",
			subject: "Fix the tests",
		});
		expect(link.type).toBe("task_complete");
		if (link.type === "task_complete") {
			expect(link.task_id).toBe("task-77");
			expect(link.agent).toBe("builder-agent");
			expect(link.subject).toBe("Fix the tests");
		}
	});

	test("TaskCompleted falls back to session_id when agent_name is missing", () => {
		const link = extractLinkEvent("TaskCompleted", {
			session_id: "sess-done2",
			task_id: "task-78",
		});
		expect(link.type).toBe("task_complete");
		if (link.type === "task_complete") {
			expect(link.agent).toBe("sess-done2");
		}
	});

	test("unknown event type returns session_end fallback", () => {
		const link = extractLinkEvent("SomeUnknownEvent", {
			session_id: "sess-fallback",
		});
		expect(link.type).toBe("session_end");
		if (link.type === "session_end") {
			expect(link.session).toBe("sess-fallback");
		}
	});

	test("PreToolUse with unrecognized tool returns session_end fallback", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-unknown-tool",
			tool_name: "SomeOtherTool",
			tool_input: {},
		});
		expect(link.type).toBe("session_end");
	});

	test("defaults session_id to 'unknown' when missing", () => {
		const link = extractLinkEvent("SessionEnd", {});
		if (link.type === "session_end") {
			expect(link.session).toBe("unknown");
		}
	});
});

describe("appendLink", () => {
	test("writes link event to _links.jsonl file", () => {
		const linkEvent = extractLinkEvent("SubagentStart", {
			session_id: "sess-append",
			agent_id: "child-a",
			agent_type: "builder",
		});

		appendLink(TEST_DIR, linkEvent);

		const linksPath = `${TEST_DIR}/.clens/sessions/_links.jsonl`;
		expect(existsSync(linksPath)).toBe(true);

		const content = readFileSync(linksPath, "utf-8").trim();
		const parsed = JSON.parse(content);
		expect(parsed.type).toBe("spawn");
		expect(parsed.agent_id).toBe("child-a");
	});

	test("appends multiple link events as separate lines", () => {
		const link1 = extractLinkEvent("SubagentStart", {
			session_id: "sess-multi",
			agent_id: "child-1",
			agent_type: "builder",
		});
		const link2 = extractLinkEvent("SubagentStop", {
			session_id: "sess-multi",
			agent_id: "child-1",
		});

		appendLink(TEST_DIR, link1);
		appendLink(TEST_DIR, link2);

		const linksPath = `${TEST_DIR}/.clens/sessions/_links.jsonl`;
		const lines = readFileSync(linksPath, "utf-8").trim().split("\n");
		expect(lines.length).toBe(2);
		expect(JSON.parse(lines[0]).type).toBe("spawn");
		expect(JSON.parse(lines[1]).type).toBe("stop");
	});

	test("creates directories if they do not exist", () => {
		const deepDir = `${TEST_DIR}/nested/project`;
		mkdirSync(deepDir, { recursive: true });

		const linkEvent = extractLinkEvent("SessionEnd", {
			session_id: "sess-deep",
		});

		appendLink(deepDir, linkEvent);

		const linksPath = `${deepDir}/.clens/sessions/_links.jsonl`;
		expect(existsSync(linksPath)).toBe(true);
	});
});

describe("simpleHash (via content_hash in msg_send)", () => {
	test("produces consistent hash for same input", () => {
		const makeLink = () =>
			extractLinkEvent("PreToolUse", {
				session_id: "sess-hash",
				tool_name: "SendMessage",
				tool_input: { content: "deterministic content", recipient: "x" },
			});

		const link1 = makeLink();
		const link2 = makeLink();

		if (link1.type === "msg_send" && link2.type === "msg_send") {
			expect(link1.content_hash).toBe(link2.content_hash);
			expect(link1.content_hash).toBeDefined();
		}
	});

	test("produces different hashes for different inputs", () => {
		const link1 = extractLinkEvent("PreToolUse", {
			session_id: "sess-hash2",
			tool_name: "SendMessage",
			tool_input: { content: "alpha", recipient: "x" },
		});
		const link2 = extractLinkEvent("PreToolUse", {
			session_id: "sess-hash2",
			tool_name: "SendMessage",
			tool_input: { content: "beta", recipient: "x" },
		});

		if (link1.type === "msg_send" && link2.type === "msg_send") {
			expect(link1.content_hash).not.toBe(link2.content_hash);
		}
	});

	test("content_hash is undefined when no content provided", () => {
		const link = extractLinkEvent("PreToolUse", {
			session_id: "sess-hash3",
			tool_name: "SendMessage",
			tool_input: { recipient: "x" },
		});

		if (link.type === "msg_send") {
			expect(link.content_hash).toBeUndefined();
		}
	});
});

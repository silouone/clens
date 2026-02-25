import { describe, expect, test } from "bun:test";
import { HOOK_EVENTS, type HookEventType, type LinkEvent, type StoredEvent } from "../src/types";

describe("format types", () => {
	test("HOOK_EVENTS has 17 entries", () => {
		expect(HOOK_EVENTS.length).toBe(17);
	});

	test("HOOK_EVENTS contains expected event types", () => {
		const expected: HookEventType[] = [
			"SessionStart",
			"SessionEnd",
			"UserPromptSubmit",
			"PreToolUse",
			"PostToolUse",
			"PostToolUseFailure",
			"PermissionRequest",
			"Notification",
			"SubagentStart",
			"SubagentStop",
			"Stop",
			"TeammateIdle",
			"TaskCompleted",
			"PreCompact",
			"ConfigChange",
			"WorktreeCreate",
			"WorktreeRemove",
		];
		for (const event of expected) {
			expect(HOOK_EVENTS).toContain(event);
		}
	});

	test("StoredEvent structure is valid", () => {
		const event: StoredEvent = {
			t: Date.now(),
			event: "PreToolUse",
			sid: "test-session",
			data: { tool_name: "Bash" },
		};
		expect(event.t).toBeGreaterThan(0);
		expect(event.event).toBe("PreToolUse");
		expect(event.sid).toBe("test-session");
		expect(event.data.tool_name).toBe("Bash");
	});

	test("LinkEvent spawn type validates", () => {
		const link: LinkEvent = {
			t: Date.now(),
			type: "spawn",
			parent_session: "parent",
			agent_id: "child",
			agent_type: "builder",
			agent_name: "my-builder",
		};
		expect(link.type).toBe("spawn");
	});

	test("LinkEvent msg_send type validates", () => {
		const link: LinkEvent = {
			t: Date.now(),
			type: "msg_send",
			msg_id: "m1",
			session_id: "sess",
			from: "lead",
			to: "builder",
			msg_type: "message",
			summary: "hello",
		};
		expect(link.type).toBe("msg_send");
	});
});

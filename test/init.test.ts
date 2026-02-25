import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { init, uninit } from "../src/commands/init";

const TEST_DIR = "/tmp/clens-test-init";

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.claude`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("init", () => {
	test("creates .clens directory structure", () => {
		init(TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.clens/sessions`)).toBe(true);
		expect(existsSync(`${TEST_DIR}/.clens/distilled`)).toBe(true);
	});

	test("creates backup of existing settings", () => {
		writeFileSync(
			`${TEST_DIR}/.claude/settings.json`,
			JSON.stringify({ permissions: { allow: ["Bash"] } }),
		);
		init(TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.clens/settings.backup.json`)).toBe(true);
		const backup = JSON.parse(
			readFileSync(`${TEST_DIR}/.clens/settings.backup.json`, "utf-8"),
		);
		expect(backup.permissions).toBeDefined();
	});

	test("writes hooks for all 17 event types", () => {
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.json`, "utf-8"));
		expect(Object.keys(settings.hooks).length).toBe(17);
		expect(settings.hooks.PreToolUse).toBeDefined();
		expect(settings.hooks.PostToolUse).toBeDefined();
		expect(settings.hooks.SessionStart).toBeDefined();
		expect(settings.hooks.SessionEnd).toBeDefined();
		expect(settings.hooks.ConfigChange).toBeDefined();
		expect(settings.hooks.WorktreeCreate).toBeDefined();
		expect(settings.hooks.WorktreeRemove).toBeDefined();
	});

	test("preserves existing permissions block", () => {
		writeFileSync(
			`${TEST_DIR}/.claude/settings.json`,
			JSON.stringify({
				permissions: { allow: ["Bash", "Read"] },
				hooks: {},
			}),
		);
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.json`, "utf-8"));
		expect(settings.permissions.allow).toContain("Bash");
	});

	test("saves delegated hooks if any existed", () => {
		const existing = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "my-custom-hook PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(existing));
		const result = init(TEST_DIR);
		expect(result.delegated_hooks_count).toBe(1);
		const delegated = JSON.parse(
			readFileSync(`${TEST_DIR}/.clens/delegated-hooks.json`, "utf-8"),
		);
		expect(delegated.PreToolUse).toContain("my-custom-hook PreToolUse");
	});

	test("hooks use string matcher, not object", () => {
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.json`, "utf-8"));
		for (const [_event, entries] of Object.entries(settings.hooks)) {
			for (const entry of entries as Array<Record<string, unknown>>) {
				// matcher should be undefined (omitted) or a string, never an object
				if (entry.matcher !== undefined) {
					expect(typeof entry.matcher).toBe("string");
				}
			}
		}
	});

	test("idempotent: init twice does not corrupt state", () => {
		init(TEST_DIR);
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.json`, "utf-8"));
		// Should still have exactly 1 hook per event type
		for (const hooks of Object.values(settings.hooks)) {
			expect((hooks as unknown[]).length).toBe(1);
		}
	});

	test("works with no existing settings.json", () => {
		rmSync(`${TEST_DIR}/.claude/settings.json`, { force: true });
		const result = init(TEST_DIR);
		expect(result.created).toBe(true);
		expect(existsSync(`${TEST_DIR}/.claude/settings.json`)).toBe(true);
	});
});

describe("uninit", () => {
	test("restores backup and removes delegated hooks", () => {
		const original = { permissions: { allow: ["Bash"] } };
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(original));
		init(TEST_DIR);
		uninit(TEST_DIR);

		const restored = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.json`, "utf-8"));
		expect(restored.permissions.allow).toContain("Bash");
		expect(restored.hooks).toBeUndefined();
		expect(existsSync(`${TEST_DIR}/.clens/delegated-hooks.json`)).toBe(false);
	});

	test("keeps sessions directory", () => {
		init(TEST_DIR);
		mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
		writeFileSync(`${TEST_DIR}/.clens/sessions/test.jsonl`, "data");
		uninit(TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.clens/sessions/test.jsonl`)).toBe(true);
	});

	test("throws if no backup exists", () => {
		expect(() => uninit(TEST_DIR)).toThrow();
	});
});

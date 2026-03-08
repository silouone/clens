import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	detectLegacyInstall,
	init,
	initCommand,
	isAlreadyInitialized,
	readSettingsFile,
	resolveInitPaths,
	uninit,
	uninitAll,
	type HooksMap,
} from "../src/commands/init";
import type { Flags } from "../src/commands/shared";

const TEST_DIR = "/tmp/clens-test-init";

const makeFlags = (overrides: Partial<Flags> = {}): Flags => ({
	last: false,
	force: false,
	otel: false,
	deep: false,
	json: false,
	help: false,
	version: false,
	detail: false,
	full: false,
	all: false,
	remove: false,
	status: false,
	dev: false,
	comms: false,
	global: false,
	legacy: false,
	...overrides,
});

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.claude`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

// =============================================================================
// Init Core Tests
// =============================================================================

describe("init", () => {
	test("creates .clens directory structure", () => {
		init(TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.clens/sessions`)).toBe(true);
		expect(existsSync(`${TEST_DIR}/.clens/distilled`)).toBe(true);
	});

	test("writes hooks to settings.local.json by default", () => {
		init(TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.claude/settings.local.json`)).toBe(true);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		expect(settings.hooks).toBeDefined();
		expect(Object.keys(settings.hooks).length).toBe(17);
	});

	test("does not modify settings.json", () => {
		init(TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.claude/settings.json`)).toBe(false);
	});

	test("creates backup of existing settings", () => {
		writeFileSync(
			`${TEST_DIR}/.claude/settings.local.json`,
			JSON.stringify({ permissions: { allow: ["Bash"] } }),
		);
		init(TEST_DIR);
		expect(existsSync(`${TEST_DIR}/.clens/settings-local.backup.json`)).toBe(true);
		const backup = JSON.parse(
			readFileSync(`${TEST_DIR}/.clens/settings-local.backup.json`, "utf-8"),
		);
		expect(backup.permissions).toBeDefined();
	});

	test("writes hooks for all 17 event types", () => {
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		expect(Object.keys(settings.hooks).length).toBe(17);
		expect(settings.hooks.PreToolUse).toBeDefined();
		expect(settings.hooks.PostToolUse).toBeDefined();
		expect(settings.hooks.SessionStart).toBeDefined();
		expect(settings.hooks.SessionEnd).toBeDefined();
		expect(settings.hooks.ConfigChange).toBeDefined();
		expect(settings.hooks.WorktreeCreate).toBeDefined();
		expect(settings.hooks.WorktreeRemove).toBeDefined();
	});

	test("preserves existing settings.local.json content", () => {
		writeFileSync(
			`${TEST_DIR}/.claude/settings.local.json`,
			JSON.stringify({
				permissions: { allow: ["Bash", "Read"] },
				hooks: {},
			}),
		);
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		expect(settings.permissions.allow).toContain("Bash");
		expect(settings.permissions.allow).toContain("Read");
	});

	test("saves delegated hooks if any existed", () => {
		const existing = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "my-custom-hook PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.local.json`, JSON.stringify(existing));
		const result = init(TEST_DIR);
		expect(result.delegated_hooks_count).toBe(1);
		const delegated = JSON.parse(
			readFileSync(`${TEST_DIR}/.clens/delegated-hooks.json`, "utf-8"),
		);
		expect(delegated.PreToolUse).toContain("my-custom-hook PreToolUse");
	});

	test("hooks use string matcher, not object", () => {
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		Object.entries(settings.hooks).forEach(([_event, entries]) => {
			(entries as Array<Record<string, unknown>>).forEach((entry) => {
				if (entry.matcher !== undefined) {
					expect(typeof entry.matcher).toBe("string");
				}
			});
		});
	});

	test("idempotent: init twice does not corrupt state", () => {
		init(TEST_DIR);
		init(TEST_DIR);
		const settings = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		// Should still have exactly 1 hook per event type
		Object.values(settings.hooks).forEach((hooks) => {
			expect((hooks as unknown[]).length).toBe(1);
		});
	});

	test("works with no existing settings.local.json", () => {
		rmSync(`${TEST_DIR}/.claude/settings.local.json`, { force: true });
		const result = init(TEST_DIR);
		expect(result.created).toBe(true);
		expect(existsSync(`${TEST_DIR}/.claude/settings.local.json`)).toBe(true);
	});

	test("result includes local target by default", () => {
		const result = init(TEST_DIR);
		expect(result.target).toBe("local");
	});
});

// =============================================================================
// Global Tier Tests (path resolution — no real home dir writes)
// =============================================================================

describe("init --global", () => {
	test("resolveInitPaths returns global paths for global target", () => {
		const paths = resolveInitPaths(TEST_DIR, "global");
		expect(paths.settingsPath).toMatch(/\.claude\/settings\.json$/);
		expect(paths.backupPath).toMatch(/\.clens\/settings\.backup\.json$/);
		expect(paths.settingsPath).not.toContain("settings.local.json");
	});

	test("resolveInitPaths returns local paths for local target", () => {
		const paths = resolveInitPaths(TEST_DIR, "local");
		expect(paths.settingsPath).toBe(`${TEST_DIR}/.claude/settings.local.json`);
		expect(paths.backupPath).toBe(`${TEST_DIR}/.clens/settings-local.backup.json`);
		expect(paths.delegatedPath).toBe(`${TEST_DIR}/.clens/delegated-hooks.json`);
	});

	test("global paths use homedir, not projectDir", () => {
		const paths = resolveInitPaths(TEST_DIR, "global");
		expect(paths.settingsPath).not.toContain(TEST_DIR);
		expect(paths.backupPath).not.toContain(TEST_DIR);
	});

	test("global init returns global target in result", () => {
		// Test the pure path resolution — actual global init writes to real home dir
		const paths = resolveInitPaths("/tmp/fake-project", "global");
		expect(paths.settingsDir).toMatch(/\.claude$/);
		expect(paths.backupDir).toMatch(/\.clens$/);
	});
});

// =============================================================================
// Legacy Detection Tests
// =============================================================================

describe("legacy detection", () => {
	test("detectLegacyInstall returns false when no hooks in settings.json", () => {
		expect(detectLegacyInstall(TEST_DIR)).toBe(false);
	});

	test("detectLegacyInstall returns true when clens hooks in settings.json", () => {
		const settings = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "clens-hook PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(settings));
		expect(detectLegacyInstall(TEST_DIR)).toBe(true);
	});

	test("detectLegacyInstall detects hook.ts references as legacy", () => {
		const settings = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "bun run /path/to/hook.ts PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(settings));
		expect(detectLegacyInstall(TEST_DIR)).toBe(true);
	});

	test("detectLegacyInstall ignores non-clens hooks", () => {
		const settings = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "other-tool PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(settings));
		expect(detectLegacyInstall(TEST_DIR)).toBe(false);
	});

	test("init warns about legacy hooks when detected", () => {
		const settings = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "clens-hook PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(settings));
		const result = init(TEST_DIR);
		expect(result.warning).toBeDefined();
		expect(result.warning).toContain("Legacy hooks detected");
	});
});

// =============================================================================
// Uninit Tests
// =============================================================================

describe("uninit", () => {
	test("restores backup and removes delegated hooks", () => {
		const original = { permissions: { allow: ["Bash"] } };
		writeFileSync(`${TEST_DIR}/.claude/settings.local.json`, JSON.stringify(original));
		init(TEST_DIR);
		uninit(TEST_DIR);

		const restored = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		expect(restored.permissions.allow).toContain("Bash");
		expect(restored.hooks).toBeUndefined();
		expect(existsSync(`${TEST_DIR}/.clens/delegated-hooks.json`)).toBe(false);
	});

	test("uninit removes hooks from settings.local.json", () => {
		init(TEST_DIR);
		const before = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		expect(before.hooks).toBeDefined();

		uninit(TEST_DIR);
		const after = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.local.json`, "utf-8"));
		expect(after.hooks).toBeUndefined();
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

// =============================================================================
// UninitAll Tests
// =============================================================================

describe("uninitAll", () => {
	test("removes local hooks", () => {
		init(TEST_DIR);
		const result = uninitAll(TEST_DIR, false);
		expect(result.localRemoved).toBe(true);
	});

	test("removes legacy hooks when removeLegacy is true", () => {
		const settings = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "clens-hook PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(settings));
		const result = uninitAll(TEST_DIR, true);
		expect(result.legacyRemoved).toBe(true);
		const cleaned = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.json`, "utf-8"));
		expect(cleaned.hooks).toBeUndefined();
	});

	test("does not remove legacy hooks when removeLegacy is false", () => {
		const settings = {
			hooks: {
				PreToolUse: [{ hooks: [{ type: "command", command: "clens-hook PreToolUse" }] }],
			},
		};
		writeFileSync(`${TEST_DIR}/.claude/settings.json`, JSON.stringify(settings));
		const result = uninitAll(TEST_DIR, false);
		expect(result.legacyRemoved).toBe(false);
		const still = JSON.parse(readFileSync(`${TEST_DIR}/.claude/settings.json`, "utf-8"));
		expect(still.hooks).toBeDefined();
	});

	test("reports localRemoved false when no local hooks", () => {
		const result = uninitAll(TEST_DIR, false);
		expect(result.localRemoved).toBe(false);
	});
});

// =============================================================================
// Pure Helper Tests
// =============================================================================

describe("readSettingsFile and isAlreadyInitialized", () => {
	test("readSettingsFile returns empty for missing file", () => {
		const result = readSettingsFile("/tmp/nonexistent-clens-settings.json");
		expect(result.settings).toEqual({});
		expect(result.existingHooks).toEqual({});
	});

	test("readSettingsFile reads existing file correctly", () => {
		const content = { permissions: { allow: ["Bash"] }, hooks: { PreToolUse: [] } };
		writeFileSync(`${TEST_DIR}/test-settings.json`, JSON.stringify(content));
		const result = readSettingsFile(`${TEST_DIR}/test-settings.json`);
		expect(result.settings).toHaveProperty("permissions");
		expect(result.existingHooks).toHaveProperty("PreToolUse");
	});

	test("isAlreadyInitialized detects clens hooks", () => {
		const hooks: HooksMap = {
			PreToolUse: [{ hooks: [{ type: "command", command: "clens-hook PreToolUse" }] }],
		};
		expect(isAlreadyInitialized(hooks)).toBe(true);
	});

	test("isAlreadyInitialized detects hook.ts references", () => {
		const hooks: HooksMap = {
			PreToolUse: [{ hooks: [{ type: "command", command: "bun run /path/hook.ts PreToolUse" }] }],
		};
		expect(isAlreadyInitialized(hooks)).toBe(true);
	});

	test("isAlreadyInitialized returns false for non-clens hooks", () => {
		const hooks: HooksMap = {
			PreToolUse: [{ hooks: [{ type: "command", command: "other-tool PreToolUse" }] }],
		};
		expect(isAlreadyInitialized(hooks)).toBe(false);
	});

	test("isAlreadyInitialized returns false for empty hooks", () => {
		expect(isAlreadyInitialized({})).toBe(false);
	});
});

// =============================================================================
// Status Command Tests
// =============================================================================

describe("initCommand status", () => {
	test("status shows all tiers", () => {
		init(TEST_DIR);
		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		try {
			initCommand({
				projectDir: TEST_DIR,
				positional: ["init"],
				flags: makeFlags({ status: true }),
			});
		} finally {
			console.log = origLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("Local:");
		expect(output).toContain("Global:");
		expect(output).toContain("Plugin:");
		expect(output).toContain("Legacy:");
	});

	test("status reports session and distilled counts", () => {
		init(TEST_DIR);
		writeFileSync(`${TEST_DIR}/.clens/sessions/abc.jsonl`, "data");
		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};

		try {
			initCommand({
				projectDir: TEST_DIR,
				positional: ["init"],
				flags: makeFlags({ status: true }),
			});
		} finally {
			console.log = origLog;
		}

		const output = logs.join("\n");
		expect(output).toContain("Data:");
		expect(output).toContain("1 sessions");
	});
});

// =============================================================================
// Init Decoupling Tests
// =============================================================================

describe("init decoupling", () => {
	const TEST_INIT_DIR = "/tmp/clens-test-init-decouple";

	beforeEach(() => {
		rmSync(TEST_INIT_DIR, { recursive: true, force: true });
		mkdirSync(`${TEST_INIT_DIR}/.claude`, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_INIT_DIR, { recursive: true, force: true });
	});

	test("init() accepts projectDir as only required param", () => {
		// init.length returns params before first default value
		expect(init.length).toBe(1);
	});

	test("init() result does NOT have agentic field", () => {
		const result = init(TEST_INIT_DIR);
		expect(result).not.toHaveProperty("agentic");
		expect(result).not.toHaveProperty("noAgents");
		expect(result).not.toHaveProperty("agentic_installed");
	});

	test("uninit() does NOT create any agentic files in .claude/", () => {
		init(TEST_INIT_DIR);
		uninit(TEST_INIT_DIR);

		const claudeDir = join(TEST_INIT_DIR, ".claude");
		const agenticDir = join(claudeDir, "agentic");
		expect(existsSync(agenticDir)).toBe(false);

		// Also check no agentic-related files in .claude/
		const claudeFiles = existsSync(claudeDir) ? readdirSync(claudeDir) : [];
		const agenticFiles = claudeFiles.filter((f) => f.includes("agentic"));
		expect(agenticFiles).toHaveLength(0);
	});

	test("uninit() returns void (not a result with agentic info)", () => {
		init(TEST_INIT_DIR);
		const result = uninit(TEST_INIT_DIR);
		expect(result).toBeUndefined();
	});
});

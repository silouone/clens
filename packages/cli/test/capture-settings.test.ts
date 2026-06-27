import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferClaudeMd, resolveSettingsSnapshot } from "../src/capture/settings";

let root: string;
let dir: string; // isolated project dir
let savedHome: string | undefined;
let savedUserProfile: string | undefined;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "clens-cfg-"));
	// Isolate the user scope: point HOME at an empty home so the resolver never
	// picks up the real ~/.claude/settings.json (env-independent assertions).
	savedHome = process.env.HOME;
	savedUserProfile = process.env.USERPROFILE;
	process.env.HOME = join(root, "home");
	process.env.USERPROFILE = join(root, "home");
	mkdirSync(join(root, "home", ".claude"), { recursive: true });
	dir = join(root, "project");
	mkdirSync(join(dir, ".claude"), { recursive: true });
});

afterEach(() => {
	process.env.HOME = savedHome;
	process.env.USERPROFILE = savedUserProfile;
	rmSync(root, { recursive: true, force: true });
});

const writeProjectSettings = (obj: unknown, file = "settings.json") =>
	writeFileSync(join(dir, ".claude", file), JSON.stringify(obj));

describe("resolveSettingsSnapshot (CFG-3)", () => {
	test("snapshots known settings keys with provenance + source label", () => {
		writeProjectSettings({
			outputStyle: "Observable: Tools + Diffs + TTS",
			statusLine: { type: "command", command: "/Users/x/scripts/status_line_main.py" },
			enabledPlugins: { "superwhisper@superwhisper": true, "off@off": false },
			permissions: { defaultMode: "acceptEdits" },
			hooks: { PreToolUse: [{}], Stop: [{}] },
		});
		const snap = resolveSettingsSnapshot(dir);
		expect(snap?.settings_source).toBe("session_start");
		expect(typeof snap?.captured_at).toBe("number");
		expect(snap?.output_style).toBe("Observable: Tools + Diffs + TTS");
		expect(snap?.output_style_scope).toBe("project");
		// statusline keeps a basename only, never the full path
		expect(snap?.status_line).toEqual({ type: "command", command_name: "status_line_main.py" });
		expect(snap?.plugins_enabled).toEqual(["superwhisper@superwhisper"]);
		expect(snap?.permission_default_mode).toBe("acceptEdits");
		expect(snap?.hooks_configured).toEqual(["PreToolUse", "Stop"]);
	});

	test("local scope overrides project scope per key", () => {
		writeProjectSettings({ outputStyle: "project-style" }, "settings.json");
		writeProjectSettings({ outputStyle: "local-style" }, "settings.local.json");
		const snap = resolveSettingsSnapshot(dir);
		expect(snap?.output_style).toBe("local-style");
		expect(snap?.output_style_scope).toBe("local");
	});

	test("hooks + plugins union across scopes (concat + dedupe, not override)", () => {
		// user scope (HOME/.claude/settings.json)
		writeFileSync(
			join(process.env.HOME as string, ".claude", "settings.json"),
			JSON.stringify({ hooks: { Stop: [{}] }, enabledPlugins: { "a@a": true } }),
		);
		// project scope
		writeProjectSettings({ hooks: { PreToolUse: [{}] }, enabledPlugins: { "b@b": true } });
		const snap = resolveSettingsSnapshot(dir);
		expect(snap?.hooks_configured).toEqual(["PreToolUse", "Stop"]);
		expect(snap?.plugins_enabled).toEqual(["a@a", "b@b"]);
	});

	test("can label a distill-time read as 'current' (tier C)", () => {
		writeProjectSettings({ outputStyle: "x" });
		expect(resolveSettingsSnapshot(dir, "current")?.settings_source).toBe("current");
	});

	test("returns undefined (never an empty husk) when no settings file exists", () => {
		expect(resolveSettingsSnapshot(join(dir, "nope"))).toBeUndefined();
	});

	test("malformed settings JSON yields undefined, never throws", () => {
		writeFileSync(join(dir, ".claude", "settings.json"), "{ not json");
		expect(() => resolveSettingsSnapshot(dir)).not.toThrow();
		expect(resolveSettingsSnapshot(dir)).toBeUndefined();
	});
});

describe("inferClaudeMd (CFG-5 fallback)", () => {
	test("records fact-of-existence of project CLAUDE.md, labeled inferred", () => {
		writeFileSync(join(dir, "CLAUDE.md"), "# project memory");
		const found = inferClaudeMd(dir);
		expect(found.some((e) => e.file_path === join(dir, "CLAUDE.md"))).toBe(true);
		expect(found.every((e) => e.memory_type === "inferred")).toBe(true);
	});

	test("returns empty array (never throws) when no CLAUDE.md exists in project", () => {
		const empty = join(dir, "empty-project");
		mkdirSync(empty, { recursive: true });
		expect(() => inferClaudeMd(empty)).not.toThrow();
	});
});

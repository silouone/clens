import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { init, uninit } from "../src/commands/init";
import {
	getPluginDir,
	installPlugin,
	isPluginInstalled,
	uninstallPlugin,
	validatePluginStructure,
} from "../src/commands/plugin";

const TEST_INSTALL_DIR = "/tmp/clens-test-plugin";
const AGENTIC_DIR = join(import.meta.dir, "..", "agentic");

// --- Helpers ---

const countFilesRecursive = (dir: string): number =>
	readdirSync(dir).reduce((count, entry) => {
		const full = join(dir, entry);
		return statSync(full).isDirectory() ? count + countFilesRecursive(full) : count + 1;
	}, 0);

const parseFrontmatter = (content: string): Record<string, string> | undefined => {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return undefined;
	return Object.fromEntries(
		match[1]
			.split("\n")
			.filter((line) => line.includes(":"))
			.map((line) => {
				const idx = line.indexOf(":");
				return [
					line.slice(0, idx).trim(),
					line
						.slice(idx + 1)
						.trim()
						.replace(/^["']|["']$/g, ""),
				] as const;
			}),
	);
};

const COMMAND_FILES = [
	"commands/backtrack-analysis.md",
	"commands/session-compare.md",
	"commands/session-report.md",
] as const;

const SKILL_FILE = "skills/session-analysis/SKILL.md";
const AGENT_FILE = "agents/session-analyst.md";

const ALL_SOURCE_FILES = [
	".claude-plugin/plugin.json",
	...COMMAND_FILES,
	SKILL_FILE,
	"skills/session-analysis/distill-schema.md",
	"skills/session-analysis/interpretation-guide.md",
	AGENT_FILE,
] as const;

// =============================================================================
// Plugin Structure Tests (5+)
// =============================================================================

describe("plugin structure", () => {
	test("agentic/.claude-plugin/plugin.json exists and is valid JSON", () => {
		const pluginJsonPath = join(AGENTIC_DIR, ".claude-plugin", "plugin.json");
		expect(existsSync(pluginJsonPath)).toBe(true);
		const content = readFileSync(pluginJsonPath, "utf-8");
		expect(() => JSON.parse(content)).not.toThrow();
	});

	test("plugin.json has required fields: name, version, description", () => {
		const pluginJsonPath = join(AGENTIC_DIR, ".claude-plugin", "plugin.json");
		const plugin = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
		expect(plugin.name).toBeString();
		expect(plugin.version).toBeString();
		expect(plugin.description).toBeString();
	});

	test("plugin.json version matches package.json version", () => {
		const pluginJsonPath = join(AGENTIC_DIR, ".claude-plugin", "plugin.json");
		const pkgJsonPath = join(import.meta.dir, "..", "package.json");
		const pluginVersion = JSON.parse(readFileSync(pluginJsonPath, "utf-8")).version;
		const pkgVersion = JSON.parse(readFileSync(pkgJsonPath, "utf-8")).version;
		expect(pluginVersion).toBe(pkgVersion);
	});

	test("all content files exist under agentic/", () => {
		ALL_SOURCE_FILES.map((relPath) => expect(existsSync(join(AGENTIC_DIR, relPath))).toBe(true));
	});

	test("validatePluginStructure() returns valid for the actual agentic/ directory", () => {
		const result = validatePluginStructure();
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	test("getPluginDir() points to agentic/ directory", () => {
		const dir = getPluginDir();
		expect(dir).toBe(AGENTIC_DIR);
		expect(existsSync(dir)).toBe(true);
	});
});

// =============================================================================
// Plugin Install Tests (6+)
// =============================================================================

describe("plugin install", () => {
	beforeEach(() => {
		rmSync(TEST_INSTALL_DIR, { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(TEST_INSTALL_DIR, { recursive: true, force: true });
	});

	test("installPlugin creates all files in the test directory", () => {
		const result = installPlugin(TEST_INSTALL_DIR);
		expect(result.files_copied).toBeGreaterThan(0);
		expect(existsSync(TEST_INSTALL_DIR)).toBe(true);
		expect(result.installed_to).toBe(TEST_INSTALL_DIR);
	});

	test("installPlugin preserves directory structure (commands/, skills/, agents/)", () => {
		installPlugin(TEST_INSTALL_DIR);
		expect(existsSync(join(TEST_INSTALL_DIR, "commands"))).toBe(true);
		expect(existsSync(join(TEST_INSTALL_DIR, "skills"))).toBe(true);
		expect(existsSync(join(TEST_INSTALL_DIR, "agents"))).toBe(true);
	});

	test("installPlugin copies .claude-plugin/plugin.json", () => {
		installPlugin(TEST_INSTALL_DIR);
		const pluginJsonPath = join(TEST_INSTALL_DIR, ".claude-plugin", "plugin.json");
		expect(existsSync(pluginJsonPath)).toBe(true);
		const plugin = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
		expect(plugin.name).toBe("clens");
	});

	test("installPlugin is idempotent (running twice works, correct file count)", () => {
		const first = installPlugin(TEST_INSTALL_DIR);
		const second = installPlugin(TEST_INSTALL_DIR);
		expect(second.files_copied).toBe(first.files_copied);
		const actualCount = countFilesRecursive(TEST_INSTALL_DIR);
		expect(actualCount).toBe(first.files_copied);
	});

	test("installPlugin overwrites existing files (update scenario)", () => {
		installPlugin(TEST_INSTALL_DIR);
		const targetPath = join(TEST_INSTALL_DIR, "agents", "session-analyst.md");
		writeFileSync(targetPath, "corrupted content");

		installPlugin(TEST_INSTALL_DIR);
		const content = readFileSync(targetPath, "utf-8");
		expect(content).not.toBe("corrupted content");
		// Should match original source
		const srcContent = readFileSync(join(AGENTIC_DIR, "agents", "session-analyst.md"), "utf-8");
		expect(content).toBe(srcContent);
	});

	test("isPluginInstalled returns false before install, true after", () => {
		expect(isPluginInstalled(TEST_INSTALL_DIR)).toBe(false);
		installPlugin(TEST_INSTALL_DIR);
		expect(isPluginInstalled(TEST_INSTALL_DIR)).toBe(true);
	});

	test("installPlugin returns correct version from package.json", () => {
		const pkgVersion = JSON.parse(
			readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"),
		).version;
		const result = installPlugin(TEST_INSTALL_DIR);
		expect(result.version).toBe(pkgVersion);
	});

	test("installed files match source files byte-for-byte", () => {
		installPlugin(TEST_INSTALL_DIR);

		ALL_SOURCE_FILES.forEach((relPath) => {
			const src = readFileSync(join(AGENTIC_DIR, relPath), "utf-8");
			const dest = readFileSync(join(TEST_INSTALL_DIR, relPath), "utf-8");
			expect(dest).toBe(src);
		});
	});
});

// =============================================================================
// Plugin Uninstall Tests (4+)
// =============================================================================

describe("plugin uninstall", () => {
	beforeEach(() => {
		rmSync(TEST_INSTALL_DIR, { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(TEST_INSTALL_DIR, { recursive: true, force: true });
	});

	test("uninstallPlugin removes all installed files", () => {
		installPlugin(TEST_INSTALL_DIR);
		expect(existsSync(TEST_INSTALL_DIR)).toBe(true);
		const removed = uninstallPlugin(TEST_INSTALL_DIR);
		expect(removed).toBe(true);
		expect(existsSync(TEST_INSTALL_DIR)).toBe(false);
	});

	test("uninstallPlugin returns false if nothing installed", () => {
		const result = uninstallPlugin(TEST_INSTALL_DIR);
		expect(result).toBe(false);
	});

	test("isPluginInstalled returns false after uninstall", () => {
		installPlugin(TEST_INSTALL_DIR);
		expect(isPluginInstalled(TEST_INSTALL_DIR)).toBe(true);
		uninstallPlugin(TEST_INSTALL_DIR);
		expect(isPluginInstalled(TEST_INSTALL_DIR)).toBe(false);
	});

	test("roundtrip: install → verify → uninstall → verify gone", () => {
		// Install
		const result = installPlugin(TEST_INSTALL_DIR);
		expect(result.files_copied).toBeGreaterThan(0);

		// Verify installed
		expect(isPluginInstalled(TEST_INSTALL_DIR)).toBe(true);
		expect(existsSync(join(TEST_INSTALL_DIR, "commands"))).toBe(true);
		expect(existsSync(join(TEST_INSTALL_DIR, "skills"))).toBe(true);
		expect(existsSync(join(TEST_INSTALL_DIR, "agents"))).toBe(true);

		// Uninstall
		const removed = uninstallPlugin(TEST_INSTALL_DIR);
		expect(removed).toBe(true);

		// Verify gone
		expect(isPluginInstalled(TEST_INSTALL_DIR)).toBe(false);
		expect(existsSync(TEST_INSTALL_DIR)).toBe(false);
	});
});

// =============================================================================
// Init Decoupling Tests (3+)
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

	test("init() accepts only projectDir parameter (no options)", () => {
		// init should have exactly 1 parameter
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

// =============================================================================
// Content Validation Tests (7)
// =============================================================================

describe("content validation", () => {
	test("all command files have valid YAML frontmatter with description", () => {
		COMMAND_FILES.forEach((relPath) => {
			const content = readFileSync(join(AGENTIC_DIR, relPath), "utf-8");
			const fm = parseFrontmatter(content);
			expect(fm).toBeDefined();
			expect(fm?.description).toBeString();
			expect(fm?.description.length).toBeGreaterThan(0);
		});
	});

	test("all command files have argument-hint in frontmatter", () => {
		COMMAND_FILES.forEach((relPath) => {
			const content = readFileSync(join(AGENTIC_DIR, relPath), "utf-8");
			const fm = parseFrontmatter(content);
			expect(fm).toBeDefined();
			expect(fm?.["argument-hint"]).toBeDefined();
			expect(fm?.["argument-hint"].length).toBeGreaterThan(0);
		});
	});

	test("skill SKILL.md has name and description in frontmatter", () => {
		const content = readFileSync(join(AGENTIC_DIR, SKILL_FILE), "utf-8");
		const fm = parseFrontmatter(content);
		expect(fm).toBeDefined();
		expect(fm?.name).toBe("session-analysis");
		expect(fm?.description).toBeString();
		expect(fm?.description.length).toBeGreaterThan(0);
	});

	test("agent file has disallowedTools in frontmatter", () => {
		const content = readFileSync(join(AGENTIC_DIR, AGENT_FILE), "utf-8");
		const fm = parseFrontmatter(content);
		expect(fm).toBeDefined();
		expect(fm?.disallowedTools).toBeDefined();
		expect(fm?.disallowedTools).toContain("Write");
		expect(fm?.disallowedTools).toContain("Edit");
	});

	test("agent references session-analysis skill", () => {
		const content = readFileSync(join(AGENTIC_DIR, AGENT_FILE), "utf-8");
		const fm = parseFrontmatter(content);
		expect(fm).toBeDefined();
		expect(fm?.skill).toBeDefined();
		expect(fm?.skill).toContain("session-analysis");
	});

	test("all files have non-empty content beyond frontmatter", () => {
		const mdFiles = ALL_SOURCE_FILES.filter((f) => f.endsWith(".md"));
		mdFiles.forEach((relPath) => {
			const content = readFileSync(join(AGENTIC_DIR, relPath), "utf-8");
			const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
			expect(withoutFrontmatter.trim().length).toBeGreaterThan(0);
		});
	});

	test("all 8 source files exist", () => {
		expect(ALL_SOURCE_FILES).toHaveLength(8);
		ALL_SOURCE_FILES.map((relPath) => expect(existsSync(join(AGENTIC_DIR, relPath))).toBe(true));
	});
});

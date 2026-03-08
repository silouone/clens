import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";


// --- Types ---

export type PluginInstallResult = {
	readonly installed_to: string;
	readonly files_copied: number;
	readonly symlinks_created: number;
	readonly hooks_installed: number;
	readonly version: string;
};

// --- Constants ---

const PLUGIN_INSTALL_DIR = join(homedir(), ".clens", "plugin", "clens");
const CLAUDE_USER_DIR = join(homedir(), ".claude");

// Mapping from plugin subdirectories to ~/.claude/ subdirectories
const SYMLINK_DIRS = ["agents", "commands", "skills"] as const;

// In compiled Bun binaries, import.meta.dir resolves to /$bunfs/root (virtual FS).
// In that case, use process.execPath (the compiled binary) to find the project root.
// In dev/test mode, import.meta.dir points to the real source directory.
const resolveProjectRoot = (): string => {
	if (!import.meta.dir.startsWith("/$bunfs")) {
		return join(import.meta.dir, "..", "..");
	}
	const realExecPath = realpathSync(process.execPath);
	return join(dirname(realExecPath), "..");
};

const resolvePluginSrcDir = (): string => join(resolveProjectRoot(), "agentic");

const CLAUDE_USER_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const CLENS_SETTINGS_BACKUP_PATH = join(homedir(), ".clens", "settings.backup.json");
const CLENS_HOOK_MARKER = "clens-hook";

// --- Pure helpers ---

const readPackageVersion = (): string => {
	const pkgPath = join(resolveProjectRoot(), "package.json");
	try {
		const raw = readFileSync(pkgPath, "utf-8");
		const pkg: unknown = JSON.parse(raw);
		return typeof pkg === "object" &&
			pkg !== null &&
			"version" in pkg &&
			typeof (pkg as Record<string, unknown>).version === "string"
			? ((pkg as Record<string, unknown>).version as string)
			: "0.0.0";
	} catch {
		return "0.0.0";
	}
};

const collectFiles = (dir: string, base: string): readonly string[] =>
	readdirSync(dir).flatMap((entry): readonly string[] => {
		const fullPath = join(dir, entry);
		const relPath = join(base, entry);
		return statSync(fullPath).isDirectory() ? collectFiles(fullPath, relPath) : [relPath];
	});

// Collect top-level entries (files and dirs) within a directory
const collectTopLevelEntries = (dir: string): readonly string[] =>
	existsSync(dir) ? readdirSync(dir) : [];

// existsSync follows symlinks and returns false for broken symlinks.
// lstatExists checks if the path entry itself exists (even broken symlinks).
const lstatExists = (path: string): boolean => {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
};

const isSymlinkTo = (linkPath: string, targetPath: string): boolean => {
	try {
		return (
			lstatSync(linkPath).isSymbolicLink() && realpathSync(linkPath) === realpathSync(targetPath)
		);
	} catch {
		return false;
	}
};

// --- Settings types ---

type HookHandler = { readonly type: string; readonly command: string };
type MatcherGroup = { readonly matcher?: string; readonly hooks: readonly HookHandler[] };
type HooksMap = Readonly<Record<string, readonly MatcherGroup[]>>;
type SettingsJson = Readonly<Record<string, unknown>> & { readonly hooks?: HooksMap };

// --- Settings pure helpers ---

const readJsonFile = (path: string): Record<string, unknown> => {
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
};

const asHooksMap = (value: unknown): HooksMap =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as HooksMap)
		: {};

const asSettingsJson = (value: Record<string, unknown>): SettingsJson => ({
	...value,
	hooks: value.hooks !== undefined ? asHooksMap(value.hooks) : undefined,
});

const isClensHookHandler = (handler: unknown): boolean =>
	typeof handler === "object" &&
	handler !== null &&
	"command" in handler &&
	typeof (handler as Record<string, unknown>).command === "string" &&
	((handler as Record<string, unknown>).command as string).includes(CLENS_HOOK_MARKER);

const isClensMatcherGroup = (group: unknown): boolean =>
	typeof group === "object" &&
	group !== null &&
	"hooks" in group &&
	Array.isArray((group as Record<string, unknown>).hooks) &&
	((group as Record<string, unknown>).hooks as readonly unknown[]).some(isClensHookHandler);

const mergePluginHooks = (
	existingSettings: SettingsJson,
	pluginHooks: HooksMap,
): SettingsJson => {
	const existingHooks: HooksMap = existingSettings.hooks ?? {};

	// For each event, filter out existing clens hooks, then append new plugin hooks
	const mergedHooks: Record<string, readonly MatcherGroup[]> = Object.fromEntries(
		Object.keys({ ...existingHooks, ...pluginHooks }).map((event) => {
			const existing = (existingHooks[event] ?? []).filter(
				(group) => !isClensMatcherGroup(group),
			);
			const incoming = pluginHooks[event] ?? [];
			return [event, [...existing, ...incoming] as readonly MatcherGroup[]];
		}),
	);

	return { ...existingSettings, hooks: mergedHooks };
};

const removeClensHooks = (settings: SettingsJson): SettingsJson => {
	const hooks = settings.hooks;
	if (!hooks) return settings;

	const cleaned: Record<string, readonly MatcherGroup[]> = Object.fromEntries(
		Object.entries(hooks)
			.map(
				([event, groups]) =>
					[event, groups.filter((group) => !isClensMatcherGroup(group))] as const,
			)
			.filter(([, groups]) => groups.length > 0),
	);

	return Object.keys(cleaned).length > 0
		? { ...settings, hooks: cleaned }
		: Object.fromEntries(Object.entries(settings).filter(([key]) => key !== "hooks"));
};

const countHookEvents = (hooks: HooksMap): number => Object.keys(hooks).length;

const settingsHaveClensHooks = (settings: SettingsJson): boolean => {
	const hooks = settings.hooks;
	if (!hooks) return false;
	return Object.values(hooks).some((groups) => groups.some(isClensMatcherGroup));
};

// --- I/O functions ---

const createSymlinks = (installDir: string): number =>
	SYMLINK_DIRS.filter((subdir) => existsSync(join(installDir, subdir))).reduce((count, subdir) => {
		const srcSubdir = join(installDir, subdir);
		const claudeSubdir = join(CLAUDE_USER_DIR, subdir);
		mkdirSync(claudeSubdir, { recursive: true });

		return (
			count +
			collectTopLevelEntries(srcSubdir)
				.filter((entry) => {
					const linkPath = join(claudeSubdir, entry);
					const linkExists = existsSync(linkPath) || lstatExists(linkPath);
					// Skip if a non-symlink file already exists (don't overwrite user files)
					return !linkExists || lstatSync(linkPath).isSymbolicLink();
				})
				.reduce((innerCount, entry) => {
					const srcPath = join(srcSubdir, entry);
					const linkPath = join(claudeSubdir, entry);
					const linkExists = existsSync(linkPath) || lstatExists(linkPath);

					// Remove stale symlink if it points elsewhere
					if (linkExists && lstatSync(linkPath).isSymbolicLink()) {
						unlinkSync(linkPath);
					}

					symlinkSync(srcPath, linkPath);
					return innerCount + 1;
				}, 0)
		);
	}, 0);

const removeSymlinks = (installDir: string): number =>
	SYMLINK_DIRS.filter(
		(subdir) => existsSync(join(installDir, subdir)) && existsSync(join(CLAUDE_USER_DIR, subdir)),
	).reduce((count, subdir) => {
		const srcSubdir = join(installDir, subdir);
		const claudeSubdir = join(CLAUDE_USER_DIR, subdir);

		return (
			count +
			collectTopLevelEntries(srcSubdir)
				.filter((entry) => isSymlinkTo(join(claudeSubdir, entry), join(srcSubdir, entry)))
				.reduce((innerCount, entry) => {
					unlinkSync(join(claudeSubdir, entry));
					return innerCount + 1;
				}, 0)
		);
	}, 0);

const installCaptureHooks = (installDir: string): number => {
	const hooksJsonPath = join(installDir, "hooks", "hooks.json");
	if (!existsSync(hooksJsonPath)) return 0;

	const pluginHooksFile = readJsonFile(hooksJsonPath);
	const pluginHooks = asHooksMap(pluginHooksFile.hooks);
	if (Object.keys(pluginHooks).length === 0) return 0;

	// Backup existing user settings
	const existingSettings = asSettingsJson(readJsonFile(CLAUDE_USER_SETTINGS_PATH));
	mkdirSync(dirname(CLENS_SETTINGS_BACKUP_PATH), { recursive: true });
	writeFileSync(CLENS_SETTINGS_BACKUP_PATH, JSON.stringify(existingSettings, null, "\t"), "utf-8");

	// Merge and write
	const merged = mergePluginHooks(existingSettings, pluginHooks);
	mkdirSync(dirname(CLAUDE_USER_SETTINGS_PATH), { recursive: true });
	writeFileSync(CLAUDE_USER_SETTINGS_PATH, JSON.stringify(merged, null, "\t"), "utf-8");

	return countHookEvents(pluginHooks);
};

const removeCaptureHooks = (): void => {
	if (!existsSync(CLAUDE_USER_SETTINGS_PATH)) return;

	const settings = asSettingsJson(readJsonFile(CLAUDE_USER_SETTINGS_PATH));
	if (!settingsHaveClensHooks(settings)) return;

	const cleaned = removeClensHooks(settings);
	writeFileSync(CLAUDE_USER_SETTINGS_PATH, JSON.stringify(cleaned, null, "\t"), "utf-8");
};

export const installPlugin = (installDir?: string): PluginInstallResult => {
	const srcDir = resolvePluginSrcDir();
	const targetDir = installDir ?? PLUGIN_INSTALL_DIR;
	const version = readPackageVersion();

	const files = collectFiles(srcDir, "");

	// Copy plugin files to install directory
	const copiedCount = files.reduce((count, relPath) => {
		const src = join(srcDir, relPath);
		const dest = join(targetDir, relPath);
		mkdirSync(join(dest, ".."), { recursive: true });
		copyFileSync(src, dest);
		return count + 1;
	}, 0);

	// Create symlinks from ~/.claude/ to installed plugin
	const symlinksCreated = createSymlinks(targetDir);

	// Install capture hooks into user-level settings
	const hooksInstalled = installCaptureHooks(targetDir);

	return {
		installed_to: targetDir,
		files_copied: copiedCount,
		symlinks_created: symlinksCreated,
		hooks_installed: hooksInstalled,
		version,
	};
};

export const uninstallPlugin = (installDir?: string): boolean => {
	const targetDir = installDir ?? PLUGIN_INSTALL_DIR;

	if (!existsSync(targetDir)) {
		return false;
	}

	// Remove capture hooks from user-level settings
	removeCaptureHooks();

	// Remove symlinks from ~/.claude/ first
	removeSymlinks(targetDir);

	// Remove plugin install directory
	rmSync(targetDir, { recursive: true });
	return true;
};

export const isPluginInstalled = (installDir?: string): boolean => {
	const targetDir = installDir ?? PLUGIN_INSTALL_DIR;
	if (!existsSync(targetDir)) return false;

	// Check that symlinks exist in ~/.claude/
	const symlinksOk = SYMLINK_DIRS.filter((subdir) => existsSync(join(targetDir, subdir))).every(
		(subdir) => {
			const srcSubdir = join(targetDir, subdir);
			const claudeSubdir = join(CLAUDE_USER_DIR, subdir);
			return collectTopLevelEntries(srcSubdir).every((entry) =>
				isSymlinkTo(join(claudeSubdir, entry), join(srcSubdir, entry)),
			);
		},
	);

	// Also check if capture hooks are present in user settings
	const hooksPresent = existsSync(CLAUDE_USER_SETTINGS_PATH)
		? settingsHaveClensHooks(asSettingsJson(readJsonFile(CLAUDE_USER_SETTINGS_PATH)))
		: false;

	return symlinksOk && hooksPresent;
};

export const getPluginDir = (): string => resolvePluginSrcDir();

export const validatePluginStructure = (): {
	readonly valid: boolean;
	readonly errors: readonly string[];
} => {
	const srcDir = resolvePluginSrcDir();

	const required = [
		".claude-plugin/plugin.json",
		"commands",
		"skills",
		"agents",
		"hooks/hooks.json",
	] as const;

	const errors = required.flatMap((entry): readonly string[] =>
		existsSync(join(srcDir, entry)) ? [] : [`Missing required: ${entry}`],
	);

	return {
		valid: errors.length === 0,
		errors,
	};
};


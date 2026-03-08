import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { type ClensConfig, type DelegatedHooks, HOOK_EVENTS } from "../types";
import type { Flags } from "./shared";
import { dim, green, red, yellow } from "./shared";

export type InitTarget = "local" | "global";

export interface InitResult {
	target: InitTarget;
	created: boolean;
	backed_up: boolean;
	delegated_hooks_count: number;
	warning?: string;
	tip?: string;
}

interface InitPaths {
	readonly settingsPath: string;
	readonly backupPath: string;
	readonly delegatedPath: string;
	readonly settingsDir: string;
	readonly backupDir: string;
}

export const resolveInitPaths = (projectDir: string, target: InitTarget): InitPaths => {
	const home = homedir();
	return target === "global"
		? {
				settingsPath: `${home}/.claude/settings.json`,
				backupPath: `${home}/.clens/settings.backup.json`,
				delegatedPath: `${home}/.clens/delegated-hooks.json`,
				settingsDir: `${home}/.claude`,
				backupDir: `${home}/.clens`,
			}
		: {
				settingsPath: `${projectDir}/.claude/settings.local.json`,
				backupPath: `${projectDir}/.clens/settings-local.backup.json`,
				delegatedPath: `${projectDir}/.clens/delegated-hooks.json`,
				settingsDir: `${projectDir}/.claude`,
				backupDir: `${projectDir}/.clens`,
			};
};

const isHooksMap = (value: unknown): value is HooksMap =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const readSettingsFile = (
	path: string,
): { settings: Record<string, unknown>; existingHooks: HooksMap } => {
	if (!existsSync(path)) return { settings: {}, existingHooks: {} };
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { settings: {}, existingHooks: {} };
		}
		const settings = parsed as Record<string, unknown>;
		const hooks = isHooksMap(settings.hooks) ? settings.hooks : {};
		return { settings, existingHooks: hooks };
	} catch {
		return { settings: {}, existingHooks: {} };
	}
};

const resolveHookCommand = (): string => {
	// Check if clens-hook is on PATH
	const which = Bun.spawnSync(["which", "clens-hook"], { stderr: "pipe" });
	if (which.exitCode === 0) {
		return which.stdout.toString().trim();
	}
	// Fallback: use bun run with absolute path to hook.ts
	const hookPath = new URL("./hook.ts", import.meta.url).pathname;
	return `bun run ${hookPath}`;
};

const HOOK_COMMAND = resolveHookCommand();

// Claude Code hooks format: { matcher?: string, hooks: [{ type, command }] }
// matcher is a regex string (e.g. "Bash", "Edit|Write"). Omit to match all.
interface MatcherHookEntry {
	matcher?: string;
	hooks: Array<{ type: string; command: string }>;
}

export type HooksMap = Record<string, MatcherHookEntry[]>;

const getCommandsFromEntry = (entry: MatcherHookEntry): string[] =>
	(entry.hooks ?? []).map((h) => h.command ?? "").filter(Boolean);

export const isAlreadyInitialized = (hooks: HooksMap): boolean =>
	Object.values(hooks).some(
		(eventEntries) =>
			Array.isArray(eventEntries) &&
			eventEntries.some((entry) =>
				getCommandsFromEntry(entry).some((cmd) => cmd.includes("clens") || cmd.includes("hook.ts")),
			),
	);

/** Check if .claude/settings.json (legacy location) has clens hooks. */
export const detectLegacyInstall = (projectDir: string): boolean => {
	const legacyPath = `${projectDir}/.claude/settings.json`;
	const { existingHooks } = readSettingsFile(legacyPath);
	return isAlreadyInitialized(existingHooks);
};

/** Count how many hook events contain clens commands in a settings file. */
const countClensHookEvents = (settingsPath: string): number => {
	const { existingHooks } = readSettingsFile(settingsPath);
	return Object.values(existingHooks).filter(
		(entries) =>
			Array.isArray(entries) &&
			entries.some((entry) =>
				getCommandsFromEntry(entry).some(
					(cmd) => cmd.includes("clens") || cmd.includes("hook.ts"),
				),
			),
	).length;
};

/** Remove clens hook entries from a settings file, preserving user hooks and other settings. */
const removeClensHooksFromFile = (settingsPath: string): void => {
	const { settings, existingHooks } = readSettingsFile(settingsPath);
	const cleanedHooks = Object.fromEntries(
		Object.entries(existingHooks)
			.map(([event, entries]) => [
				event,
				entries.filter(
					(entry) =>
						!getCommandsFromEntry(entry).some(
							(cmd) => cmd.includes("clens") || cmd.includes("hook.ts"),
						),
				),
			])
			.filter(([, entries]) => (entries as MatcherHookEntry[]).length > 0),
	);

	const newSettings =
		Object.keys(cleanedHooks).length > 0
			? { ...settings, hooks: cleanedHooks }
			: Object.fromEntries(
					Object.entries(settings).filter(([k]) => k !== "hooks"),
				);

	writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
};

const extractUserHooks = (
	existingHooks: HooksMap,
): { delegated: DelegatedHooks; count: number } => {
	const delegated: DelegatedHooks = Object.fromEntries(
		Object.entries(existingHooks)
			.filter(([, entries]) => Array.isArray(entries))
			.map(([eventType, entries]) => {
				const userCommands = (entries as MatcherHookEntry[]).flatMap((entry) =>
					getCommandsFromEntry(entry).filter(
						(cmd) => !cmd.includes("clens") && !cmd.includes("hook.ts"),
					),
				);
				return [eventType, userCommands] as const;
			})
			.filter(([, cmds]) => cmds.length > 0),
	);

	const count = Object.values(delegated).reduce((sum, cmds) => sum + cmds.length, 0);

	return { delegated, count };
};

const buildClensHooks = (): HooksMap =>
	Object.fromEntries(
		HOOK_EVENTS.map((eventType) => [
			eventType,
			[{ hooks: [{ type: "command", command: `${HOOK_COMMAND} ${eventType}` }] }],
		]),
	);

export const init = (projectDir: string, target: InitTarget = "local"): InitResult => {
	const paths = resolveInitPaths(projectDir, target);
	const projectClensDir = `${projectDir}/.clens`;
	const configPath = `${projectClensDir}/config.json`;

	// Create directory structure
	mkdirSync(`${projectClensDir}/sessions`, { recursive: true });
	mkdirSync(`${projectClensDir}/distilled`, { recursive: true });
	mkdirSync(paths.settingsDir, { recursive: true });
	mkdirSync(paths.backupDir, { recursive: true });

	// Read existing settings (or start empty)
	const { settings, existingHooks } = readSettingsFile(paths.settingsPath);

	// Idempotency check
	const alreadyInit = isAlreadyInitialized(existingHooks);

	// Backup existing settings
	writeFileSync(paths.backupPath, JSON.stringify(settings, null, 2));

	// Extract existing user hooks (exclude clens-hook entries)
	const { delegated, count: delegatedCount } = extractUserHooks(existingHooks);
	writeFileSync(paths.delegatedPath, JSON.stringify(delegated, null, 2));

	// Build new hooks config with clens-hook for ALL 17 events
	const newHooks = buildClensHooks();

	// Preserve all non-hooks settings (permissions, etc.)
	const newSettings = { ...settings, hooks: newHooks };
	writeFileSync(paths.settingsPath, JSON.stringify(newSettings, null, 2));

	// Create default config if it doesn't exist
	if (!existsSync(configPath)) {
		const config: ClensConfig = { capture: true };
		writeFileSync(configPath, JSON.stringify(config, null, 2));
	}

	// Detect legacy hooks when installing to local tier
	const legacyWarning =
		target === "local" && detectLegacyInstall(projectDir)
			? "Legacy hooks detected in .claude/settings.json. Run 'clens init --remove --legacy' to clean up."
			: undefined;

	const warnings = [
		"JSONL files will contain full hook payloads including tool inputs/outputs. Review .clens/sessions/ for sensitive data.",
		legacyWarning,
	].filter(Boolean);

	return {
		target,
		created: !alreadyInit,
		backed_up: true,
		delegated_hooks_count: delegatedCount,
		warning: warnings.join("\n  "),
		tip: "Install analysis tools with: clens plugin install",
	};
};

export interface UninitResult {
	readonly localRemoved: boolean;
	readonly globalRemoved: boolean;
	readonly legacyRemoved: boolean;
}

/** Remove clens hooks from a specific tier. Returns true if hooks were found and removed. */
const uninitTier = (projectDir: string, target: InitTarget): boolean => {
	const paths = resolveInitPaths(projectDir, target);
	const { existingHooks } = readSettingsFile(paths.settingsPath);

	if (!isAlreadyInitialized(existingHooks)) return false;

	// Restore from backup if exists, otherwise remove clens hooks surgically
	if (existsSync(paths.backupPath)) {
		const backup = readFileSync(paths.backupPath, "utf-8");
		writeFileSync(paths.settingsPath, backup);
	} else {
		removeClensHooksFromFile(paths.settingsPath);
	}

	// Clean up delegated hooks file
	if (existsSync(paths.delegatedPath)) {
		unlinkSync(paths.delegatedPath);
	}

	return true;
};

/** Remove legacy clens hooks from .claude/settings.json. Returns true if hooks were found and removed. */
const uninitLegacy = (projectDir: string): boolean => {
	const legacyPath = `${projectDir}/.claude/settings.json`;
	const { existingHooks } = readSettingsFile(legacyPath);

	if (!isAlreadyInitialized(existingHooks)) return false;

	// Check for old-style backup
	const oldBackupPath = `${projectDir}/.clens/settings.backup.json`;
	if (existsSync(oldBackupPath)) {
		const backup = readFileSync(oldBackupPath, "utf-8");
		writeFileSync(legacyPath, backup);
	} else {
		removeClensHooksFromFile(legacyPath);
	}

	return true;
};

/** Remove clens hooks from all active tiers. Legacy only removed if removeLegacy is true. */
export const uninitAll = (projectDir: string, removeLegacy: boolean): UninitResult => ({
	localRemoved: uninitTier(projectDir, "local"),
	globalRemoved: uninitTier(projectDir, "global"),
	legacyRemoved: removeLegacy ? uninitLegacy(projectDir) : false,
});

/** Single-tier uninit — kept for backward compat and direct tier targeting. */
export const uninit = (projectDir: string, target: InitTarget = "local"): void => {
	const paths = resolveInitPaths(projectDir, target);

	if (!existsSync(paths.backupPath)) {
		throw new Error(
			`No backup found at ${paths.backupPath}. Was clens init run with --${target === "global" ? "global" : "local"} target?`,
		);
	}

	const backup = readFileSync(paths.backupPath, "utf-8");
	writeFileSync(paths.settingsPath, backup);

	if (existsSync(paths.delegatedPath)) {
		unlinkSync(paths.delegatedPath);
	}
};

const renderInitResult = (result: InitResult): void => {
	const targetLabel = result.target === "global" ? " (global)" : " (local)";
	if (result.created) {
		console.log(green(`\u2713 clens initialized${targetLabel}`));
	} else {
		console.log(yellow(`\u2713 clens re-initialized${targetLabel} (was already active)`));
	}
	if (result.delegated_hooks_count > 0) {
		console.log(dim(`  ${result.delegated_hooks_count} existing hook(s) will be delegated`));
	}
	if (result.warning) {
		console.log(yellow(`  \u26a0 ${result.warning}`));
	}
	if (result.tip) {
		console.log(dim(`  Tip: ${result.tip}`));
	}
};

const renderUninit = (projectDir: string, removeLegacy: boolean): void => {
	const result = uninitAll(projectDir, removeLegacy);
	const removed = [
		result.localRemoved ? "local" : undefined,
		result.globalRemoved ? "global" : undefined,
		result.legacyRemoved ? "legacy" : undefined,
	].filter(Boolean);

	if (removed.length === 0) {
		console.log(yellow("No clens hooks found in any tier. Nothing to remove."));
		return;
	}

	console.log(green(`\u2713 clens removed from: ${removed.join(", ")}`));
	console.log(dim("  Session data preserved in .clens/sessions/"));
};

const handlePluginSubcommand = (projectDir: string, flags: Flags): void => {
	if (flags.remove) {
		const { uninstallPlugin } = require("./plugin") as typeof import("./plugin");
		const removed = uninstallPlugin();
		if (removed) {
			console.log(green("\u2713 Plugin uninstalled. Symlinks removed from ~/.claude/"));
		} else {
			console.log(yellow("No plugin installed. Nothing to remove."));
		}
		return;
	}

	if (flags.dev) {
		const { getPluginDir } = require("./plugin") as typeof import("./plugin");
		const pluginDir = getPluginDir();
		console.log("Development mode \u2014 symlink directly from source:");
		console.log(`  ln -sf ${pluginDir}/agents/session-analyst.md ~/.claude/agents/`);
		console.log(`  ln -sf ${pluginDir}/commands/*.md ~/.claude/commands/`);
		console.log(`  ln -sf ${pluginDir}/skills/session-analysis ~/.claude/skills/`);
		console.log("");
		console.log("Edit files in agentic/ and restart Claude Code to pick up changes.");
		return;
	}

	if (flags.status) {
		const { isPluginInstalled, validatePluginStructure } =
			require("./plugin") as typeof import("./plugin");
		const installed = isPluginInstalled();
		const validation = validatePluginStructure();
		console.log("Plugin status:");
		console.log(`  Installed: ${installed ? green("yes") : dim("no")}`);
		console.log(`  Source valid: ${validation.valid ? green("yes") : red("no")}`);
		if (!validation.valid) {
			validation.errors.map((e) => console.log(red(`    ${e}`)));
		}
		return;
	}

	// Default: install plugin
	const { installPlugin, validatePluginStructure } =
		require("./plugin") as typeof import("./plugin");
	const validation = validatePluginStructure();
	if (!validation.valid) {
		console.error(red("Plugin source invalid:"));
		validation.errors.map((e) => console.error(red(`  ${e}`)));
		process.exit(1);
	}
	const result = installPlugin();
	console.log(
		green(
			`\u2713 Plugin installed (${result.files_copied} files, ${result.symlinks_created} symlinks, ${result.hooks_installed} hook events)`,
		),
	);
	console.log(dim(`  Files: ${result.installed_to}`));
	console.log(dim(`  Symlinks: ~/.claude/{agents,commands,skills}/`));
	console.log(dim(`  Hooks: ~/.claude/settings.json (${result.hooks_installed} events)`));
	console.log("");
	console.log("Restart Claude Code to pick up the new agents, commands, and skills.");
};

const countFiles = (dir: string, ext?: string): number => {
	try {
		const entries = readdirSync(dir);
		return ext ? entries.filter((f) => f.endsWith(ext)).length : entries.length;
	} catch {
		return 0;
	}
};

const formatTierStatus = (label: string, count: number, path: string): string =>
	count > 0
		? `  ${label}${green(`installed (${path}, ${count} events)`)}`
		: `  ${label}${dim("not installed")}`;

const renderStatus = (projectDir: string): void => {
	const clensDir = `${projectDir}/.clens`;

	// Check each tier
	const localPath = `${projectDir}/.claude/settings.local.json`;
	const globalPath = `${homedir()}/.claude/settings.json`;
	const legacyPath = `${projectDir}/.claude/settings.json`;

	const localCount = countClensHookEvents(localPath);
	const globalCount = countClensHookEvents(globalPath);
	const legacyCount = countClensHookEvents(legacyPath);

	// Check plugin
	const { isPluginInstalled } = require("./plugin") as typeof import("./plugin");
	const pluginInstalled = isPluginInstalled();

	// Count data
	const sessionCount = countFiles(`${clensDir}/sessions`, ".jsonl");
	const distilledCount = countFiles(`${clensDir}/distilled`, ".json");

	// Count how many tiers have hooks installed
	const activeTiers = [localCount, globalCount].filter((c) => c > 0).length;

	console.log("clens status:");
	console.log(formatTierStatus("Local:    ", localCount, ".claude/settings.local.json"));
	console.log(formatTierStatus("Global:   ", globalCount, "~/.claude/settings.json"));
	console.log(`  Plugin:   ${pluginInstalled ? green("installed") : dim("not installed")}`);
	console.log(
		`  Legacy:   ${legacyCount > 0 ? yellow(`detected (${legacyCount} events in .claude/settings.json)`) : dim("none")}`,
	);
	console.log(`  Data:     ${sessionCount} sessions, ${distilledCount} distilled`);

	if (activeTiers > 1) {
		console.log(
			yellow(
				"\n  \u26a0 Hooks installed in multiple tiers. Events may fire multiple times per action.",
			),
		);
	}
	if (legacyCount > 0) {
		console.log(
			yellow("  \u26a0 Legacy hooks in .claude/settings.json. Run 'clens init --remove --legacy' to clean up."),
		);
	}
};

/** Enhanced init command handler with --remove, --status, --global, --legacy, and plugin subcommand routing. */
export const initCommand = (args: {
	readonly projectDir: string;
	readonly positional: readonly string[];
	readonly flags: Flags;
}): void => {
	const subcommand = args.positional[1];

	// Route: clens init plugin [--remove|--dev|--status]
	if (subcommand === "plugin") {
		handlePluginSubcommand(args.projectDir, args.flags);
		return;
	}

	// Route: clens init --remove [--legacy]
	if (args.flags.remove) {
		renderUninit(args.projectDir, args.flags.legacy);
		return;
	}

	// Route: clens init --status
	if (args.flags.status) {
		renderStatus(args.projectDir);
		return;
	}

	// Route: clens init [--global]
	const target: InitTarget = args.flags.global ? "global" : "local";
	const result = init(args.projectDir, target);
	renderInitResult(result);
};

/** @deprecated Use initCommand with flags instead. Kept for backward compat during migration. */
export const uninitCommand = (projectDir: string): void => {
	renderUninit(projectDir, false);
};

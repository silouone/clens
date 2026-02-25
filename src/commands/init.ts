import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { type ClensConfig, type DelegatedHooks, HOOK_EVENTS } from "../types";
import type { Flags } from "./shared";
import { dim, green, red, yellow } from "./shared";

export interface InitResult {
	created: boolean;
	backed_up: boolean;
	delegated_hooks_count: number;
	warning?: string;
	tip?: string;
}

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

type HooksMap = Record<string, MatcherHookEntry[]>;

const getCommandsFromEntry = (entry: MatcherHookEntry): string[] =>
	(entry.hooks ?? []).map((h) => h.command ?? "").filter(Boolean);

const isAlreadyInitialized = (hooks: HooksMap): boolean =>
	Object.values(hooks).some(
		(eventEntries) =>
			Array.isArray(eventEntries) &&
			eventEntries.some((entry) =>
				getCommandsFromEntry(entry).some((cmd) => cmd.includes("clens") || cmd.includes("hook.ts")),
			),
	);

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

export const init = (projectDir: string): InitResult => {
	const claudeDir = `${projectDir}/.claude`;
	const settingsPath = `${claudeDir}/settings.json`;
	const clensDir = `${projectDir}/.clens`;
	const backupPath = `${clensDir}/settings.backup.json`;
	const delegatedPath = `${clensDir}/delegated-hooks.json`;
	const configPath = `${clensDir}/config.json`;

	// Create directory structure
	mkdirSync(`${clensDir}/sessions`, { recursive: true });
	mkdirSync(`${clensDir}/distilled`, { recursive: true });
	mkdirSync(claudeDir, { recursive: true });

	// Read existing settings (or start empty)
	let settings: Record<string, unknown> = {};
	let existingHooks: HooksMap = {};

	if (existsSync(settingsPath)) {
		const raw = readFileSync(settingsPath, "utf-8");
		settings = JSON.parse(raw) as Record<string, unknown>;
		existingHooks = (settings.hooks as HooksMap) ?? {};
	}

	// Idempotency check
	const alreadyInit = isAlreadyInitialized(existingHooks);

	// Backup existing settings
	writeFileSync(backupPath, JSON.stringify(settings, null, 2));

	// Extract existing user hooks (exclude clens-hook entries)
	const { delegated, count: delegatedCount } = extractUserHooks(existingHooks);
	writeFileSync(delegatedPath, JSON.stringify(delegated, null, 2));

	// Build new hooks config with clens-hook for ALL 17 events
	const newHooks = buildClensHooks();

	// Preserve all non-hooks settings (permissions, etc.)
	const newSettings = { ...settings, hooks: newHooks };
	writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));

	// Create default config if it doesn't exist
	if (!existsSync(configPath)) {
		const config: ClensConfig = { capture: true };
		writeFileSync(configPath, JSON.stringify(config, null, 2));
	}

	return {
		created: !alreadyInit,
		backed_up: true,
		delegated_hooks_count: delegatedCount,
		warning:
			"JSONL files will contain full hook payloads including tool inputs/outputs. Review .clens/sessions/ for sensitive data.",
		tip: "Install analysis tools with: clens plugin install",
	};
};

export const uninit = (projectDir: string): void => {
	const settingsPath = `${projectDir}/.claude/settings.json`;
	const clensDir = `${projectDir}/.clens`;
	const backupPath = `${clensDir}/settings.backup.json`;
	const delegatedPath = `${clensDir}/delegated-hooks.json`;

	if (!existsSync(backupPath)) {
		throw new Error("No backup found at .clens/settings.backup.json. Was clens init run?");
	}

	// Restore settings from backup
	const backup = readFileSync(backupPath, "utf-8");
	writeFileSync(settingsPath, backup);

	// Remove delegated hooks file
	if (existsSync(delegatedPath)) {
		unlinkSync(delegatedPath);
	}

	// Keep .clens/sessions/ and .clens/distilled/ — user data preserved
};

const renderInitResult = (result: InitResult): void => {
	if (result.created) {
		console.log(green("\u2713 clens initialized"));
	} else {
		console.log(yellow("\u2713 clens re-initialized (was already active)"));
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

const renderUninit = (projectDir: string): void => {
	uninit(projectDir);
	console.log(green("\u2713 clens removed. Original settings restored."));
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
			`\u2713 Plugin installed (${result.files_copied} files, ${result.symlinks_created} symlinks)`,
		),
	);
	console.log(dim(`  Files: ${result.installed_to}`));
	console.log(dim(`  Symlinks: ~/.claude/{agents,commands,skills}/`));
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

const renderStatus = (projectDir: string): void => {
	const settingsPath = `${projectDir}/.claude/settings.json`;
	const clensDir = `${projectDir}/.clens`;

	// Check hooks
	const hooksInstalled = (() => {
		try {
			const raw = readFileSync(settingsPath, "utf-8");
			const settings = JSON.parse(raw) as Record<string, unknown>;
			const hooks = settings.hooks as Record<string, unknown> | undefined;
			if (!hooks) return 0;
			return Object.values(hooks).filter(
				(entries) =>
					Array.isArray(entries) &&
					entries.some((entry: unknown) => {
						const e = entry as { hooks?: Array<{ command?: string }> };
						return (e.hooks ?? []).some(
							(h) => (h.command ?? "").includes("clens") || (h.command ?? "").includes("hook.ts"),
						);
					}),
			).length;
		} catch {
			return 0;
		}
	})();

	// Check plugin
	const { isPluginInstalled } = require("./plugin") as typeof import("./plugin");
	const pluginInstalled = isPluginInstalled();

	// Count data
	const sessionCount = countFiles(`${clensDir}/sessions`, ".jsonl");
	const distilledCount = countFiles(`${clensDir}/distilled`, ".json");

	console.log("clens status:");
	console.log(
		`  Hooks:    ${hooksInstalled > 0 ? green(`installed (${hooksInstalled} events)`) : dim("not installed")}`,
	);
	console.log(`  Plugin:   ${pluginInstalled ? green("installed") : dim("not installed")}`);
	console.log(`  Data:     ${sessionCount} sessions, ${distilledCount} distilled`);
};

/** Enhanced init command handler with --remove, --status, and plugin subcommand routing. */
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

	// Route: clens init --remove
	if (args.flags.remove) {
		renderUninit(args.projectDir);
		return;
	}

	// Route: clens init --status
	if (args.flags.status) {
		renderStatus(args.projectDir);
		return;
	}

	// Default: clens init (install hooks)
	const result = init(args.projectDir);
	renderInitResult(result);
};

/** @deprecated Use initCommand with flags instead. Kept for backward compat during migration. */
export const uninitCommand = (projectDir: string): void => {
	renderUninit(projectDir);
};

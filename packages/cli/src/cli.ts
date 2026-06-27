#!/usr/bin/env bun
import type { Flags } from "./commands/shared";

const VERSION = "0.2.1";

type CommandContext = {
	readonly positional: readonly string[];
	readonly flags: Flags;
	readonly projectDir: string;
	readonly rawArgs: readonly string[];
};
type CommandDef = {
	readonly description: string;
	readonly handler: (ctx: CommandContext) => Promise<void>;
};

// --- report argument parsing ---

const REPORT_SUBCOMMANDS: ReadonlySet<string> = new Set(["backtracks", "drift", "reasoning"]);
// Subcommands that consume a trailing positional argument (e.g. `drift <spec-path>`).
const REPORT_SUBCOMMANDS_WITH_ARG: ReadonlySet<string> = new Set(["drift"]);

type ReportArgs = {
	readonly subcommand?: string;
	readonly subcommandArg?: string;
	readonly sessionInput?: string;
};

/**
 * Parse the positionals that follow the `report` command word into a subcommand,
 * an optional subcommand argument (e.g. the drift spec path), and the session-id
 * input. Order-independent: the subcommand may appear before OR after the session
 * id, and `--last` makes the session id implicit (so every remaining operand is an
 * argument candidate). Pure function — easy to unit-test in isolation.
 */
const parseReportArgs = (afterReport: readonly string[], last: boolean): ReportArgs => {
	const subIdx = afterReport.findIndex((a) => REPORT_SUBCOMMANDS.has(a));
	const subcommand = subIdx >= 0 ? afterReport[subIdx] : undefined;

	// Non-subcommand positionals, preserving their original order.
	const operands = afterReport.filter((a) => !REPORT_SUBCOMMANDS.has(a));
	// Without --last the first operand is the session id; with --last it is implicit.
	const sessionInput = last ? undefined : operands[0];
	const argOperands = last ? operands : operands.slice(1);
	const subcommandArg =
		subcommand && REPORT_SUBCOMMANDS_WITH_ARG.has(subcommand) ? argOperands[0] : undefined;

	return { subcommand, subcommandArg, sessionInput };
};

// --- 10 commands ---

const commands: Readonly<Record<string, CommandDef>> = {
	init: {
		description: "Initialize clens hooks (--remove, --status, plugin)",
		handler: async (ctx) => {
			const { initCommand } = await import("./commands/init");
			initCommand({ projectDir: ctx.projectDir, positional: ctx.positional, flags: ctx.flags });
		},
	},
	list: {
		description: "List captured sessions",
		handler: async (ctx) => {
			const { listCommand } = await import("./commands/list");
			await listCommand({ projectDir: ctx.projectDir, json: ctx.flags.json, global: ctx.flags.global });
		},
	},
	distill: {
		description: "Extract insights from session data",
		handler: async (ctx) => {
			const pricingTier = ctx.flags.pricing as import("./types").PricingTier | undefined;

			// --global: distill every session across all registered projects.
			if (ctx.flags.global) {
				const { distillAllGlobal } = await import("./commands/distill");
				await distillAllGlobal({
					deep: ctx.flags.deep,
					pricingTier,
					force: ctx.flags.force,
				});
				return;
			}

			// --all: distill every session in the current project dir.
			if (ctx.flags.all) {
				const { distillAllInDir } = await import("./commands/distill");
				await distillAllInDir({
					projectDir: ctx.projectDir,
					deep: ctx.flags.deep,
					pricingTier,
					force: ctx.flags.force,
				});
				return;
			}

			const { distillCommand } = await import("./commands/distill");
			const { resolveSessionId } = await import("./commands/shared");
			await distillCommand({
				sessionId: resolveSessionId(ctx.positional[1], ctx.flags.last, ctx.projectDir),
				projectDir: ctx.projectDir,
				deep: ctx.flags.deep,
				json: ctx.flags.json,
				pricingTier,
			});
		},
	},
	report: {
		description: "Show session report (backtracks, drift, reasoning)",
		handler: async (ctx) => {
			const { resolveSessionId } = await import("./commands/shared");
			const { reportCommand } = await import("./commands/report");

			// Subcommand + session id + subcommand arg, order-independent (see parseReportArgs).
			const { subcommand, subcommandArg, sessionInput } = parseReportArgs(
				ctx.positional.slice(1),
				ctx.flags.last,
			);

			// Extract --intent value
			const intentIdx = ctx.rawArgs.indexOf("--intent");
			const intent = intentIdx >= 0 && intentIdx + 1 < ctx.rawArgs.length
				? ctx.rawArgs[intentIdx + 1]
				: undefined;

			await reportCommand({
				sessionId: resolveSessionId(sessionInput, ctx.flags.last, ctx.projectDir),
				projectDir: ctx.projectDir,
				json: ctx.flags.json,
				subcommand,
				subcommandArg,
				detail: ctx.flags.detail,
				full: ctx.flags.full,
				intent,
			});
		},
	},
	agents: {
		description: "List agents, drill into one, or show comms",
		handler: async (ctx) => {
			const { resolveSessionId } = await import("./commands/shared");
			const { agentsCommand } = await import("./commands/agents");

			// Positionals after the `agents` command word. Without --last the first is
			// the session id and the second is the agent id; with --last the session is
			// implicit, so the first positional is the agent id. (--last is order-
			// independent because it is a flag, not a positional.)
			const afterAgents = ctx.positional.slice(1);
			const sessionInput = ctx.flags.last ? undefined : afterAgents[0];
			const agentId = ctx.flags.last ? afterAgents[0] : afterAgents[1];

			await agentsCommand({
				sessionId: resolveSessionId(sessionInput, ctx.flags.last, ctx.projectDir),
				projectDir: ctx.projectDir,
				json: ctx.flags.json,
				agentId,
				comms: ctx.flags.comms,
			});
		},
	},
	// D6 (resolved KEEP per DECISIONS.md #6 — NOT frozen): the TUI is kept as a
	// documented, low-maintenance differentiator. The web dashboard is the canonical
	// rich surface, so killed-command hints below route to BOTH `explore` and `web`.
	explore: {
		description: "Interactive TUI session explorer (or 'clens web' for the dashboard)",
		handler: async (ctx) => {
			const { startTui } = await import("./commands/tui");
			startTui(ctx.projectDir);
		},
	},
	clean: {
		description: "Remove session data",
		handler: async (ctx) => {
			const { cleanCommand } = await import("./commands/clean");
			await cleanCommand({
				sessionArg: ctx.positional[1],
				flags: ctx.flags,
				projectDir: ctx.projectDir,
			});
		},
	},
	export: {
		description: "Export session as archive",
		handler: async (ctx) => {
			const { resolveSessionId } = await import("./commands/shared");
			const { exportCommand } = await import("./commands/export");
			await exportCommand({
				sessionId: resolveSessionId(ctx.positional[1], ctx.flags.last, ctx.projectDir),
				projectDir: ctx.projectDir,
			});
		},
	},
	what: {
		description: "Quick session summary (request, outcome, cost, issues)",
		handler: async (ctx) => {
			const { whatCommand } = await import("./commands/what");

			if (ctx.flags.global && ctx.flags.last) {
				const { listGlobalSessions, resolveProjectForSession } = await import("./session/global-read");
				const sessions = listGlobalSessions();
				if (sessions.length === 0) throw new Error("No sessions found across registered projects.");
				const sessionId = sessions[0].session_id;
				const project = resolveProjectForSession(sessionId);
				const projectDir = project ? project.path : ctx.projectDir;
				await whatCommand({
					sessionId,
					projectDir,
					json: ctx.flags.json,
					pricingTier: ctx.flags.pricing as import("./types").PricingTier | undefined,
				});
				return;
			}

			const { resolveSessionId } = await import("./commands/shared");
			await whatCommand({
				sessionId: resolveSessionId(ctx.positional[1], ctx.flags.last, ctx.projectDir),
				projectDir: ctx.projectDir,
				json: ctx.flags.json,
				pricingTier: ctx.flags.pricing as import("./types").PricingTier | undefined,
			});
		},
	},
	name: {
		description: "Set/clear a session's label and color (no args prints current)",
		handler: async (ctx) => {
			const { nameCommand } = await import("./commands/name");
			const colorIdx = ctx.rawArgs.indexOf("--color");
			const color = colorIdx >= 0 && colorIdx + 1 < ctx.rawArgs.length
				? ctx.rawArgs[colorIdx + 1]
				: undefined;
			nameCommand({
				sessionArg: ctx.positional[1],
				projectDir: ctx.projectDir,
				label: ctx.positional[2],
				color,
				clear: ctx.rawArgs.includes("--clear"),
				json: ctx.flags.json,
			});
		},
	},
	config: {
		description: "View or update clens configuration",
		handler: async (ctx) => {
			const { configCommand } = await import("./commands/config");
			const gmIdx = ctx.rawArgs.indexOf("--global-mode");
			const globalMode = gmIdx >= 0 && gmIdx + 1 < ctx.rawArgs.length
				? ctx.rawArgs[gmIdx + 1]
				: undefined;
			configCommand({
				projectDir: ctx.projectDir,
				pricing: ctx.flags.pricing,
				globalMode,
				json: ctx.flags.json,
			});
		},
	},
	web: {
		description: "Launch web dashboard",
		handler: async (ctx) => {
			const { webCommand } = await import("./commands/web");
			const portIdx = ctx.rawArgs.indexOf("--port");
			const port = portIdx >= 0 && portIdx + 1 < ctx.rawArgs.length
				? parseInt(ctx.rawArgs[portIdx + 1], 10)
				: 3700;
			await webCommand({
				projectDir: ctx.projectDir,
				port,
				open: !ctx.rawArgs.includes("--no-open"),
				global: ctx.flags.global,
			});
		},
	},
};

// --- Killed command suggestions ---

const KILLED_COMMANDS: Readonly<Record<string, string>> = {
	uninit: "Did you mean 'clens init --remove'?",
	plugin: "Did you mean 'clens init plugin'?",
	stats: "Did you mean 'clens report'?",
	backtracks: "Did you mean 'clens report backtracks'?",
	backtrack: "Did you mean 'clens report backtracks'?",
	decisions: "decisions is available in: clens explore | clens web",
	decision: "decisions is available in: clens explore | clens web",
	reasoning: "Did you mean 'clens report reasoning'?",
	edits: "edits is available in: clens explore | clens web",
	edit: "edits is available in: clens explore | clens web",
	drift: "Did you mean 'clens report drift'?",
	timeline: "timeline is available in: clens explore | clens web",
	tree: "Did you mean 'clens agents'?",
	agent: "Did you mean 'clens agents <id>'?",
	messages: "Did you mean 'clens agents --comms'?",
	message: "Did you mean 'clens agents --comms'?",
	graph: "graph is available in: clens explore | clens web",
	journey: "journey is available in: clens explore | clens web",
};

// --- Flag validation ---

const GLOBAL_FLAGS = new Set(["--help", "-h", "--version", "-v"]);

const VALID_FLAGS_BY_COMMAND: Readonly<Record<string, ReadonlySet<string>>> = {
	init: new Set(["--remove", "--status", "--dev", "--global", "--legacy"]),
	list: new Set(["--json", "--global"]),
	distill: new Set(["--last", "--all", "--global", "--force", "--deep", "--json", "--pricing"]),
	report: new Set(["--last", "--json", "--detail", "--full", "--intent"]),
	agents: new Set(["--last", "--json", "--comms"]),
	name: new Set(["--color", "--clear", "--json"]),
	config: new Set(["--pricing", "--json", "--global-mode"]),
	explore: new Set([]),
	clean: new Set(["--last", "--all", "--force", "--yes"]),
	export: new Set(["--last"]),
	what: new Set(["--last", "--json", "--pricing", "--global"]),
	web: new Set(["--port", "--no-open", "--global"]),
};

/** Find which command a flag belongs to, for suggestion messages. */
const findFlagOwner = (flag: string): string | undefined =>
	Object.entries(VALID_FLAGS_BY_COMMAND)
		.find(([, validSet]) => validSet.has(flag))
		?.[0];

/** Validate that all --flags in argv are valid for the resolved command. Returns error message or undefined. */
const validateFlags = (cmd: string, rawArgs: readonly string[]): string | undefined => {
	const validSet = VALID_FLAGS_BY_COMMAND[cmd];
	if (!validSet) return undefined;

	const flagArgs = rawArgs.filter((a) => a.startsWith("--") || (a.startsWith("-") && a.length === 2));
	// Skip values after --intent and --port (they're not flags)
	const VALUE_FLAGS = new Set(["--intent", "--port", "--pricing", "--global-mode", "--color"]);
	const actualFlags = flagArgs.reduce<readonly string[]>((acc, arg, i) => {
		if (i > 0 && VALUE_FLAGS.has(rawArgs[rawArgs.indexOf(arg) - 1])) return acc;
		return [...acc, arg];
	}, []);

	const invalid = actualFlags.filter((f) => !validSet.has(f) && !GLOBAL_FLAGS.has(f));
	if (invalid.length === 0) return undefined;

	const flag = invalid[0];
	const owner = findFlagOwner(flag);
	return owner
		? `Unknown flag ${flag} for '${cmd}'. Did you mean 'clens ${owner} ${flag}'?`
		: `Unknown flag ${flag} for '${cmd}'. Run 'clens ${cmd} --help' for valid options.`;
};

// --- Help text ---

const printHelp = (): void => {
	const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
	const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
	const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

	console.log(`${bold("clens")} v${VERSION}

${bold("Usage:")} clens <command> [session-id] [options]

${bold("Setup:")}
  ${cyan("init")}              Initialize clens hooks (local, per-project)
  ${cyan("init --global")}     Initialize clens hooks (global, all projects)
  ${cyan("init --remove")}     Remove hooks from all active tiers
  ${cyan("init --remove --legacy")}  Also remove legacy hooks from .claude/settings.json
  ${cyan("init --status")}     Show hook installation status across all tiers
  ${cyan("init plugin")}       Install/uninstall analysis plugin

${bold("Sessions:")}
  ${cyan("list")}              List captured sessions
  ${cyan("list --global")}     List sessions across all registered projects
  ${cyan("name")}              Set/clear a session's label & color flag
  ${cyan("distill")}           Extract insights from session data
  ${cyan("distill --global")}  Distill every session across all registered projects
  ${cyan("clean <id>")}        Remove one session's data (or --last)
  ${cyan("clean --all")}       Remove every session in this project (prompts; --yes to skip)
  ${cyan("export")}            Export session as archive
  ${cyan("config")}            View or update configuration
  ${cyan("config --global-mode <m>")}  Set global mode: repository or project

${bold("Analysis:")}
  ${cyan("what")}              Quick summary: request, outcome, cost, issues
  ${cyan("report")}            Session summary (default view)
  ${cyan("report backtracks")} Backtrack analysis
  ${cyan("report drift")}      Plan drift analysis
  ${cyan("report reasoning")}  Reasoning analysis
  ${cyan("agents")}            Agent tree and workload
  ${cyan("agents <id>")}       Drill into specific agent
  ${cyan("agents --comms")}    Communication timeline
  ${cyan("explore")}           Interactive TUI session explorer
  ${cyan("web")}               Launch web dashboard

${bold("Options:")}
  ${dim("--last")}         Use most recent session
  ${dim("--force")}        Force operation (skip safety checks)
  ${dim("--yes, -y")}      Skip confirmation prompt (required for 'clean --all' when non-interactive)
  ${dim("--deep")}         Deep distill: add git enrichment (commit history, unified diffs); spawns git
  ${dim("--json")}         Output structured JSON
  ${dim("--detail")}       Show detailed backtrack breakdown
  ${dim("--full")}         Show full reasoning text
  ${dim("--intent")}       Filter by reasoning intent type
  ${dim("--all")}          Distill all sessions
  ${dim("--comms")}        Show communication timeline
  ${dim("--global")}       Global mode: operate across all registered projects
  ${dim("--global-mode <m>")} Set discovery mode: repository (git root) or project (each .clens/)
  ${dim("--legacy")}       Include legacy hooks in --remove
  ${dim("--port <n>")}     Web dashboard port (default 3700)
  ${dim("--no-open")}      Don't open browser automatically
  ${dim("--pricing <t>")} Pricing tier: api, max, or auto
  ${dim("--color <c>")}   Session color flag: none, red, amber, green, blue, violet, gray
  ${dim("--clear")}       Clear a session's label and color
  ${dim("--version")}      Show version
  ${dim("--help")}         Show help

${bold("Examples:")}
  clens init                          # Set up hooks (local)
  clens init --global                 # Set up hooks (global)
  clens list                          # See all sessions
  clens name a288 "Auth refactor" --color amber  # Label + flag a session
  clens name a288 --clear             # Revert to computed name, unflag
  clens distill --last                # Distill latest session
  clens distill --global              # distill all sessions in every repo
  clens report --last                 # Summary of latest session
  clens report --last backtracks      # Backtrack analysis
  clens report --last drift specs/p.md  # Drift against spec
  clens agents --last                 # Agent tree
  clens explore                       # Interactive explorer
  clens web                           # Launch web dashboard
  clens web --port 8080 --no-open     # Custom port, no browser
  clens config                        # View current config
  clens config --pricing max          # Set pricing tier to max
  clens distill --last --pricing max  # Distill with max tier pricing`);
};

// --- Main ---

const args = Bun.argv.slice(2);

const pricingIdx = args.indexOf("--pricing");
const pricingValue = pricingIdx >= 0 && pricingIdx + 1 < args.length ? args[pricingIdx + 1] : undefined;

const flags: Flags = {
	last: args.includes("--last"),
	force: args.includes("--force"),
	yes: args.includes("--yes") || args.includes("-y"),
	deep: args.includes("--deep"),
	json: args.includes("--json"),
	help: args.includes("--help") || args.includes("-h"),
	version: args.includes("--version") || args.includes("-v"),
	detail: args.includes("--detail"),
	full: args.includes("--full"),
	all: args.includes("--all"),
	remove: args.includes("--remove"),
	status: args.includes("--status"),
	dev: args.includes("--dev"),
	comms: args.includes("--comms"),
	global: args.includes("--global"),
	legacy: args.includes("--legacy"),
	...(pricingValue ? { pricing: pricingValue } : {}),
};

// Exclude values that follow value-bearing flags (--intent, --port, --pricing)
const VALUE_FLAG_SET = new Set(["--intent", "--port", "--pricing", "--color"]);
const positional = args.filter((a, i) => {
	if (a.startsWith("--") || a.startsWith("-")) return false;
	if (i > 0 && VALUE_FLAG_SET.has(args[i - 1])) return false;
	return true;
});
const command = positional[0];

const main = async () => {
	if (flags.version) {
		console.log(VERSION);
		return;
	}

	if (flags.help || !command) {
		printHelp();
		return;
	}

	const projectDir = process.cwd();
	const def = commands[command];

	if (!def) {
		const suggestion = KILLED_COMMANDS[command];
		if (suggestion) {
			console.error(`\x1b[33m'${command}' was removed in v0.2.0. ${suggestion}\x1b[0m`);
		} else {
			console.error(`\x1b[31mUnknown command: ${command}\x1b[0m`);
			console.error("Run 'clens --help' for usage.");
		}
		process.exit(1);
	}

	const flagError = validateFlags(command, args);
	if (flagError) {
		console.error(`\x1b[31mError: ${flagError}\x1b[0m`);
		process.exit(1);
	}

	try {
		await def.handler({ positional, flags, projectDir, rawArgs: args });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`\x1b[31mError: ${msg}\x1b[0m`);
		process.exit(1);
	}
};

main();

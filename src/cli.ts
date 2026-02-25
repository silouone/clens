#!/usr/bin/env bun
import type { Flags } from "./commands/shared";

const VERSION = "0.2.0";

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

// --- 8 commands ---

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
			await listCommand({ projectDir: ctx.projectDir, json: ctx.flags.json });
		},
	},
	distill: {
		description: "Extract insights from session data",
		handler: async (ctx) => {
			const { distillCommand } = await import("./commands/distill");

			if (ctx.flags.all) {
				const { listSessions } = await import("./session/read");
				const sessions = listSessions(ctx.projectDir);
				if (sessions.length === 0) {
					console.log("No sessions found.");
					return;
				}
				console.log(`Distilling ${sessions.length} session(s)...`);
				const results = await sessions.reduce<Promise<readonly string[]>>(
					async (accP, session, idx) => {
						const acc = await accP;
						const progress = `[${idx + 1}/${sessions.length}]`;
						console.log(`${progress} ${session.session_id.slice(0, 8)}...`);
						try {
							await distillCommand({
								sessionId: session.session_id,
								projectDir: ctx.projectDir,
								deep: ctx.flags.deep,
								json: false,
							});
							return [...acc, session.session_id];
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							console.error(`  Error: ${msg}`);
							return acc;
						}
					},
					Promise.resolve([]),
				);
				console.log(`\nDistilled ${results.length}/${sessions.length} session(s).`);
				return;
			}

			const { resolveSessionId } = await import("./commands/shared");
			await distillCommand({
				sessionId: resolveSessionId(ctx.positional[1], ctx.flags.last, ctx.projectDir),
				projectDir: ctx.projectDir,
				deep: ctx.flags.deep,
				json: ctx.flags.json,
			});
		},
	},
	report: {
		description: "Show session report (backtracks, drift, reasoning)",
		handler: async (ctx) => {
			const { resolveSessionId } = await import("./commands/shared");
			const { reportCommand } = await import("./commands/report");

			// Detect subcommand: first positional after "report" that isn't a session ID
			const subcommands = new Set(["backtracks", "drift", "reasoning"]);
			const afterReport = ctx.positional.slice(1);
			const subIdx = afterReport.findIndex((a) => subcommands.has(a));
			const subcommand = subIdx >= 0 ? afterReport[subIdx] : undefined;

			// Session ID: positional that isn't the subcommand
			const sessionPositional = afterReport.filter((a) => !subcommands.has(a))[0];

			// Subcommand arg (e.g. spec path for drift): positional after the subcommand
			const subcommandArg = subcommand && subIdx + 1 < afterReport.length
				? afterReport.filter((a) => !subcommands.has(a) && a !== sessionPositional)[0]
				: undefined;

			// Extract --intent value
			const intentIdx = ctx.rawArgs.indexOf("--intent");
			const intent = intentIdx >= 0 && intentIdx + 1 < ctx.rawArgs.length
				? ctx.rawArgs[intentIdx + 1]
				: undefined;

			await reportCommand({
				sessionId: resolveSessionId(sessionPositional, ctx.flags.last, ctx.projectDir),
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
			const agentId = ctx.flags.last ? ctx.positional[1] : ctx.positional[2];
			await agentsCommand({
				sessionId: resolveSessionId(
					ctx.flags.last ? undefined : ctx.positional[1],
					ctx.flags.last,
					ctx.projectDir,
				),
				projectDir: ctx.projectDir,
				json: ctx.flags.json,
				agentId,
				comms: ctx.flags.comms,
			});
		},
	},
	explore: {
		description: "Interactive TUI session explorer",
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
				otel: ctx.flags.otel,
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
	decisions: "decisions is available in: clens explore",
	decision: "decisions is available in: clens explore",
	reasoning: "Did you mean 'clens report reasoning'?",
	edits: "edits is available in: clens explore",
	edit: "edits is available in: clens explore",
	drift: "Did you mean 'clens report drift'?",
	timeline: "timeline is available in: clens explore",
	tree: "Did you mean 'clens agents'?",
	agent: "Did you mean 'clens agents <id>'?",
	messages: "Did you mean 'clens agents --comms'?",
	message: "Did you mean 'clens agents --comms'?",
	graph: "graph is available in: clens explore",
	journey: "journey is available in: clens explore",
};

// --- Flag validation ---

const GLOBAL_FLAGS = new Set(["--help", "-h", "--version", "-v"]);

const VALID_FLAGS_BY_COMMAND: Readonly<Record<string, ReadonlySet<string>>> = {
	init: new Set(["--remove", "--status", "--dev"]),
	list: new Set(["--json"]),
	distill: new Set(["--last", "--all", "--deep", "--json"]),
	report: new Set(["--last", "--json", "--detail", "--full", "--intent"]),
	agents: new Set(["--last", "--json", "--comms"]),
	explore: new Set([]),
	clean: new Set(["--last", "--all", "--force"]),
	export: new Set(["--last", "--otel"]),
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
	// Skip the value after --intent (it's not a flag)
	const actualFlags = flagArgs.reduce<readonly string[]>((acc, arg, i) => {
		if (i > 0 && rawArgs[rawArgs.indexOf(arg) - 1] === "--intent") return acc;
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
  ${cyan("init")}              Initialize clens hooks
  ${cyan("init --remove")}     Remove hooks and restore settings
  ${cyan("init --status")}     Show hook installation status
  ${cyan("init plugin")}       Install/uninstall analysis plugin

${bold("Sessions:")}
  ${cyan("list")}              List captured sessions
  ${cyan("distill")}           Extract insights from session data
  ${cyan("clean")}             Remove session data
  ${cyan("export")}            Export session as archive

${bold("Analysis:")}
  ${cyan("report")}            Session summary (default view)
  ${cyan("report backtracks")} Backtrack analysis
  ${cyan("report drift")}      Plan drift analysis
  ${cyan("report reasoning")}  Reasoning analysis
  ${cyan("agents")}            Agent tree and workload
  ${cyan("agents <id>")}       Drill into specific agent
  ${cyan("agents --comms")}    Communication timeline
  ${cyan("explore")}           Interactive TUI session explorer

${bold("Options:")}
  ${dim("--last")}         Use most recent session
  ${dim("--force")}        Force operation (skip safety checks)
  ${dim("--deep")}         Deep distill: enrich agents with transcript data
  ${dim("--json")}         Output structured JSON
  ${dim("--otel")}         Export in OTLP format
  ${dim("--detail")}       Show detailed backtrack breakdown
  ${dim("--full")}         Show full reasoning text
  ${dim("--intent")}       Filter by reasoning intent type
  ${dim("--all")}          Distill all sessions
  ${dim("--comms")}        Show communication timeline
  ${dim("--version")}      Show version
  ${dim("--help")}         Show help

${bold("Examples:")}
  clens init                          # Set up hooks
  clens list                          # See all sessions
  clens distill --last                # Distill latest session
  clens report --last                 # Summary of latest session
  clens report --last backtracks      # Backtrack analysis
  clens report --last drift specs/p.md  # Drift against spec
  clens agents --last                 # Agent tree
  clens explore                       # Interactive explorer`);
};

// --- Main ---

const args = Bun.argv.slice(2);

const flags: Flags = {
	last: args.includes("--last"),
	force: args.includes("--force"),
	otel: args.includes("--otel"),
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
};

const positional = args.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
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

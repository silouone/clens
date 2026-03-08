// ── Log levels ──────────────────────────────────────────────────────

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const
type LogLevel = keyof typeof LOG_LEVELS

// ── Configuration ───────────────────────────────────────────────────

const parseLevel = (raw: string | undefined): LogLevel => {
	const normalized = (raw ?? "info").toLowerCase()
	return normalized in LOG_LEVELS ? (normalized as LogLevel) : "info"
}

const currentLevel = parseLevel(process.env.CLENS_LOG_LEVEL)

// ── Formatting ──────────────────────────────────────────────────────

const timestamp = (): string => {
	const d = new Date()
	return `${d.toISOString().slice(11, 23)}`
}

const LEVEL_LABELS: Readonly<Record<LogLevel, string>> = {
	debug: "\x1b[90mDBG\x1b[0m",
	info: "\x1b[36mINF\x1b[0m",
	warn: "\x1b[33mWRN\x1b[0m",
	error: "\x1b[31mERR\x1b[0m",
	silent: "",
}

const formatTag = (tag: string): string => `\x1b[90m[${tag}]\x1b[0m`

// ── Logger factory ──────────────────────────────────────────────────

type Logger = {
	readonly debug: (msg: string, ...args: readonly unknown[]) => void
	readonly info: (msg: string, ...args: readonly unknown[]) => void
	readonly warn: (msg: string, ...args: readonly unknown[]) => void
	readonly error: (msg: string, ...args: readonly unknown[]) => void
	readonly child: (childTag: string) => Logger
}

const createLogger = (tag: string): Logger => {
	const emit = (level: LogLevel, msg: string, args: readonly unknown[]): void => {
		if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return
		const prefix = `${timestamp()} ${LEVEL_LABELS[level]} ${formatTag(tag)}`
		const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log
		if (args.length > 0) {
			fn(prefix, msg, ...args)
		} else {
			fn(prefix, msg)
		}
	}

	return {
		debug: (msg, ...args) => emit("debug", msg, args),
		info: (msg, ...args) => emit("info", msg, args),
		warn: (msg, ...args) => emit("warn", msg, args),
		error: (msg, ...args) => emit("error", msg, args),
		child: (childTag) => createLogger(`${tag}:${childTag}`),
	}
}

// ── Pre-built loggers ───────────────────────────────────────────────

const log = createLogger("clens")

export { createLogger, log, currentLevel }
export type { Logger, LogLevel }

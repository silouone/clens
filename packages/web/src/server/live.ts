import { watch, existsSync, mkdirSync, openSync, readSync, fstatSync, closeSync, readdirSync } from "node:fs"
import type { FSWatcher } from "node:fs"
import { broadcastSSE } from "./routes/events"
import { invalidateCache } from "./cache"
import { createLogger } from "./logger"

const log = createLogger("live")

// ── Types ──────────────────────────────────────────────────────────

type FileOffset = {
	offset: number
}

type LiveWatcherHandle = {
	readonly stop: () => void
}

// ── Per-file byte offset tracking (mutable at I/O boundary) ───────

const offsets = new Map<string, FileOffset>()

// ── Read new lines from a file starting at tracked offset ─────────

const readNewLines = (filePath: string): readonly string[] => {
	const entry = offsets.get(filePath) ?? { offset: 0 }
	const fd = openSync(filePath, "r")
	try {
		const stat = fstatSync(fd)
		const newBytes = stat.size - entry.offset
		if (newBytes <= 0) return []

		const buffer = Buffer.alloc(newBytes)
		readSync(fd, buffer, 0, newBytes, entry.offset)

		const text = buffer.toString("utf-8")
		// Only process complete lines (ending with \n)
		const lastNewline = text.lastIndexOf("\n")
		if (lastNewline === -1) return []

		const completeText = text.slice(0, lastNewline + 1)
		entry.offset += Buffer.byteLength(completeText, "utf-8")
		offsets.set(filePath, entry)

		return completeText.split("\n").filter(Boolean)
	} finally {
		closeSync(fd)
	}
}

// ── Debounce helper ────────────────────────────────────────────────

const debounce = (fn: () => void, ms: number): (() => void) => {
	let timer: ReturnType<typeof setTimeout> | undefined
	return () => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(fn, ms)
	}
}

// ── File watcher setup ─────────────────────────────────────────────

const DEBOUNCE_MS = 100

const startLiveWatcher = (projectDir: string): LiveWatcherHandle => {
	const sessionsDir = `${projectDir}/.clens/sessions`
	const distilledDir = `${projectDir}/.clens/distilled`
	const refs = {
		watchers: [] as FSWatcher[],
		pollTimers: [] as ReturnType<typeof setInterval>[],
	}
	const usePoll = process.env.CLENS_POLL === "1"

	// Ensure directories exist
	const ensureDir = (dir: string): void => {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
	}
	ensureDir(sessionsDir)
	ensureDir(distilledDir)

	// ── Seed offsets so only NEW data triggers events (skip existing content) ──
	try {
		const sessionEntries = readdirSync(sessionsDir)
			.filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl")
			.map((file) => {
				const filePath = `${sessionsDir}/${file}`
				const fd = openSync(filePath, "r")
				const size = fstatSync(fd).size
				closeSync(fd)
				return [filePath, { offset: size }] as const
			})
		for (const [k, v] of sessionEntries) offsets.set(k, v)
		log.info(`Seeded offsets for ${offsets.size} session files`)
	} catch (err) {
		log.warn("Failed to seed session offsets:", err instanceof Error ? err.message : String(err))
	}

	try {
		const distillEntries = readdirSync(distilledDir)
			.filter((f) => f.endsWith(".json"))
			.map((file) => {
				const filePath = `${distilledDir}/${file}`
				const fd = openSync(filePath, "r")
				const size = fstatSync(fd).size
				closeSync(fd)
				return [filePath, { offset: size }] as const
			})
		for (const [k, v] of distillEntries) offsets.set(k, v)
	} catch {
		// distilled dir may be empty — that's fine
	}

	// ── Sessions watcher: new/changed JSONL files ──

	const handleSessionChange = debounce(() => {
		// Scan for changed files by checking all .jsonl files
		try {
			const files = readdirSync(sessionsDir)
			files
				.filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl")
				.map((file) => {
					const filePath = `${sessionsDir}/${file}`
					const newLines = readNewLines(filePath)
					if (newLines.length === 0) return

					const sessionId = file.replace(".jsonl", "")
					invalidateCache(sessionId)

					// Parse and broadcast each new event
					log.debug(`New lines: ${newLines.length} for ${sessionId.slice(0, 8)}`)
					newLines.map((line) => {
						try {
							const event = JSON.parse(line)
							broadcastSSE({
								type: "live_event",
								data: { session_id: sessionId, event },
							})
						} catch (err) {
							log.warn(`Malformed JSONL line in ${sessionId.slice(0, 8)}:`, err instanceof Error ? err.message : String(err))
						}
					})

					// Notify of session update
					broadcastSSE({
						type: "session_update",
						data: { session_id: sessionId, new_events: newLines.length },
					})
				})
		} catch (err) {
			log.warn("Session scan error:", err instanceof Error ? err.message : String(err))
		}
	}, DEBOUNCE_MS)

	// ── Distilled watcher: external distill completions ──

	const handleDistillChange = debounce(() => {
		try {
			const files = readdirSync(distilledDir)
			files
				.filter((f) => f.endsWith(".json"))
				.map((file) => {
					const filePath = `${distilledDir}/${file}`
					const entry = offsets.get(filePath)
					// Only broadcast if we haven't seen this file before or it changed
					const fd = openSync(filePath, "r")
					const size = fstatSync(fd).size
					closeSync(fd)

					if (!entry || entry.offset !== size) {
						offsets.set(filePath, { offset: size })
						const sessionId = file.replace(".json", "")
						broadcastSSE({
							type: "distill_complete",
							data: { session_id: sessionId },
						})
					}
				})
		} catch (err) {
			log.warn("Distilled scan error:", err instanceof Error ? err.message : String(err))
		}
	}, DEBOUNCE_MS)

	// ── Start watching ──

	if (usePoll) {
		log.info("Using polling mode (CLENS_POLL=1)")
		const POLL_MS = 1000
		refs.pollTimers = [...refs.pollTimers, setInterval(handleSessionChange, POLL_MS)]
		refs.pollTimers = [...refs.pollTimers, setInterval(handleDistillChange, POLL_MS)]
	} else {
		try {
			refs.watchers = [...refs.watchers, watch(sessionsDir, { recursive: false }, handleSessionChange)]
			log.info(`Watching sessions: ${sessionsDir}`)
		} catch (err) {
			log.warn(`fs.watch failed for sessions, falling back to polling:`, err instanceof Error ? err.message : String(err))
			refs.pollTimers = [...refs.pollTimers, setInterval(handleSessionChange, 1000)]
		}
		try {
			refs.watchers = [...refs.watchers, watch(distilledDir, { recursive: false }, handleDistillChange)]
			log.info(`Watching distilled: ${distilledDir}`)
		} catch (err) {
			log.warn(`fs.watch failed for distilled, falling back to polling:`, err instanceof Error ? err.message : String(err))
			refs.pollTimers = [...refs.pollTimers, setInterval(handleDistillChange, 1000)]
		}
	}

	return {
		stop: () => {
			refs.watchers.forEach((w) => w.close())
			refs.pollTimers.forEach((t) => clearInterval(t))
			refs.watchers = []
			refs.pollTimers = []
		},
	}
}

export { startLiveWatcher, readNewLines }
export type { LiveWatcherHandle }

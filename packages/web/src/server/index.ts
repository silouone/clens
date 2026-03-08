import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createApp } from "./app"
import { startLiveWatcher } from "./live"
import { log, currentLevel } from "./logger"

// ── Server options ─────────────────────────────────────────────────

type StartServerOptions = {
	readonly projectDir: string
	readonly port?: number
	readonly token?: string
}

type ServerHandle = {
	readonly url: string
	readonly port: number
	readonly token: string
	readonly stop: () => void
}

// ── Token generation ───────────────────────────────────────────────

const generateToken = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(32))
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

// ── Bootstrap ──────────────────────────────────────────────────────

/**
 * Start the cLens web server.
 * Binds to 127.0.0.1 only (local access).
 * Generates a random auth token printed to stdout for the CLI to capture.
 */
const startServer = (options: StartServerOptions): ServerHandle => {
	const port = options.port ?? 3117
	const token = options.token ?? generateToken()
	const mode = process.env.NODE_ENV === "production" ? "production" as const : "development" as const

	log.info(`Starting server mode=${mode} logLevel=${currentLevel}`)
	const app = createApp({ token, mode, projectDir: options.projectDir })

	const server = Bun.serve({
		port,
		hostname: "127.0.0.1",
		idleTimeout: 255, // max value (seconds) — prevents SSE connections from being killed
		fetch: app.fetch,
	})

	const actualPort = server.port ?? port
	const url = `http://127.0.0.1:${actualPort}`

	log.info(`Server bound to ${url}`)
	log.info(`Project dir: ${options.projectDir}`)

	// Start file watcher for live SSE push
	const watcher = startLiveWatcher(options.projectDir)

	return {
		url,
		port: actualPort,
		token,
		stop: () => {
			watcher.stop()
			server.stop(true)
		},
	}
}

export { startServer, generateToken, findProjectDir }
export type { StartServerOptions, ServerHandle }
export type { AppType } from "./app"

// ── Project dir resolution ─────────────────────────────────────────

/**
 * Walk up from `start` to find the git root (contains `.git/`).
 * This is the project root where `.clens/` data lives.
 * Falls back to nearest `.clens/` parent, then `start`.
 */
const findProjectDir = (start: string): string => {
	const findGitRoot = (dir: string): string | undefined => {
		if (existsSync(resolve(dir, ".git"))) return dir
		const parent = dirname(dir)
		return parent === dir ? undefined : findGitRoot(parent)
	}
	const findClensRoot = (dir: string): string | undefined => {
		if (existsSync(resolve(dir, ".clens"))) return dir
		const parent = dirname(dir)
		return parent === dir ? undefined : findClensRoot(parent)
	}
	return findGitRoot(start) ?? findClensRoot(start) ?? start
}

// ── Direct execution ───────────────────────────────────────────────

// When run directly: `bun run src/server/index.ts`
if (import.meta.main) {
	const projectDir = process.env.CLENS_PROJECT_DIR ?? findProjectDir(process.cwd())
	const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined

	const handle = startServer({ projectDir, port })
	console.log(`cLens server listening on ${handle.url}`)
	console.log(`Project dir: ${projectDir}`)
	console.log(`Auth token: ${handle.token}`)
	console.log(`Open: ${handle.url}/health`)
}

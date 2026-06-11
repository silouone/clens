import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import type { ProjectEntry } from "@clens/cli"
import { createApp } from "./app"
import { startLiveWatcher } from "./live"
import { log, currentLevel } from "./logger"

// ── Server options ─────────────────────────────────────────────────

type StartServerOptions = {
	readonly projectDir: string
	readonly port?: number
	readonly token?: string
	readonly projects?: readonly ProjectEntry[]
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
	const app = createApp({
		token,
		mode,
		projectDir: options.projectDir,
		...(options.projects ? { projects: options.projects } : {}),
	})

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

	// Start file watcher(s) for live SSE push
	const watchers = options.projects
		? options.projects.map((p) => startLiveWatcher(p.path))
		: [startLiveWatcher(options.projectDir)]

	return {
		url,
		port: actualPort,
		token,
		stop: () => {
			watchers.forEach((w) => w.stop())
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

// When run directly: `bun run src/server/index.ts [--global] [--port N]`
if (import.meta.main) {
	const args = process.argv.slice(2)
	const isGlobal = args.includes("--global")
	const portFlagIdx = args.indexOf("--port")
	const portArg = portFlagIdx !== -1 ? parseInt(args[portFlagIdx + 1], 10) : undefined

	const projectDir = process.env.CLENS_PROJECT_DIR ?? findProjectDir(process.cwd())
	const port = portArg ?? (process.env.PORT ? parseInt(process.env.PORT, 10) : undefined)

	const projects = isGlobal
		? await (async () => {
			const { discoverAndRegisterProjects } = await import("@clens/cli/src/session/registry")
			return discoverAndRegisterProjects()
		})()
		: undefined

	const handle = startServer({ projectDir, port, ...(projects && projects.length > 0 ? { projects } : {}) })
	console.log(`cLens server listening on ${handle.url}`)
	if (projects && projects.length > 0) {
		console.log(`Mode: global (${projects.length} project${projects.length === 1 ? "" : "s"})`)
	}
	console.log(`Project dir: ${projectDir}`)
	console.log(`Auth token: ${handle.token}`)
	console.log(`Open: ${handle.url}?token=${handle.token}`)
}

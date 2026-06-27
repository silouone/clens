import { resolve } from "node:path"
import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import { createMiddleware } from "hono/factory"
import type { ProjectEntry } from "clens"
import { authToken, validateSessionId, cors } from "./middleware/security"
import { eventsRoute } from "./routes/events"
import { createSessionsRoute, createGlobalSessionsRoute } from "./routes/sessions"
import { createCommandsRoute } from "./routes/commands"
import { createWorkUnitsRoute, createGlobalWorkUnitsRoute } from "./routes/work-units"
import { createConfigRoute } from "./routes/config"
import { createAnalyticsRoute, createGlobalAnalyticsRoute } from "./routes/analytics"
import { createLogger } from "./logger"

const httpLog = createLogger("http")

// ── Static asset path (resolved at import time) ────────────────────
const DIST_DIR = resolve(import.meta.dir, "../../dist")

// ── App factory ────────────────────────────────────────────────────

type AppOptions = {
	readonly token: string
	readonly mode: "development" | "production"
	readonly projectDir: string
	readonly projects?: readonly ProjectEntry[]
}

/**
 * Creates the Hono app with all routes and middleware wired up.
 * Factored out of startServer so tests can create apps without binding a port.
 */
const createApp = (options: AppOptions) => {
	const app = new Hono()

	// ── Request logging middleware ──
	app.use("*", createMiddleware(async (c, next) => {
		const start = performance.now()
		const method = c.req.method
		const path = c.req.path

		await next()

		const duration = (performance.now() - start).toFixed(1)
		const status = c.res.status

		// Skip noisy health checks at info level
		if (path === "/health" || path === "/api/health") {
			httpLog.debug(`${method} ${path} ${status} ${duration}ms`)
		} else {
			const logFn = status >= 500 ? httpLog.error : status >= 400 ? httpLog.warn : httpLog.info
			logFn(`${method} ${path} ${status} ${duration}ms`)
		}
	}))

	// ── Global error handler ──
	app.onError((err, c) => {
		httpLog.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err.message, err.stack)
		return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500)
	})

	// ── Global middleware ──
	app.use("*", cors(options.mode))

	// Auth: enforced in production, skipped in dev (localhost-only binding)
	if (options.mode === "production") {
		app.use("/api/*", authToken(options.token))
	}

	// ── Health (unauthenticated) ──
	app.get("/health", (c) => c.json({ status: "ok" as const, ts: Date.now() }))

	// ── Session ID path validation ──
	app.use("/api/sessions/:sessionId/*", validateSessionId())
	app.use("/api/sessions/:sessionId", validateSessionId())
	app.use("/api/commands/sessions/:sessionId/*", validateSessionId())
	app.use("/api/commands/sessions/:sessionId", validateSessionId())

	// ── API routes ──
	const projects = options.projects ?? []
	const isGlobal = projects.length > 0

	const api = app
		.get("/api/health", (c) =>
			c.json({ status: "ok" as const, ts: Date.now() }),
		)
		.get("/api/projects", (c) =>
			c.json({ data: projects }),
		)
		.route("/api/events", eventsRoute)
		.route("/api/sessions", isGlobal
			? createGlobalSessionsRoute(projects, options.projectDir)
			: createSessionsRoute(options.projectDir))
		.route("/api/work-units", isGlobal
			? createGlobalWorkUnitsRoute(projects, options.projectDir)
			: createWorkUnitsRoute(options.projectDir))
		.route("/api/commands/sessions", createCommandsRoute(options.projectDir, projects))
		.route("/api/config", createConfigRoute(options.projectDir))
		.route("/api/analytics", isGlobal
			? createGlobalAnalyticsRoute(projects, options.projectDir)
			: createAnalyticsRoute(options.projectDir))

	// ── Static assets (production only) ──
	if (options.mode === "production") {
		// Fingerprinted assets — immutable cache (1 year). The Cache-Control middleware
		// MUST be registered BEFORE serveStatic: hono's serveStatic returns the response
		// on a hit without calling next(), so a header middleware registered after it
		// never runs (bug assets-cache-header-middleware-unreachable). Registered first,
		// it runs, awaits serveStatic via next(), then stamps the header on the response.
		app.use(
			"/assets/*",
			async (c, next) => {
				await next()
				c.header("Cache-Control", "public, max-age=31536000, immutable")
			},
		)
		app.use(
			"/assets/*",
			serveStatic({ root: DIST_DIR }),
		)
		// All other paths — serve index.html for SPA routing
		app.get(
			"*",
			serveStatic({ root: DIST_DIR }),
		)
		app.get(
			"*",
			serveStatic({ root: DIST_DIR, path: "index.html" }),
		)
	}

	return api
}

type AppType = ReturnType<typeof createApp>

export { createApp }
export type { AppType, AppOptions }

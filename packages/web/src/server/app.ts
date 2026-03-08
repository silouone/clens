import { resolve } from "node:path"
import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import { authToken, validateSessionId, cors } from "./middleware/security"
import { eventsRoute } from "./routes/events"
import { createSessionsRoute } from "./routes/sessions"
import { createCommandsRoute } from "./routes/commands"

// ── Static asset path (resolved at import time) ────────────────────
const DIST_DIR = resolve(import.meta.dir, "../../dist")

// ── App factory ────────────────────────────────────────────────────

type AppOptions = {
	readonly token: string
	readonly mode: "development" | "production"
	readonly projectDir: string
}

/**
 * Creates the Hono app with all routes and middleware wired up.
 * Factored out of startServer so tests can create apps without binding a port.
 */
const createApp = (options: AppOptions) => {
	const app = new Hono()

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
	const api = app
		.get("/api/health", (c) =>
			c.json({ status: "ok" as const, ts: Date.now() }),
		)
		.route("/api/events", eventsRoute)
		.route("/api/sessions", createSessionsRoute(options.projectDir))
		.route("/api/commands/sessions", createCommandsRoute(options.projectDir))

	// ── Static assets (production only) ──
	if (options.mode === "production") {
		// Fingerprinted assets — immutable cache (1 year)
		app.use(
			"/assets/*",
			serveStatic({ root: DIST_DIR }),
		)
		app.use(
			"/assets/*",
			async (c, next) => {
				await next()
				c.header("Cache-Control", "public, max-age=31536000, immutable")
			},
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

import { createMiddleware } from "hono/factory"
import type { Context } from "hono"

// ── Error response format ──────────────────────────────────────────

type ErrorResponse = {
	readonly error: string
	readonly code: string
	readonly detail?: string
}

const errorJson = (c: Context, status: 401 | 403 | 400, body: ErrorResponse) =>
	c.json(body, status)

// ── UUID regex for session ID path validation ──────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Auth token middleware ──────────────────────────────────────────

const extractToken = (c: Context): string | undefined => {
	const query = new URL(c.req.url).searchParams.get("token")
	if (query) return query

	const auth = c.req.header("Authorization")
	return auth?.startsWith("Bearer ") ? auth.slice(7) : undefined
}

/**
 * Validates request auth token against the server's generated token.
 * Accepts token via `?token=` query param or `Authorization: Bearer` header.
 */
const authToken = (serverToken: string) =>
	createMiddleware(async (c, next) => {
		const token = extractToken(c)
		if (!token || token !== serverToken) {
			return errorJson(c, 401, {
				error: "Unauthorized",
				code: "AUTH_REQUIRED",
				detail: "Valid token required via ?token= or Authorization: Bearer header",
			})
		}
		await next()
	})

// ── Session ID path validation ─────────────────────────────────────

/**
 * Validates that :sessionId path params match UUID format.
 */
const validateSessionId = () =>
	createMiddleware(async (c, next) => {
		const sessionId = c.req.param("sessionId")
		if (sessionId && !UUID_RE.test(sessionId)) {
			return errorJson(c, 400, {
				error: "Invalid session ID",
				code: "INVALID_SESSION_ID",
				detail: `Session ID must be a valid UUID, got: ${sessionId}`,
			})
		}
		await next()
	})

// ── CORS middleware ────────────────────────────────────────────────

/**
 * CORS: allows localhost:5173 in dev, same-origin in production.
 */
const cors = (mode: "development" | "production") =>
	createMiddleware(async (c, next) => {
		const origin = c.req.header("Origin")

		const allowed =
			mode === "development"
				? origin?.startsWith("http://localhost:") ?? false
				: !origin || origin === new URL(c.req.url).origin

		if (origin && allowed) {
			c.header("Access-Control-Allow-Origin", origin)
			c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.header("Access-Control-Allow-Headers", "Authorization, Content-Type")
			c.header("Access-Control-Max-Age", "3600")
		}

		if (c.req.method === "OPTIONS") {
			return c.body(null, allowed ? 204 : 403)
		}

		await next()
	})

export { authToken, validateSessionId, cors }
export type { ErrorResponse }

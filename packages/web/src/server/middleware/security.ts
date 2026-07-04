import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createLogger } from "../logger";

const log = createLogger("auth");

// ── Error response format ──────────────────────────────────────────

type ErrorResponse = {
	readonly error: string;
	readonly code: string;
	readonly detail?: string;
};

const errorJson = (c: Context, status: 401 | 403 | 400, body: ErrorResponse) =>
	c.json(body, status);

// ── Session ID path validation ─────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A bare hex prefix (e.g. an 8-char id from a list link) is also accepted so the
// route layer can resolve it to a full session id (FE-2) instead of the gate
// returning 400. Hex-only (no path separators / dots) — no traversal risk.
const SHORT_ID_RE = /^[0-9a-f]{8,32}$/i;

const isValidSessionId = (id: string): boolean => UUID_RE.test(id) || SHORT_ID_RE.test(id);

// ── Auth token middleware ──────────────────────────────────────────

const extractToken = (c: Context): string | undefined => {
	const query = new URL(c.req.url).searchParams.get("token");
	if (query) return query;

	const auth = c.req.header("Authorization");
	return auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
};

/**
 * Validates request auth token against the server's generated token.
 * Accepts token via `?token=` query param or `Authorization: Bearer` header.
 */
const authToken = (serverToken: string) =>
	createMiddleware(async (c, next) => {
		const token = extractToken(c);
		if (!token || token !== serverToken) {
			log.warn(`Auth rejected: ${c.req.method} ${c.req.path}`);
			return errorJson(c, 401, {
				error: "Unauthorized",
				code: "AUTH_REQUIRED",
				detail: "Valid token required via ?token= or Authorization: Bearer header",
			});
		}
		await next();
	});

// ── Session ID path validation ─────────────────────────────────────

/**
 * Validates that :sessionId path params are either a full UUID or a hex id prefix
 * (which the route resolves to a full id, FE-2). Anything else → 400.
 */
const validateSessionId = () =>
	createMiddleware(async (c, next) => {
		const sessionId = c.req.param("sessionId");
		if (sessionId && !isValidSessionId(sessionId)) {
			log.warn(`Invalid session ID: ${sessionId}`);
			return errorJson(c, 400, {
				error: "Invalid session ID",
				code: "INVALID_SESSION_ID",
				detail: `Session ID must be a valid UUID or hex id prefix, got: ${sessionId}`,
			});
		}
		await next();
	});

// ── CORS middleware ────────────────────────────────────────────────

/**
 * CORS: allows localhost:5173 in dev, same-origin in production.
 */
const cors = (mode: "development" | "production") =>
	createMiddleware(async (c, next) => {
		const origin = c.req.header("Origin");

		const allowed =
			mode === "development"
				? (origin?.startsWith("http://localhost:") ?? false)
				: !origin || origin === new URL(c.req.url).origin;

		if (origin && allowed) {
			c.header("Access-Control-Allow-Origin", origin);
			c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
			c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
			c.header("Access-Control-Max-Age", "3600");
		}

		if (c.req.method === "OPTIONS") {
			return c.body(null, allowed ? 204 : 403);
		}

		await next();
	});

export { authToken, validateSessionId, cors };
export type { ErrorResponse };

import { hc } from "hono/client";
import type { AppType } from "../../server/app";

// ── Token extraction ────────────────────────────────────────────────

/**
 * Extract auth token from URL query param `?token=...`
 * The server prints the token at startup; the CLI opens the browser with it.
 */
const getToken = (): string | undefined => {
	const params = new URLSearchParams(window.location.search);
	return params.get("token") ?? undefined;
};

// ── Client factory ──────────────────────────────────────────────────

/**
 * Base URL defaults to current origin (works in both dev proxy and production).
 */
const baseUrl = (): string => window.location.origin;

/**
 * Create a type-safe Hono RPC client.
 * Auth token is automatically included from the URL query param.
 */
const createApiClient = () => {
	const token = getToken();

	const client = hc<AppType>(baseUrl(), {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});

	return client;
};

// Singleton client instance — created once, reused across the app
const api = createApiClient();

/**
 * Auth headers for raw fetch() calls that bypass the typed client. Every
 * /api request must carry the token — in production these endpoints return
 * 401 without it (dev skips auth, which hid the gap).
 */
const authHeaders = (): Readonly<Record<string, string>> => {
	const token = getToken();
	return token ? { Authorization: `Bearer ${token}` } : {};
};

export { api, getToken, authHeaders, createApiClient };

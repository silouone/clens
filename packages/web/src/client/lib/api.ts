import { hc } from "hono/client";
import type { AppType } from "../../server/app";
import type { ColorName, SessionSummary } from "../../shared/types";

// ── Token extraction ────────────────────────────────────────────────

/**
 * sessionStorage key for the persisted auth token. sessionStorage (NOT
 * localStorage) so a per-launch token is scoped to this browser session and
 * never leaks into the next `clens web` launch.
 */
const TOKEN_STORAGE_KEY = "clens-token";

/**
 * Read the persisted token, guarding against environments where storage is
 * unavailable (private mode, sandboxed iframes).
 */
const readStoredToken = (): string | undefined => {
	try {
		return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined;
	} catch {
		return undefined;
	}
};

/** Persist the token, ignoring failures (private mode / storage disabled). */
const persistToken = (token: string): void => {
	try {
		sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
	} catch {
		// Storage unavailable — token is still returned for this request.
	}
};

/**
 * Canonical auth-token accessor for the whole client.
 *
 * Precedence: a `?token=` URL param always WINS and is persisted to
 * sessionStorage; otherwise FALL BACK to the previously persisted token. This
 * keeps auth working across SPA navigations (e.g. session-list row ->
 * /session/:id) that drop the query string, while a fresh deep-link still
 * overrides any stale stored value. The server prints the token at startup;
 * the CLI opens the browser with it.
 */
const getToken = (): string | undefined => {
	const params = new URLSearchParams(window.location.search);
	const urlToken = params.get("token") ?? undefined;
	if (urlToken) {
		persistToken(urlToken);
		return urlToken;
	}
	return readStoredToken();
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

// ── Session meta (rename + color flag) ──────────────────────────────

/**
 * Patch a session's user metadata (custom label + color flag).
 *
 * Body semantics mirror the server (D6): `label: string` sets, `label: null`
 * clears (whitespace-only is treated as a clear server-side); `color: ColorName`
 * sets, `color: null`/`"none"` clears. Only the keys present in `patch` are sent,
 * so a label-only patch never touches color and vice-versa.
 *
 * Returns the server-resolved `SessionSummary` row (authoritative
 * display_name/name_source/label/color) so the caller can reconcile an
 * optimistic update against the real precedence outcome.
 */
type SessionMetaPatch = {
	readonly label?: string | null;
	readonly color?: ColorName | null;
};

const patchSessionMeta = async (id: string, patch: SessionMetaPatch): Promise<SessionSummary> => {
	// Raw fetch (not the typed client): the route reads an untyped JSON body via
	// c.req.json(), so Hono RPC doesn't surface a `json` arg. Carry the auth token
	// explicitly — /api PATCH returns 401 without it in production.
	const res = await fetch(`/api/sessions/${id}/meta`, {
		method: "PATCH",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: "Unknown error" }));
		const msg =
			body && typeof body === "object" && "error" in body
				? String((body as { error: unknown }).error)
				: `HTTP ${res.status}`;
		throw new Error(msg);
	}
	const body = await res.json();
	if (!body || typeof body !== "object" || !("data" in body)) {
		throw new Error("Invalid meta response");
	}
	return (body as { data: SessionSummary }).data;
};

export type { SessionMetaPatch };
export { api, authHeaders, createApiClient, getToken, patchSessionMeta };

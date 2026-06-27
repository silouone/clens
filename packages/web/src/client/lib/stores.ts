import { createResource, createRoot, createSignal } from "solid-js";
import type { ColorName, ConversationEntry, DistilledSession, SessionSummary } from "../../shared/types";
import { api, patchSessionMeta, type SessionMetaPatch } from "./api";
import { preferences } from "./settings";
import { isStaleConversationFetch } from "./fetch-guard";

const LOG_PREFIX = "[cLens:api]";

// ── Error state ─────────────────────────────────────────────────────

type ApiError = {
	readonly message: string;
	readonly code?: string;
};

const [globalError, setGlobalError] = createSignal<ApiError | undefined>();

const clearError = () => setGlobalError(undefined);

// ── Session list ────────────────────────────────────────────────────

const fetchSessionList = async (): Promise<readonly SessionSummary[]> => {
	console.debug(LOG_PREFIX, "Fetching session list");
	const res = await api.api.sessions.$get({
		query: { sort: "-start_time", limit: "5000" },
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: "Unknown error" }));
		const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
		console.error(LOG_PREFIX, "Session list error:", msg);
		setGlobalError({ message: msg, code: String(res.status) });
		return [];
	}
	const body = await res.json();
	const data = body.data;
	if (!Array.isArray(data)) return [];
	console.debug(LOG_PREFIX, `Session list: ${data.length} sessions`);
	return data as readonly SessionSummary[];
};

/**
 * Reactive session list resource.
 * Automatically fetches on first access; call refetch() to refresh.
 */
// createRoot owns this app-lifetime resource so the computation it creates has a
// reactive owner — avoids SolidJS "computations created outside createRoot" warnings
// at module load (FE-31). The root is never disposed (the store lives for the app's life).
const [sessionList, { refetch: refetchSessions, mutate: mutateSessions }] = createRoot(
	() => createResource(fetchSessionList),
);

// ── Session meta mutation (rename + color flag) ─────────────────────

/**
 * Apply a label/color patch to a single session with an optimistic update.
 *
 * Flow (D6): immediately patch the in-memory row so the UI reflects the edit
 * with zero latency, fire the PATCH, then reconcile the row with the server's
 * authoritative resolution (display_name/name_source by precedence). On failure
 * the optimistic change is rolled back so the list never diverges from disk.
 *
 * The optimistic row is a best-effort guess; only the server knows the resolved
 * display_name when a label is cleared (it reverts to custom-title/computed),
 * so the reconcile step is what makes the displayed name correct, not the guess.
 */
const replaceRow = (
	rows: readonly SessionSummary[] | undefined,
	id: string,
	next: SessionSummary,
): readonly SessionSummary[] | undefined =>
	rows?.map((s) => (s.session_id === id ? next : s));

const optimisticRow = (row: SessionSummary, patch: SessionMetaPatch): SessionSummary => {
	// Label: string sets; null or whitespace-only clears (mirrors server R7/R8).
	const nextLabel =
		"label" in patch
			? typeof patch.label === "string" && patch.label.trim().length > 0
				? patch.label.trim()
				: undefined
			: row.label;
	// Color: a non-"none" name sets; null/"none" clears (R13).
	const nextColor: ColorName | undefined =
		"color" in patch
			? patch.color && patch.color !== "none"
				? patch.color
				: undefined
			: row.color;
	// Best-effort display name: a label wins immediately; clearing it falls back to
	// the existing display_name until the server reconciles the true precedence.
	const display = nextLabel ?? row.display_name ?? row.session_id.slice(0, 8);
	return {
		...row,
		label: nextLabel,
		color: nextColor,
		display_name: display,
		name_source: nextLabel ? "label" : row.name_source,
	};
};

const setSessionMeta = async (id: string, patch: SessionMetaPatch): Promise<void> => {
	const current = sessionList();
	const prev = current?.find((s) => s.session_id === id);
	if (prev) {
		mutateSessions((rows) => replaceRow(rows, id, optimisticRow(prev, patch)));
	}
	try {
		const resolved = await patchSessionMeta(id, patch);
		mutateSessions((rows) => replaceRow(rows, id, resolved));
	} catch (err) {
		// Roll back the optimistic write so the list matches disk again.
		if (prev) mutateSessions((rows) => replaceRow(rows, id, prev));
		const msg = err instanceof Error ? err.message : String(err);
		console.error(LOG_PREFIX, `setSessionMeta failed (${id.slice(0, 8)}):`, msg);
		setGlobalError({ message: msg, code: "META_PATCH" });
	}
};

// ── Session detail (lazy) ───────────────────────────────────────────

/**
 * Staleness metadata from the detail route (bug B5): how the distilled snapshot
 * compares to the live raw session file. `distill_stale` is true when the raw
 * file has grown past what the distill covered.
 */
type StalenessData = {
	readonly distilled_at: number;
	readonly raw_event_count: number;
	readonly distill_stale: boolean;
	/** Distill priced under a different tier than the current explicit config. */
	readonly tier_stale?: boolean;
};

/** Response from the session detail endpoint when distilled data exists. */
type SessionDetailResult =
	| {
			readonly status: "ready";
			readonly data: DistilledSession;
			readonly staleness?: StalenessData;
	  }
	| { readonly status: "not_distilled" };

/**
 * Create a reactive resource for a single session's distilled data.
 * Lazily loaded — only fetches when sessionId signal changes.
 */
const createSessionDetail = (sessionId: () => string | undefined) => {
	const fetcher = async (
		id: string,
	): Promise<SessionDetailResult | undefined> => {
		console.debug(LOG_PREFIX, `Fetching session detail: ${id.slice(0, 8)}`);
		const res = await api.api.sessions[":sessionId"].$get({
			param: { sessionId: id },
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: "Unknown error" }));
			const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
			console.error(LOG_PREFIX, `Session detail error (${id.slice(0, 8)}):`, msg);
			setGlobalError({ message: msg, code: String(res.status) });
			return undefined;
		}
		const body = await res.json();
		if ("status" in body) {
			console.debug(LOG_PREFIX, `Session ${id.slice(0, 8)}: not distilled`);
			return { status: "not_distilled" };
		}
		const data = body.data;
		if (!data || typeof data !== "object" || !("stats" in data)) {
			console.error(LOG_PREFIX, `Session ${id.slice(0, 8)}: invalid data format`, data);
			setGlobalError({ message: "Invalid session data format", code: "PARSE_ERROR" });
			return undefined;
		}
		console.debug(LOG_PREFIX, `Session ${id.slice(0, 8)}: loaded`);
		const rawStaleness = "staleness" in body ? body.staleness : undefined;
		// Validate every field the banner renders, not just the flag (untrusted body)
		const staleness: StalenessData | undefined =
			rawStaleness &&
			typeof rawStaleness === "object" &&
			"distill_stale" in rawStaleness &&
			typeof rawStaleness.distill_stale === "boolean" &&
			"distilled_at" in rawStaleness &&
			typeof rawStaleness.distilled_at === "number" &&
			"raw_event_count" in rawStaleness &&
			typeof rawStaleness.raw_event_count === "number"
				? (rawStaleness as StalenessData)
				: undefined;
		return {
			status: "ready",
			data: data as DistilledSession,
			...(staleness ? { staleness } : {}),
		};
	};

	return createResource(sessionId, fetcher);
};

// ── Conversation entries (paginated) ─────────────────────────────────

/** Read conversation page size at call time from reactive preferences. */
const conversationPageSize = (): number => preferences().conversationPageSize;

type ConversationStore = {
	readonly entries: () => readonly ConversationEntry[];
	readonly loading: () => boolean;
	readonly hasMore: () => boolean;
	readonly loadMore: () => Promise<void>;
	readonly total: () => number;
};

/**
 * Create a paginated conversation store.
 * Initial page loads automatically when sessionId changes.
 * Call loadMore() to fetch next page (triggered by scroll).
 */
const createConversationStore = (sessionId: () => string | undefined): ConversationStore => {
	const [entries, setEntries] = createSignal<readonly ConversationEntry[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [hasMore, setHasMore] = createSignal(false);
	const [offset, setOffset] = createSignal(0);
	const [total, setTotal] = createSignal(0);

	const fetchPage = async (id: string, pageOffset: number): Promise<void> => {
		console.debug(LOG_PREFIX, `Fetching conversation: ${id.slice(0, 8)} offset=${pageOffset}`);
		setLoading(true);
		// Stale-response guard: the request id `id` is the session in flight; if
		// the user navigates to another session while this fetch is awaiting, the
		// resolution must NOT clobber the new session's store. Every state write
		// below is gated on this still matching the current `sessionId()`.
		const isStale = (): boolean => isStaleConversationFetch(id, sessionId());
		try {
			const res = await api.api.sessions[":sessionId"].conversation.$get({
				param: { sessionId: id },
			});
			if (isStale()) return;
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: "Unknown error" }));
				if (isStale()) return;
				const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
				console.error(LOG_PREFIX, `Conversation error (${id.slice(0, 8)}):`, msg);
				setGlobalError({ message: msg, code: String(res.status) });
				return;
			}
			const body = await res.json();
			if (isStale()) return;
			if ("error" in body) {
				console.error(LOG_PREFIX, `Conversation error (${id.slice(0, 8)}):`, body.error);
				setGlobalError({ message: String(body.error), code: String(body.code) });
				return;
			}
			const allData = Array.isArray(body.data) ? (body.data as readonly ConversationEntry[]) : [];
			// Client-side pagination from full dataset
			const ps = conversationPageSize();
			const pageData = allData.slice(pageOffset, pageOffset + ps);
			setTotal(allData.length);
			setHasMore(pageOffset + ps < allData.length);

			if (pageOffset === 0) {
				setEntries(pageData);
			} else {
				setEntries((prev) => [...prev, ...pageData]);
			}
			setOffset(pageOffset + pageData.length);
		} finally {
			// Only clear our own loading flag while still the active session; a
			// stale resolution must not flip loading for the new session's fetch.
			if (!isStale()) setLoading(false);
		}
	};

	// Auto-fetch first page when sessionId changes
	createResource(sessionId, async (id) => {
		setEntries([]);
		setOffset(0);
		setHasMore(false);
		setTotal(0);
		await fetchPage(id, 0);
	});

	const loadMore = async (): Promise<void> => {
		const id = sessionId();
		if (!id || loading() || !hasMore()) return;
		await fetchPage(id, offset());
	};

	return { entries, loading, hasMore, loadMore, total };
};

// ── Agent conversation (simple resource) ────────────────────────────

/**
 * Create a reactive resource for an agent's conversation entries.
 * Fetches all entries at once (agent conversations are typically smaller).
 */
const createAgentConversationResource = (
	sessionId: () => string | undefined,
	agentId: () => string | undefined,
) => {
	const key = (): string | undefined => {
		const sid = sessionId();
		const aid = agentId();
		return sid && aid ? `${sid}:${aid}` : undefined;
	};

	const fetcher = async (
		compositeKey: string,
	): Promise<readonly ConversationEntry[]> => {
		const [sid, aid] = compositeKey.split(":");
		console.debug(LOG_PREFIX, `Fetching agent conversation: session=${sid.slice(0, 8)} agent=${aid.slice(0, 8)}`);
		const res = await api.api.sessions[":sessionId"].agents[":agentId"].conversation.$get({
			param: { sessionId: sid, agentId: aid },
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: "Unknown error" }));
			const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
			console.error(LOG_PREFIX, `Agent conversation error (${sid.slice(0, 8)}/${aid.slice(0, 8)}):`, msg);
			setGlobalError({ message: msg, code: String(res.status) });
			return [];
		}
		const body = await res.json();
		if ("error" in body) {
			console.error(LOG_PREFIX, `Agent conversation error:`, body.error);
			setGlobalError({ message: String(body.error), code: String(body.code) });
			return [];
		}
		const entries = Array.isArray(body.data) ? (body.data as readonly ConversationEntry[]) : [];
		console.debug(LOG_PREFIX, `Agent conversation: ${entries.length} entries`);
		return entries;
	};

	return createResource(key, fetcher);
};

export {
	globalError,
	setGlobalError,
	clearError,
	sessionList,
	refetchSessions,
	setSessionMeta,
	createSessionDetail,
	createConversationStore,
	createAgentConversationResource,
};
export type { ApiError, ConversationStore, SessionDetailResult };

import { createResource, createSignal } from "solid-js";
import type { ConversationEntry, DistilledSession, SessionSummary, WorkUnit } from "../../shared/types";
import { api } from "./api";
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
const [sessionList, { refetch: refetchSessions }] =
	createResource(fetchSessionList);

// ── Session detail (lazy) ───────────────────────────────────────────

/** Related sessions data from work unit index. */
type RelatedSessionsData = {
	readonly work_unit_id: string;
	readonly spec_path?: string;
	readonly sessions: readonly {
		readonly session_id: string;
		readonly session_name?: string;
		readonly phase: string;
		readonly role: string;
		readonly start_time: number;
	}[];
};

/**
 * Staleness metadata from the detail route (bug B5): how the distilled snapshot
 * compares to the live raw session file. `distill_stale` is true when the raw
 * file has grown past what the distill covered.
 */
type StalenessData = {
	readonly distilled_at: number;
	readonly raw_event_count: number;
	readonly distill_stale: boolean;
};

/** Response from the session detail endpoint when distilled data exists. */
type SessionDetailResult =
	| {
			readonly status: "ready";
			readonly data: DistilledSession;
			readonly relatedSessions?: RelatedSessionsData;
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
		const raw = "related_sessions" in body ? body.related_sessions : undefined;
		const relatedSessions: RelatedSessionsData | undefined =
			raw && typeof raw === "object" && "sessions" in raw && Array.isArray(raw.sessions)
				? raw as RelatedSessionsData
				: undefined;
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
			relatedSessions,
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

// ── Work Units ──────────────────────────────────────────────────────

const fetchWorkUnits = async (): Promise<readonly WorkUnit[]> => {
	console.debug(LOG_PREFIX, "Fetching work units");
	try {
		const res = await fetch("/api/work-units");
		if (!res.ok) {
			console.error(LOG_PREFIX, `Work units error: HTTP ${res.status}`);
			return [];
		}
		const body = await res.json();
		const data = body.data;
		if (!Array.isArray(data)) return [];
		console.debug(LOG_PREFIX, `Work units: ${data.length} units`);
		return data as readonly WorkUnit[];
	} catch (err) {
		console.error(LOG_PREFIX, "Work units fetch failed:", err);
		return [];
	}
};

const [workUnitList, { refetch: refetchWorkUnits }] =
	createResource(fetchWorkUnits);

// ── Work Unit Detail (lazy) ─────────────────────────────────────────

/** Session data within a work unit detail response. */
type WorkUnitDetailSession = {
	readonly session_id: string;
	readonly session_name?: string;
	readonly phase: string;
	readonly role: string;
	readonly start_time: number;
	readonly distilled: DistilledSession | null;
	readonly summary: {
		readonly session_id: string;
		readonly session_name?: string;
		readonly is_distilled: boolean;
		readonly duration_ms: number;
	};
};

/** Response from the work unit detail endpoint. */
type WorkUnitDetailResult = {
	readonly unit: WorkUnit;
	readonly sessions: readonly WorkUnitDetailSession[];
};

/**
 * Create a reactive resource for a work unit's enriched detail data.
 * Lazily loaded — only fetches when id signal changes.
 */
const createWorkUnitDetail = (id: () => string | undefined) => {
	const fetcher = async (
		unitId: string,
	): Promise<WorkUnitDetailResult | undefined> => {
		console.debug(LOG_PREFIX, `Fetching work unit detail: ${unitId.slice(0, 12)}`);
		try {
			const res = await fetch(`/api/work-units/${unitId}/detail`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: "Unknown error" }));
				const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
				console.error(LOG_PREFIX, `Work unit detail error (${unitId.slice(0, 12)}):`, msg);
				setGlobalError({ message: msg, code: String(res.status) });
				return undefined;
			}
			const body = await res.json();
			const data = body.data;
			if (!data || typeof data !== "object" || !("unit" in data) || !("sessions" in data) || !Array.isArray(data.sessions)) {
				console.error(LOG_PREFIX, `Work unit ${unitId.slice(0, 12)}: invalid data format`);
				setGlobalError({ message: "Invalid work unit data format", code: "PARSE_ERROR" });
				return undefined;
			}
			console.debug(LOG_PREFIX, `Work unit ${unitId.slice(0, 12)}: loaded`);
			return data as WorkUnitDetailResult;
		} catch (err) {
			console.error(LOG_PREFIX, "Work unit detail fetch failed:", err);
			return undefined;
		}
	};

	return createResource(id, fetcher);
};

export {
	globalError,
	setGlobalError,
	clearError,
	sessionList,
	refetchSessions,
	createSessionDetail,
	createConversationStore,
	createAgentConversationResource,
	workUnitList,
	refetchWorkUnits,
	fetchWorkUnits,
	createWorkUnitDetail,
};
export type { ApiError, ConversationStore, RelatedSessionsData, SessionDetailResult, WorkUnitDetailResult, WorkUnitDetailSession };

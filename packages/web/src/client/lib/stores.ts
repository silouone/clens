import { createResource, createSignal } from "solid-js";
import type { ConversationEntry, DistilledSession, SessionSummary } from "../../shared/types";
import { api } from "./api";

// ── Error state ─────────────────────────────────────────────────────

type ApiError = {
	readonly message: string;
	readonly code?: string;
};

const [globalError, setGlobalError] = createSignal<ApiError | undefined>();

const clearError = () => setGlobalError(undefined);

// ── Session list ────────────────────────────────────────────────────

const fetchSessionList = async (): Promise<readonly SessionSummary[]> => {
	const res = await api.api.sessions.$get({
		query: { sort: "-start_time", limit: "50" },
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: "Unknown error" }));
		const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
		setGlobalError({ message: msg, code: String(res.status) });
		return [];
	}
	const body = await res.json();
	const data = body.data;
	if (!Array.isArray(data)) return [];
	return data as readonly SessionSummary[];
};

/**
 * Reactive session list resource.
 * Automatically fetches on first access; call refetch() to refresh.
 */
const [sessionList, { refetch: refetchSessions }] =
	createResource(fetchSessionList);

// ── Session detail (lazy) ───────────────────────────────────────────

/** Response from the session detail endpoint when distilled data exists. */
type SessionDetailResult =
	| { readonly status: "ready"; readonly data: DistilledSession }
	| { readonly status: "not_distilled" };

/**
 * Create a reactive resource for a single session's distilled data.
 * Lazily loaded — only fetches when sessionId signal changes.
 */
const createSessionDetail = (sessionId: () => string | undefined) => {
	const fetcher = async (
		id: string,
	): Promise<SessionDetailResult | undefined> => {
		const res = await api.api.sessions[":sessionId"].$get({
			param: { sessionId: id },
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: "Unknown error" }));
			const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
			setGlobalError({ message: msg, code: String(res.status) });
			return undefined;
		}
		const body = await res.json();
		if ("status" in body) {
			return { status: "not_distilled" };
		}
		const data = body.data;
		if (!data || typeof data !== "object" || !("stats" in data)) {
			setGlobalError({ message: "Invalid session data format", code: "PARSE_ERROR" });
			return undefined;
		}
		return {
			status: "ready",
			data: data as DistilledSession,
		};
	};

	return createResource(sessionId, fetcher);
};

// ── Conversation entries (paginated) ─────────────────────────────────

const CONVERSATION_PAGE_SIZE = 200;

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
		setLoading(true);
		try {
			const res = await api.api.sessions[":sessionId"].conversation.$get({
				param: { sessionId: id },
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: "Unknown error" }));
				const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
				setGlobalError({ message: msg, code: String(res.status) });
				return;
			}
			const body = await res.json();
			if ("error" in body) {
				setGlobalError({ message: String(body.error), code: String(body.code) });
				return;
			}
			const allData = Array.isArray(body.data) ? (body.data as readonly ConversationEntry[]) : [];
			// Client-side pagination from full dataset
			const pageData = allData.slice(pageOffset, pageOffset + CONVERSATION_PAGE_SIZE);
			setTotal(allData.length);
			setHasMore(pageOffset + CONVERSATION_PAGE_SIZE < allData.length);

			if (pageOffset === 0) {
				setEntries(pageData);
			} else {
				setEntries((prev) => [...prev, ...pageData]);
			}
			setOffset(pageOffset + pageData.length);
		} finally {
			setLoading(false);
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
		const res = await api.api.sessions[":sessionId"].agents[":agentId"].conversation.$get({
			param: { sessionId: sid, agentId: aid },
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({ error: "Unknown error" }));
			const msg = "error" in body ? String(body.error) : `HTTP ${res.status}`;
			setGlobalError({ message: msg, code: String(res.status) });
			return [];
		}
		const body = await res.json();
		if ("error" in body) {
			setGlobalError({ message: String(body.error), code: String(body.code) });
			return [];
		}
		return Array.isArray(body.data) ? (body.data as readonly ConversationEntry[]) : [];
	};

	return createResource(key, fetcher);
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
};
export type { ApiError, ConversationStore, SessionDetailResult };

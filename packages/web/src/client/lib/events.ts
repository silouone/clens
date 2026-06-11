import { createSignal, onCleanup } from "solid-js";
import { getToken } from "./api";
import { refetchSessions } from "./stores";
import { debounce } from "./debounce";

const LOG_PREFIX = "[cLens:sse]";

// ── Types ───────────────────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

type SessionUpdateData = {
	readonly session_id: string;
	readonly session_name?: string;
	readonly status?: string;
	readonly event_count?: number;
};

type LiveEventData = {
	readonly session_id: string;
	readonly event: unknown;
};

type DistillCompleteData = {
	readonly session_id: string;
	readonly error?: boolean;
};

type SSEEventHandler = {
	readonly onSessionUpdate?: (data: SessionUpdateData) => void;
	readonly onLiveEvent?: (data: LiveEventData) => void;
	readonly onDistillComplete?: (data: DistillCompleteData) => void;
	readonly onLiveLink?: (data: { link: unknown }) => void;
};

// ── Debounce ────────────────────────────────────────────────────────

// `debounce` (trailing-edge with a max-wait starvation cap) lives in the
// SolidJS-free leaf module ./debounce so its timer logic is unit-testable.

const REFETCH_DEBOUNCE_MS = 10_000;
// Max time a refetch may be starved by sustained SSE activity before a forced
// trailing flush. Bounds list staleness during a busy live session.
const REFETCH_MAX_WAIT_MS = 30_000;
const guardedRefetch = (() => {
	const [inFlight, setInFlight] = createSignal(false);
	return () => {
		if (inFlight()) {
			console.debug(LOG_PREFIX, "Skipping refetch — already in flight");
			return;
		}
		setInFlight(true);
		console.debug(LOG_PREFIX, "Refetching session list from SSE event");
		Promise.resolve(refetchSessions()).finally(() => setInFlight(false));
	};
})();
const debouncedRefetch = debounce(guardedRefetch, REFETCH_DEBOUNCE_MS, REFETCH_MAX_WAIT_MS);

// ── Constants ───────────────────────────────────────────────────────

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;
const RETRY_MULTIPLIER = 2;
const STABLE_CONNECTION_MS = 5000;

// ── SSE Client ──────────────────────────────────────────────────────

type SSEClient = {
	readonly status: () => ConnectionStatus;
	readonly lastEventId: () => string | undefined;
	readonly disconnect: () => void;
};

/**
 * Create an SSE EventSource connection with auto-reconnect.
 * Parses multiplexed server events and dispatches to handlers.
 * Includes auth token in URL query param (EventSource doesn't support headers).
 */
const createSSEClient = (handlers: SSEEventHandler = {}): SSEClient => {
	const [status, setStatus] = createSignal<ConnectionStatus>("connecting");
	const [lastEventId, setLastEventId] = createSignal<string | undefined>();
	const [retryMs, setRetryMs] = createSignal(INITIAL_RETRY_MS);

	let eventSource: EventSource | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let stabilityTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const buildUrl = (): string => {
		const base = `${window.location.origin}/api/events/stream`;
		const token = getToken();
		const params = new URLSearchParams();
		if (token) params.set("token", token);
		const lastId = lastEventId();
		if (lastId) params.set("lastEventId", lastId);
		const qs = params.toString();
		return qs ? `${base}?${qs}` : base;
	};

	const parseData = (raw: string): unknown => {
		try {
			return JSON.parse(raw);
		} catch {
			return undefined;
		}
	};

	const connect = (): void => {
		if (disposed) return;
		setStatus("connecting");

		const url = buildUrl();
		console.info(LOG_PREFIX, "Connecting to SSE...");
		const es = new EventSource(url);
		eventSource = es;

		es.addEventListener("connected", (e) => {
			setStatus("connected");
			console.info(LOG_PREFIX, "Connected");
			if (stabilityTimer) clearTimeout(stabilityTimer);
			stabilityTimer = setTimeout(() => setRetryMs(INITIAL_RETRY_MS), STABLE_CONNECTION_MS);
			if (e.lastEventId) setLastEventId(e.lastEventId);
		});

		es.addEventListener("heartbeat", (e) => {
			if (e.lastEventId) setLastEventId(e.lastEventId);
		});

		es.addEventListener("session_update", (e) => {
			if (e.lastEventId) setLastEventId(e.lastEventId);
			const raw = parseData(e.data);
			if (raw && typeof raw === "object" && "session_id" in raw) {
				const data = raw as SessionUpdateData;
				handlers.onSessionUpdate?.(data);
				debouncedRefetch();
			}
		});

		es.addEventListener("live_event", (e) => {
			if (e.lastEventId) setLastEventId(e.lastEventId);
			const raw = parseData(e.data);
			if (raw && typeof raw === "object" && "session_id" in raw) {
				handlers.onLiveEvent?.(raw as LiveEventData);
			}
		});

		es.addEventListener("distill_complete", (e) => {
			if (e.lastEventId) setLastEventId(e.lastEventId);
			const raw = parseData(e.data);
			if (raw && typeof raw === "object" && "session_id" in raw) {
				handlers.onDistillComplete?.(raw as DistillCompleteData);
				debouncedRefetch();
			}
		});

		es.addEventListener("live_link", (e) => {
			if (e.lastEventId) setLastEventId(e.lastEventId);
			const raw = parseData(e.data);
			if (raw && typeof raw === "object" && "link" in raw) {
				handlers.onLiveLink?.(raw as { link: unknown });
			}
		});

		es.onerror = () => {
			console.warn(LOG_PREFIX, "Connection error, will reconnect");
			if (stabilityTimer) clearTimeout(stabilityTimer);
			es.close();
			eventSource = undefined;
			setStatus("disconnected");
			scheduleReconnect();
		};
	};

	const scheduleReconnect = (): void => {
		if (disposed) return;
		const delay = retryMs();
		console.info(LOG_PREFIX, `Reconnecting in ${delay}ms`);
		setRetryMs((prev) => Math.min(prev * RETRY_MULTIPLIER, MAX_RETRY_MS));
		retryTimer = setTimeout(connect, delay);
	};

	const disconnect = (): void => {
		disposed = true;
		if (retryTimer) clearTimeout(retryTimer);
		if (stabilityTimer) clearTimeout(stabilityTimer);
		if (eventSource) {
			eventSource.close();
			eventSource = undefined;
		}
		setStatus("disconnected");
	};

	// Start connection
	connect();

	return { status, lastEventId, disconnect };
};

// ── Active session event tracking ───────────────────────────────────

/**
 * Signal tracking live events for a specific session.
 * Used by SessionDetail to append new events in real-time.
 */
const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>();
const [liveEvents, setLiveEvents] = createSignal<readonly unknown[]>([]);

const clearLiveEvents = () => setLiveEvents([]);

const [liveLinks, setLiveLinks] = createSignal<readonly unknown[]>([]);
const appendLiveLink = (link: unknown) =>
	setLiveLinks((prev) => [...prev, link]);
const clearLiveLinks = () => setLiveLinks([]);

/**
 * Signal set when a distill_complete SSE event arrives.
 * SessionDetail watches this to refetch detail when the active session finishes distilling.
 *
 * `equals: false` is required: re-distilling the SAME session twice writes the
 * identical session_id, and Solid's default `===` equality would suppress the
 * second notification — so a manual Re-analyze of an already-viewed session
 * would never refetch the detail. Disabling equality makes every
 * distill_complete event re-fire subscribers regardless of value.
 */
const [lastDistilledSessionId, setLastDistilledSessionId] = createSignal<string | undefined>(
	undefined,
	{ equals: false },
);

/**
 * Create the global SSE connection with default handlers.
 * Idempotent — repeated calls disconnect the previous client first.
 * Returns cleanup function.
 */
// Pragmatic exception: mutable ref for singleton SSE client (same rationale as debounce timer)
let activeClient: SSEClient | undefined;

const initSSE = (): (() => void) => {
	// Disconnect previous client to prevent HMR-leaked duplicate connections
	if (activeClient) {
		activeClient.disconnect();
		activeClient = undefined;
	}

	const client = createSSEClient({
		onLiveEvent: (data) => {
			// Forward every live event to the store and let it decide acceptance.
			//
			// The server broadcasts each JSONL file's events under that file's own
			// session id (derived from the filename), so a CHILD session's events
			// arrive with data.session_id === <childSessionId>, which never equals
			// the actively-viewed PARENT's activeSessionId(). Filtering on
			// data.session_id === activeSessionId() here would drop all child-session
			// events before they reach the live store.
			//
			// The live store (live-store.ts) is the authoritative filter: it accepts
			// an event when raw.sid === current.session_id OR
			// current.child_session_ids.has(raw.sid), and clears the buffer each pass,
			// so forwarding everything here neither accumulates nor leaks foreign data.
			//
			// We still gate on an active session so nothing is buffered when no
			// SessionDetail is mounted.
			if (activeSessionId() !== undefined) {
				setLiveEvents((prev) => [...prev, data.event]);
			}
		},
		onDistillComplete: (data) => {
			setLastDistilledSessionId(data.session_id);
		},
		onLiveLink: (data) => {
			appendLiveLink(data.link);
		},
	});
	activeClient = client;

	return client.disconnect;
};

export {
	createSSEClient,
	initSSE,
	activeSessionId,
	setActiveSessionId,
	liveEvents,
	clearLiveEvents,
	liveLinks,
	appendLiveLink,
	clearLiveLinks,
	lastDistilledSessionId,
};
export type {
	ConnectionStatus,
	SSEClient,
	SSEEventHandler,
	SessionUpdateData,
	LiveEventData,
	DistillCompleteData,
};

import { createSignal, onCleanup } from "solid-js";
import { getToken } from "./api";
import { refetchSessions } from "./stores";

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
};

// ── Debounce ────────────────────────────────────────────────────────

// Pragmatic exception: `let` is required here for closure-based timer state management.
// Same pattern as simpleHash — timers inherently need mutable references within closures.
const debounce = <T extends (...args: readonly unknown[]) => void>(
	fn: T,
	ms: number,
): ((...args: Parameters<T>) => void) => {
	// eslint-disable-next-line -- mutable timer ref required for debounce semantics
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (...args: Parameters<T>) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
};

const REFETCH_DEBOUNCE_MS = 10_000;
// Pragmatic exception: mutable flag for in-flight guard (same rationale as debounce timer)
let refetchInFlight = false;
const guardedRefetch = () => {
	if (refetchInFlight) {
		console.debug(LOG_PREFIX, "Skipping refetch — already in flight");
		return;
	}
	refetchInFlight = true;
	console.debug(LOG_PREFIX, "Refetching session list from SSE event");
	Promise.resolve(refetchSessions()).finally(() => {
		refetchInFlight = false;
	});
};
const debouncedRefetch = debounce(guardedRefetch, REFETCH_DEBOUNCE_MS);

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

/**
 * Signal set when a distill_complete SSE event arrives.
 * SessionDetail watches this to refetch detail when the active session finishes distilling.
 */
const [lastDistilledSessionId, setLastDistilledSessionId] = createSignal<string | undefined>();

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
			// Only track events for the actively viewed session
			if (data.session_id === activeSessionId()) {
				setLiveEvents((prev) => [...prev, data.event]);
			}
		},
		onDistillComplete: (data) => {
			setLastDistilledSessionId(data.session_id);
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

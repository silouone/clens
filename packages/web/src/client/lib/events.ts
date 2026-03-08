import { createSignal, onCleanup } from "solid-js";
import { getToken } from "./api";
import { refetchSessions } from "./stores";

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

// ── Constants ───────────────────────────────────────────────────────

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;
const RETRY_MULTIPLIER = 2;

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
		const es = new EventSource(url);
		eventSource = es;

		es.addEventListener("connected", (e) => {
			setStatus("connected");
			setRetryMs(INITIAL_RETRY_MS);
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
				refetchSessions();
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
				refetchSessions();
			}
		});

		es.onerror = () => {
			es.close();
			eventSource = undefined;
			setStatus("disconnected");
			scheduleReconnect();
		};
	};

	const scheduleReconnect = (): void => {
		if (disposed) return;
		const delay = retryMs();
		setRetryMs((prev) => Math.min(prev * RETRY_MULTIPLIER, MAX_RETRY_MS));
		retryTimer = setTimeout(connect, delay);
	};

	const disconnect = (): void => {
		disposed = true;
		if (retryTimer) clearTimeout(retryTimer);
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
 * Used by SessionView to append new events in real-time.
 */
const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>();
const [liveEvents, setLiveEvents] = createSignal<readonly unknown[]>([]);

const clearLiveEvents = () => setLiveEvents([]);

/**
 * Create the global SSE connection with default handlers.
 * Call once at app startup (e.g. in index.tsx or App.tsx).
 * Returns cleanup function.
 */
const initSSE = (): (() => void) => {
	const client = createSSEClient({
		onLiveEvent: (data) => {
			// Only track events for the actively viewed session
			if (data.session_id === activeSessionId()) {
				setLiveEvents((prev) => [...prev, data.event]);
			}
		},
		onDistillComplete: (data) => {
			// If viewing this session, the detail resource will be refetched
			// by whoever is consuming the distill_complete signal
		},
	});

	return client.disconnect;
};

export {
	createSSEClient,
	initSSE,
	activeSessionId,
	setActiveSessionId,
	liveEvents,
	clearLiveEvents,
};
export type {
	ConnectionStatus,
	SSEClient,
	SSEEventHandler,
	SessionUpdateData,
	LiveEventData,
	DistillCompleteData,
};

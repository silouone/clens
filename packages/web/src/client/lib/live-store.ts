import { createSignal, createEffect, onCleanup, createMemo } from "solid-js"
import { liveEvents, clearLiveEvents, setActiveSessionId, liveLinks, clearLiveLinks } from "./events"
import { getToken } from "./api"
import type { StoredEvent } from "../../shared/types"

// ── Types ───────────────────────────────────────────────────────────

type LiveAgentState = {
	readonly agent_id: string
	readonly agent_name: string | undefined
	readonly agent_type: string
	readonly status: "running" | "stopped"
	readonly tool_calls: number
	readonly failures: number
	readonly last_event_time: number
}

type PendingTool = {
	readonly name: string
	readonly started_at: number
	readonly file_path: string | undefined
}

type LiveSessionState = {
	readonly session_id: string
	readonly model: string | undefined
	readonly git_branch: string | undefined
	readonly start_time: number
	readonly event_count: number
	readonly tool_call_count: number
	readonly failure_count: number
	readonly status: "active" | "idle" | "complete"
	readonly pending_tools: ReadonlyMap<string, PendingTool>
	readonly agents: ReadonlyMap<string, LiveAgentState>
	readonly child_session_ids: ReadonlySet<string>
	readonly files_touched: ReadonlyMap<string, number>
	readonly recent_events: readonly StoredEvent[]
	readonly user_prompts: readonly string[]
	readonly messages_sent: number
}

// ── Initial state factory ───────────────────────────────────────────

const createInitialState = (session_id: string): LiveSessionState => ({
	session_id,
	model: undefined,
	git_branch: undefined,
	start_time: Date.now(),
	event_count: 0,
	tool_call_count: 0,
	failure_count: 0,
	status: "active",
	pending_tools: new Map(),
	agents: new Map(),
	child_session_ids: new Set(),
	files_touched: new Map(),
	recent_events: [],
	user_prompts: [],
	messages_sent: 0,
})

// ── Pure helpers ────────────────────────────────────────────────────

const RECENT_EVENTS_LIMIT = 200

const extractFilePath = (data: Readonly<Record<string, unknown>>): string | undefined => {
	const input = data.tool_input
	if (!input || typeof input !== "object") return undefined
	const rec = input as Record<string, unknown>
	if (typeof rec.file_path === "string") return rec.file_path
	if (typeof rec.path === "string") return rec.path
	return undefined
}

const appendRecent = (
	events: readonly StoredEvent[],
	event: StoredEvent,
): readonly StoredEvent[] => {
	const next = [...events, event]
	return next.length > RECENT_EVENTS_LIMIT ? next.slice(-RECENT_EVENTS_LIMIT) : next
}

const incrementFileCount = (
	files: ReadonlyMap<string, number>,
	path: string | undefined,
): ReadonlyMap<string, number> => {
	if (!path) return files
	const next = new Map(files)
	next.set(path, (next.get(path) ?? 0) + 1)
	return next
}

// ── Event reducer ───────────────────────────────────────────────────

const processEvent = (
	state: LiveSessionState,
	event: StoredEvent,
): LiveSessionState => {
	const base: LiveSessionState = {
		...state,
		event_count: state.event_count + 1,
		recent_events: appendRecent(state.recent_events, event),
		status: state.status === "complete" ? "complete" as const : "active" as const,
	}

	switch (event.event) {
		case "SessionStart": {
			const raw = event as unknown as Readonly<Record<string, unknown>> // StoredEvent → Record for context access
			const ctx = typeof raw.context === "object" && raw.context !== null
				? (raw.context as Readonly<Record<string, unknown>>)
				: undefined
			const model = typeof ctx?.model === "string" ? ctx.model : undefined
			const gitBranch = typeof ctx?.git_branch === "string" ? ctx.git_branch : undefined
			return {
				...base,
				model: model ?? state.model,
				git_branch: gitBranch ?? state.git_branch,
				start_time: event.t,
			}
		}

		case "PreToolUse": {
			const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : "unknown"
			const toolUseId = typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : ""
			const filePath = extractFilePath(event.data)
			const pending = new Map(state.pending_tools)
			pending.set(toolUseId, { name: toolName, started_at: event.t, file_path: filePath })

			return {
				...base,
				tool_call_count: state.tool_call_count + 1,
				pending_tools: pending,
				files_touched: incrementFileCount(state.files_touched, filePath),
			}
		}

		case "PostToolUse": {
			const completedId = typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : ""
			const pending = new Map(state.pending_tools)
			pending.delete(completedId)
			return { ...base, pending_tools: pending }
		}

		case "PostToolUseFailure": {
			const failedId = typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : ""
			const pending = new Map(state.pending_tools)
			pending.delete(failedId)
			return { ...base, failure_count: state.failure_count + 1, pending_tools: pending }
		}

		case "SubagentStart": {
			const agentId = typeof event.data.agent_id === "string" ? event.data.agent_id : ""
			const agents = new Map(state.agents)
			agents.set(agentId, {
				agent_id: agentId,
				agent_name: typeof event.data.agent_name === "string" ? event.data.agent_name : undefined,
				agent_type: typeof event.data.agent_type === "string" ? event.data.agent_type : "sub_agent",
				status: "running",
				tool_calls: 0,
				failures: 0,
				last_event_time: event.t,
			})
			return { ...base, agents }
		}

		case "SubagentStop": {
			const agentId = typeof event.data.agent_id === "string" ? event.data.agent_id : ""
			const existing = state.agents.get(agentId)
			if (!existing) return base
			const agents = new Map(state.agents)
			agents.set(agentId, { ...existing, status: "stopped", last_event_time: event.t })
			return { ...base, agents }
		}

		case "UserPromptSubmit": {
			const text = typeof event.data.text === "string" ? event.data.text : ""
			return { ...base, user_prompts: [...state.user_prompts, text] }
		}

		case "SessionEnd":
		case "Stop":
			return { ...base, status: "complete" }

		default:
			return base
	}
}

// ── Link reducer ────────────────────────────────────────────────────

type LinkLike = Readonly<Record<string, unknown>>

const processLink = (
	state: LiveSessionState,
	link: LinkLike,
): LiveSessionState => {
	if (link.type === "spawn") {
		const parentSession = typeof link.parent_session === "string" ? link.parent_session : undefined
		if (parentSession !== state.session_id) return state

		const agentId = typeof link.agent_id === "string" ? link.agent_id : ""
		const children = new Set(state.child_session_ids)
		children.add(agentId)

		const agents = new Map(state.agents)
		if (!agents.has(agentId)) {
			agents.set(agentId, {
				agent_id: agentId,
				agent_name: typeof link.agent_name === "string" ? link.agent_name : undefined,
				agent_type: typeof link.agent_type === "string" ? link.agent_type : "sub_agent",
				status: "running",
				tool_calls: 0,
				failures: 0,
				last_event_time: typeof link.t === "number" ? link.t : Date.now(),
			})
		}
		return { ...state, agents, child_session_ids: children }
	}

	if (link.type === "stop") {
		const agentId = typeof link.agent_id === "string" ? link.agent_id : ""
		const existing = state.agents.get(agentId)
		if (!existing) return state
		const agents = new Map(state.agents)
		agents.set(agentId, { ...existing, status: "stopped", last_event_time: typeof link.t === "number" ? link.t : Date.now() })
		return { ...state, agents }
	}

	if (link.type === "msg_send") {
		return { ...state, messages_sent: state.messages_sent + 1 }
	}

	return state
}

// ── SolidJS store factory ───────────────────────────────────────────

const createLiveSessionStore = (sessionId: () => string | undefined) => {
	const [state, setState] = createSignal<LiveSessionState | undefined>(undefined)
	const [elapsed, setElapsed] = createSignal(0)

	// Initialize state when sessionId changes
	createEffect(() => {
		const id = sessionId()
		if (!id) {
			setState(undefined)
			return
		}

		setState(createInitialState(id))
		setActiveSessionId(id)
		clearLiveEvents()
		clearLiveLinks()

		// Hydrate from existing events via REST (raw fetch — events endpoint uses query params not typed in Hono)
		;(async () => {
			try {
				const token = getToken()
				const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
				const res = await fetch(`/api/sessions/${id}/events?offset=0&limit=10000`, { headers })
				if (!res.ok) return
				const body = (await res.json()) as Record<string, unknown>
				const events = Array.isArray(body.data) ? (body.data as readonly StoredEvent[]) : []

				const hydrated = events.reduce(
					(acc, event) => processEvent(acc, event),
					createInitialState(id),
				)
				setState(hydrated)
			} catch {
				// Hydration failure is non-fatal — SSE will catch up
			}
		})()

		onCleanup(() => {
			setActiveSessionId(undefined)
		})
	})

	// Process incoming live events
	createEffect(() => {
		const events = liveEvents()
		const current = state()
		if (!current || events.length === 0) return

		const isStoredEvent = (raw: unknown): raw is StoredEvent =>
			typeof raw === "object" && raw !== null && "event" in raw && "t" in raw

		const validEvents = events.filter(isStoredEvent)
		const next = validEvents.reduce((acc, raw) => {
			if (raw.sid === current.session_id || current.child_session_ids.has(raw.sid)) {
				return processEvent(acc, raw)
			}
			return acc
		}, current)

		if (next !== current) {
			setState(next)
		}
		clearLiveEvents()
	})

	// Process incoming link events
	createEffect(() => {
		const links = liveLinks()
		const current = state()
		if (!current || links.length === 0) return

		const validLinks = links.filter(
			(l): l is LinkLike => typeof l === "object" && l !== null,
		)
		const next = validLinks.reduce<LiveSessionState>(
			(acc, link) => processLink(acc, link),
			current,
		)

		if (next !== current) setState(next)
		clearLiveLinks()
	})

	// Duration timer (ticks every second while active)
	createEffect(() => {
		const s = state()
		if (!s || s.status === "complete") return

		// Pragmatic exception: mutable timer ref required for setInterval lifecycle
		const timer = setInterval(() => {
			const s2 = state()
			if (s2) setElapsed(Date.now() - s2.start_time)
		}, 1000)

		onCleanup(() => clearInterval(timer))
	})

	const isActive = createMemo(() => {
		const s = state()
		return s ? s.status === "active" : false
	})

	return { state, elapsed, isActive }
}

export { createLiveSessionStore, processEvent, processLink, createInitialState, extractFilePath }
export type { LiveSessionState, LiveAgentState, PendingTool }

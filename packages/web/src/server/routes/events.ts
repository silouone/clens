import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { createLogger } from "../logger"

const log = createLogger("sse")

// ── SSE Event Types ────────────────────────────────────────────────

type SSEEventType = "session_update" | "live_event" | "distill_complete"

type SSEEvent = {
	readonly type: SSEEventType
	readonly data: unknown
}

// ── Ring buffer for replay on reconnect (mutable at I/O boundary) ──

type BufferedEvent = {
	readonly id: number
	readonly type: string
	readonly data: string
}

const RING_BUFFER_SIZE = 1000

// Mutable ring buffer state at I/O boundary
const ring = {
	buffer: [] as BufferedEvent[],
	start: 0, // index of oldest element in circular buffer
}

const addToRingBuffer = (event: BufferedEvent): void => {
	if (ring.buffer.length < RING_BUFFER_SIZE) {
		ring.buffer = [...ring.buffer, event]
	} else {
		ring.buffer[ring.start] = event
		ring.start = (ring.start + 1) % RING_BUFFER_SIZE
	}
}

/**
 * Get events after a given ID from the ring buffer.
 * Returns undefined if the ID has been evicted (client is too far behind).
 */
const getEventsAfter = (afterId: number): readonly BufferedEvent[] | undefined => {
	if (ring.buffer.length === 0) return []

	// Find the oldest ID in the buffer
	const oldestIdx = ring.buffer.length < RING_BUFFER_SIZE ? 0 : ring.start
	const oldestId = ring.buffer[oldestIdx].id

	// If requested ID is older than our oldest, it's been evicted
	if (afterId < oldestId - 1) return undefined

	// Collect events with ID > afterId (pure filter, no mutation)
	const len = ring.buffer.length
	return Array.from({ length: len }, (_, i) => {
		const idx = ring.buffer.length < RING_BUFFER_SIZE ? i : (ring.start + i) % RING_BUFFER_SIZE
		return ring.buffer[idx]
	}).filter((entry) => entry.id > afterId)
}

// ── Connection tracking (mutable state at I/O boundary) ────────────

type SSEConnection = {
	readonly id: string
	readonly send: (event: string, data: string, id: string) => void
	readonly close: () => void
}

// Mutable at I/O boundary — SSE connections are inherently stateful
const activeConnections = new Set<SSEConnection>()

// Monotonic event ID counter (mutable at I/O boundary)
const eventId = { next: 1 }
const getNextEventId = (): number => {
	const id = eventId.next
	eventId.next += 1
	return id
}

// ── Broadcast ──────────────────────────────────────────────────────

/**
 * Broadcast an SSE event to all active connections.
 * Automatically assigns monotonic event IDs and stores in ring buffer.
 */
const broadcastSSE = (event: SSEEvent): void => {
	const id = getNextEventId()
	const idStr = String(id)
	const data = JSON.stringify(event.data)

	// Store in ring buffer for replay
	addToRingBuffer({ id, type: event.type, data })

	log.debug(`Broadcast ${event.type} to ${activeConnections.size} connections (id=${id})`)
	Array.from(activeConnections).map((conn) => {
		try {
			conn.send(event.type, data, idStr)
		} catch (err) {
			log.warn(`Failed to send to ${conn.id}, removing:`, err instanceof Error ? err.message : String(err))
			activeConnections.delete(conn)
		}
	})
}

// ── SSE Route ──────────────────────────────────────────────────────

const eventsRoute = new Hono().get("/stream", (c) => {
	const lastEventId = c.req.header("Last-Event-ID")
	const startFrom = lastEventId ? parseInt(lastEventId, 10) : 0

	return streamSSE(c, async (stream) => {
		const connId = crypto.randomUUID()

		const connection: SSEConnection = {
			id: connId,
			send: (event, data, id) => {
				stream.writeSSE({ event, data, id })
			},
			close: () => {
				stream.abort()
			},
		}

		activeConnections.add(connection)
		log.info(`SSE connected: ${connId} (total=${activeConnections.size})`)

		// Replay missed events from ring buffer on reconnect
		if (startFrom > 0) {
			const missed = getEventsAfter(startFrom)
			if (missed === undefined) {
				// Last-Event-ID evicted — send full refresh signal
				await stream.writeSSE({
					event: "full_refresh",
					data: JSON.stringify({ reason: "events_evicted", last_known_id: startFrom }),
					id: String(getNextEventId()),
				})
			} else {
				// Replay missed events (sequential writes via reduce)
				await missed.reduce(
					(chain, entry) =>
						chain.then(() =>
							stream.writeSSE({
								event: entry.type,
								data: entry.data,
								id: String(entry.id),
							}),
						),
					Promise.resolve(),
				)
			}
		}

		// Send connection confirmation
		await stream.writeSSE({
			event: "connected",
			data: JSON.stringify({
				connectionId: connId,
				resumedFrom: startFrom > 0 ? startFrom : undefined,
				bufferedEvents: ring.buffer.length,
			}),
			id: String(getNextEventId()),
		})

		// Heartbeat every 30s to keep connections alive
		const HEARTBEAT_MS = 30_000
		const heartbeat = setInterval(() => {
			stream.writeSSE({
				event: "heartbeat",
				data: JSON.stringify({ ts: Date.now() }),
				id: String(getNextEventId()),
			})
		}, HEARTBEAT_MS)

		// Clean up on disconnect
		stream.onAbort(() => {
			clearInterval(heartbeat)
			activeConnections.delete(connection)
			log.info(`SSE disconnected: ${connId} (remaining=${activeConnections.size})`)
		})

		// Hold the connection open — events arrive via broadcastSSE
		await new Promise<void>((resolve) => {
			stream.onAbort(resolve)
		})
	})
})

// ── Exports ────────────────────────────────────────────────────────

const getActiveConnectionCount = (): number => activeConnections.size
const getRingBufferSize = (): number => ring.buffer.length

export { eventsRoute, broadcastSSE, getActiveConnectionCount, getRingBufferSize, getEventsAfter }
export type { SSEEvent, SSEEventType }

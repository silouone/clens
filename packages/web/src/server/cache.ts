import type { StoredEvent } from "@clens/cli/src/types"

// ── LRU Cache for session events ───────────────────────────────────
// Mutable Map at I/O boundary — caching is inherently stateful

type CacheEntry = {
	readonly events: readonly StoredEvent[]
	readonly sizeBytes: number
	lastAccess: number
}

const MAX_ENTRIES = 10
const MAX_BYTES = 17 * 1024 * 1024 // ~17MB

// Mutable state at I/O boundary
const cache = new Map<string, CacheEntry>()
let totalBytes = 0

const estimateSize = (events: readonly StoredEvent[]): number =>
	events.reduce((acc, e) => acc + JSON.stringify(e).length * 2, 0)

const evictLRU = (): void => {
	if (cache.size === 0) return

	const oldest = [...cache.entries()].reduce((min, entry) =>
		entry[1].lastAccess < min[1].lastAccess ? entry : min,
	)

	totalBytes -= oldest[1].sizeBytes
	cache.delete(oldest[0])
}

const ensureCapacity = (neededBytes: number): void => {
	if ((cache.size >= MAX_ENTRIES || totalBytes + neededBytes > MAX_BYTES) && cache.size > 0) {
		evictLRU()
		ensureCapacity(neededBytes)
	}
}

/**
 * Get cached events for a session, or undefined if not cached.
 */
const getCachedEvents = (sessionId: string): readonly StoredEvent[] | undefined => {
	const entry = cache.get(sessionId)
	if (!entry) return undefined
	entry.lastAccess = Date.now()
	return entry.events
}

/**
 * Store events in the LRU cache.
 */
const setCachedEvents = (sessionId: string, events: readonly StoredEvent[]): void => {
	// Remove existing entry if present
	const existing = cache.get(sessionId)
	if (existing) {
		totalBytes -= existing.sizeBytes
		cache.delete(sessionId)
	}

	const sizeBytes = estimateSize(events)
	ensureCapacity(sizeBytes)

	cache.set(sessionId, {
		events,
		sizeBytes,
		lastAccess: Date.now(),
	})
	totalBytes += sizeBytes
}

/**
 * Invalidate a specific session from the cache.
 */
const invalidateCache = (sessionId: string): void => {
	const entry = cache.get(sessionId)
	if (entry) {
		totalBytes -= entry.sizeBytes
		cache.delete(sessionId)
	}
}

const getCacheStats = () => ({
	entries: cache.size,
	totalBytes,
	maxEntries: MAX_ENTRIES,
	maxBytes: MAX_BYTES,
})

export { getCachedEvents, setCachedEvents, invalidateCache, getCacheStats }

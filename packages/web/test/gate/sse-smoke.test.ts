import { describe, test, expect, afterEach } from "bun:test"

/** Collect all events from an SSE ReadableStream until `done` signal or timeout. */
const collectSSEEvents = async (
	response: Response,
	signal: AbortSignal,
): Promise<readonly string[]> => {
	const reader = response.body!.getReader()
	const decoder = new TextDecoder()
	const events: string[] = []

	const read = async (): Promise<readonly string[]> => {
		if (signal.aborted) return events
		const { done, value } = await reader.read()
		if (done) return events
		const text = decoder.decode(value, { stream: true })
		const lines = text.split("\n")
		lines
			.filter((l) => l.startsWith("data: "))
			.forEach((l) => events.push(l.slice(6)))
		return read()
	}

	return read()
}

describe("SSE on Bun.serve()", () => {
	let server: ReturnType<typeof Bun.serve> | undefined

	afterEach(() => {
		server?.stop(true)
		server = undefined
	})

	test("receives 100 SSE events in order", async () => {
		const EVENT_COUNT = 100

		server = Bun.serve({
			port: 0,
			fetch: (req) => {
				const url = new URL(req.url)
				if (url.pathname !== "/sse") return new Response("not found", { status: 404 })

				const stream = new ReadableStream({
					start: (controller) => {
						const encoder = new TextEncoder()
						Array.from({ length: EVENT_COUNT }, (_, i) => {
							controller.enqueue(
								encoder.encode(`id: ${i}\ndata: ${JSON.stringify({ n: i })}\n\n`),
							)
						})
						controller.enqueue(encoder.encode("data: __done__\n\n"))
						controller.close()
					},
				})

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					},
				})
			},
		})

		const res = await fetch(`http://localhost:${server.port}/sse`)
		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toBe("text/event-stream")

		const ac = new AbortController()
		const events = await collectSSEEvents(res, ac.signal)

		// Last event is the done sentinel
		const dataEvents = events.filter((e) => e !== "__done__")
		expect(dataEvents.length).toBe(EVENT_COUNT)

		// Verify order
		dataEvents.forEach((raw, i) => {
			expect(JSON.parse(raw).n).toBe(i)
		})
	})

	test("auto-reconnect respects Last-Event-ID", async () => {
		server = Bun.serve({
			port: 0,
			fetch: (req) => {
				const url = new URL(req.url)
				if (url.pathname !== "/sse") return new Response("not found", { status: 404 })

				const lastId = parseInt(req.headers.get("Last-Event-ID") ?? "-1", 10)
				const startFrom = lastId + 1
				const encoder = new TextEncoder()

				const stream = new ReadableStream({
					start: (controller) => {
						Array.from({ length: 5 }, (_, i) => {
							const id = startFrom + i
							controller.enqueue(
								encoder.encode(`id: ${id}\ndata: ${JSON.stringify({ n: id })}\n\n`),
							)
						})
						controller.close()
					},
				})

				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				})
			},
		})

		// First connection: get events 0-4
		const res1 = await fetch(`http://localhost:${server.port}/sse`)
		const body1 = await res1.text()
		const ids1 = [...body1.matchAll(/id: (\d+)/g)].map((m) => parseInt(m[1], 10))
		expect(ids1).toEqual([0, 1, 2, 3, 4])

		// Simulate reconnect with Last-Event-ID: 4 → should get 5-9
		const res2 = await fetch(`http://localhost:${server.port}/sse`, {
			headers: { "Last-Event-ID": "4" },
		})
		const body2 = await res2.text()
		const ids2 = [...body2.matchAll(/id: (\d+)/g)].map((m) => parseInt(m[1], 10))
		expect(ids2).toEqual([5, 6, 7, 8, 9])
	})

	test("idle SSE connection stays open for 5s without crash", async () => {
		const IDLE_MS = 5_000

		server = Bun.serve({
			port: 0,
			fetch: (req) => {
				const url = new URL(req.url)
				if (url.pathname !== "/sse") return new Response("not found", { status: 404 })

				const encoder = new TextEncoder()
				const stream = new ReadableStream({
					start: (controller) => {
						// Send one initial event, then keep alive
						controller.enqueue(encoder.encode("data: hello\n\n"))

						// Send a close event after IDLE_MS
						setTimeout(() => {
							try {
								controller.enqueue(encoder.encode("data: __close__\n\n"))
								controller.close()
							} catch {
								// stream may already be closed
							}
						}, IDLE_MS)
					},
				})

				return new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				})
			},
		})

		const start = Date.now()
		const res = await fetch(`http://localhost:${server.port}/sse`)
		const body = await res.text()
		const elapsed = Date.now() - start

		expect(body).toContain("data: hello")
		expect(body).toContain("data: __close__")
		// Should have been idle for approximately IDLE_MS
		expect(elapsed).toBeGreaterThanOrEqual(IDLE_MS - 500)
	}, 15_000) // generous test timeout
})

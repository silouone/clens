import { describe, test, expect } from "bun:test"
import { hc } from "hono/client"
import type { AppType } from "../../src/server/app"

const TEST_TOKEN = "test-token-for-gate"

describe("Hono RPC cross-workspace type test", () => {
	test("hc<AppType> resolves typed routes", () => {
		// Create a typed client — this alone validates that TypeScript
		// resolves AppType across the workspace boundary
		const client = hc<AppType>("http://localhost:3000")

		// Verify the client has the expected typed route accessors
		expect(client.api.health).toBeDefined()
		expect(client.api.events).toBeDefined()

		// Verify $get is a function (typed RPC method)
		expect(typeof client.api.health.$get).toBe("function")
	})

	test("typed client makes real request to Bun.serve()", async () => {
		const { createApp } = await import("../../src/server/app")
		const app = createApp({ token: TEST_TOKEN, mode: "development", projectDir: "/tmp/clens-test" })

		const server = Bun.serve({
			port: 0,
			fetch: app.fetch,
		})

		try {
			const client = hc<AppType>(`http://localhost:${server.port}`)

			// Make typed request to /api/health (with auth token)
			const healthRes = await client.api.health.$get(
				{},
				{ headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
			)
			expect(healthRes.status).toBe(200)
			const health = await healthRes.json()
			expect(health.status).toBe("ok")
			expect(typeof health.ts).toBe("number")
		} finally {
			server.stop(true)
		}
	})
})

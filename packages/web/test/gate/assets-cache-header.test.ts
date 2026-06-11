import { describe, test, expect } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { createApp } from "../../src/server/app"

// Regression for bug assets-cache-header-middleware-unreachable.
//
// hono's serveStatic returns the response on a hit WITHOUT calling next(), so any
// header middleware registered AFTER it for the same path never runs. The
// Cache-Control middleware for /assets/* must therefore be registered BEFORE
// serveStatic. We guard both the ordering (source gate — robust to a missing build)
// and the live header (behavioral — only when a real built asset is present).

const APP_SOURCE = resolve(import.meta.dir, "../../src/server/app.ts")
const DIST_ASSETS = resolve(import.meta.dir, "../../dist/assets")

describe("assets Cache-Control middleware ordering (source gate)", () => {
	const source = readFileSync(APP_SOURCE, "utf-8")

	test("registers the Cache-Control middleware BEFORE serveStatic for /assets/*", () => {
		const cacheHeaderIdx = source.indexOf('"public, max-age=31536000, immutable"')
		const assetsServeStaticIdx = source.indexOf("serveStatic({ root: DIST_DIR })")
		expect(cacheHeaderIdx).toBeGreaterThan(-1)
		expect(assetsServeStaticIdx).toBeGreaterThan(-1)
		// The header middleware must appear earlier in the file than the /assets
		// serveStatic registration, or it will never run on a static hit.
		expect(cacheHeaderIdx).toBeLessThan(assetsServeStaticIdx)
	})
})

describe("assets Cache-Control header (behavioral)", () => {
	const haveBuiltAssets = existsSync(DIST_ASSETS)

	test.skipIf(!haveBuiltAssets)("a served /assets/* file carries the immutable Cache-Control header", async () => {
		// Discover a real fingerprinted asset rather than hardcode a hash.
		const assetFile = readdirSync(DIST_ASSETS).find((f) => f.endsWith(".js") || f.endsWith(".css"))
		expect(assetFile).toBeDefined()

		const app = createApp({ token: "test-token", mode: "production", projectDir: "/tmp" })
		const res = await app.request(`/assets/${assetFile}?token=test-token`)
		expect(res.status).toBe(200)
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")
	})
})

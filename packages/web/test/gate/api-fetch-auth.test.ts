import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

// Regression guard for FE-35: in production every /api request is auth-gated and
// returns 401 without a Bearer token. The typed Hono RPC client (`hc`/`api` in
// lib/api.ts) injects the token automatically, but raw `fetch("/api/...")` calls
// bypass it — they MUST attach the token explicitly via `authHeaders()`,
// `getTokenHeader()`, an `Authorization` header, or a token-bearing `headers`
// variable. Dev mode skips auth, which hid this gap until prod 401s surfaced.
//
// This source gate scans the client for raw fetches whose URL targets /api and
// fails if any is missing an auth-header marker — so a new un-authed API fetch
// cannot be added silently.

const CLIENT_DIR = resolve(import.meta.dir, "../../src/client")

const walk = (dir: string): readonly string[] =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) return walk(full)
		return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
	})

/**
 * Extract the full text of each `fetch(...)` call in `source`, matching the
 * outermost balanced parentheses (so nested template literals / objects with
 * their own parens are captured intact).
 */
const extractFetchCalls = (source: string): readonly string[] => {
	const calls: string[] = []
	const needle = "fetch("
	let i = 0
	while (true) {
		const start = source.indexOf(needle, i)
		if (start === -1) break
		// Reject member calls we don't care about (e.g. `prefetch(` / `.fetchFoo`)
		// by requiring `fetch(` to start a word boundary.
		const prevChar = start > 0 ? source[start - 1] : " "
		if (prevChar !== undefined && /[A-Za-z0-9_$]/.test(prevChar)) {
			i = start + needle.length
			continue
		}
		let depth = 0
		let j = start + needle.length - 1 // position of the opening "("
		for (; j < source.length; j++) {
			const ch = source[j]
			if (ch === "(") depth++
			else if (ch === ")") {
				depth--
				if (depth === 0) {
					j++
					break
				}
			}
		}
		calls.push(source.slice(start, j))
		i = j
	}
	return calls
}

/**
 * A fetch call targets the local API when its URL references "/api", or when it
 * is built via the analytics `buildQuery(...)` helper (which assembles
 * `/api/analytics/...` URLs with no literal "/api" in the call text).
 */
const targetsApi = (call: string): boolean => call.includes("/api") || /\bbuildQuery\s*\(/.test(call)

const AUTH_MARKERS = [
	/\bauthHeaders\s*\(/, // lib/api.ts producer
	/\bgetTokenHeader\s*\(/, // lib/settings.ts producer
	/Authorization/, // inline Bearer header
	// Property-shorthand only — a token-bearing `headers` variable passed as
	// `{ headers }` / `{ signal, headers }` (e.g. live-store). This deliberately
	// does NOT match `headers: { "Content-Type": ... }`, so a raw POST that sets
	// Content-Type but forgets the token spread is still flagged (FE-35 class).
	/\bheaders\s*[},]/,
]

const hasAuthMarker = (call: string): boolean => AUTH_MARKERS.some((re) => re.test(call))

describe("raw /api fetch auth headers (FE-35 regression)", () => {
	const apiCalls = walk(CLIENT_DIR).flatMap((file) =>
		extractFetchCalls(readFileSync(file, "utf-8"))
			.filter(targetsApi)
			.map((call) => ({ file, call })),
	)

	test("the gate actually finds raw /api fetch calls to guard (positive control)", () => {
		// If this drops to 0 the scan is broken (path moved / regex rotted) and the
		// auth assertion below would pass vacuously.
		expect(apiCalls.length).toBeGreaterThan(0)
	})

	test("every raw fetch('/api') carries an auth-header marker", () => {
		const offenders = apiCalls
			.filter(({ call }) => !hasAuthMarker(call))
			.map(({ file, call }) => `${file}: ${call.replace(/\s+/g, " ").slice(0, 120)}`)
		expect(offenders).toEqual([])
	})
})

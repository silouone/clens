import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

// Regression guard for bug B7 (specs/revive/bug-register.md): the client
// hydrated live sessions with `limit=10000` while the events endpoint caps
// limit at 1000 — every hydration request 400'd and was silently swallowed.
// Pins the contract from both sides: the server cap, and that no client code
// hardcodes a limit above it.

const SERVER_EVENTS_LIMIT_CAP = 1000

const CLIENT_DIR = resolve(import.meta.dir, "../../src/client")
const SESSIONS_ROUTE = resolve(import.meta.dir, "../../src/server/routes/sessions.ts")

const walk = (dir: string): readonly string[] =>
	readdirSync(dir).flatMap((name) => {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) return walk(full)
		return /\.(ts|tsx)$/.test(name) ? [full] : []
	})

describe("events endpoint limit contract (B7 regression)", () => {
	test("server events route still caps limit at the pinned value", () => {
		const source = readFileSync(SESSIONS_ROUTE, "utf-8")
		// the /events handler validates: parseIntParam(c.req.query("limit"), 100, 1, 1000)
		const eventsHandler = source.slice(source.indexOf('"/:sessionId/events"'))
		const match = eventsHandler.match(/parseIntParam\(c\.req\.query\("limit"\),\s*\d+,\s*\d+,\s*(\d+)\)/)
		expect(match).not.toBeNull()
		expect(Number(match?.[1])).toBe(SERVER_EVENTS_LIMIT_CAP)
	})

	test("no client code requests an events page larger than the server cap", () => {
		const offenders = walk(CLIENT_DIR).flatMap((file) => {
			const source = readFileSync(file, "utf-8")
			return [...source.matchAll(/\/events\?[^`"']*limit=(\d+)/g)]
				.filter((m) => Number(m[1]) > SERVER_EVENTS_LIMIT_CAP)
				.map((m) => `${file}: ${m[0]}`)
		})
		expect(offenders).toEqual([])
	})

	test("no client code hardcodes limit=10000 anywhere", () => {
		const offenders = walk(CLIENT_DIR).flatMap((file) => {
			const source = readFileSync(file, "utf-8")
			return source.includes("limit=10000") ? [file] : []
		})
		expect(offenders).toEqual([])
	})
})

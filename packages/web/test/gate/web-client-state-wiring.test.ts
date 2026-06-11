import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Source-pin regression guards for three web-client-state bugs whose modules
// can't be unit-imported under bun (live-store.ts / events.ts / SessionDetail.tsx
// transitively import api.ts, which touches `window` at module load and crashes
// the test runtime). We pin the load-bearing source lines instead — the same
// pattern the B7/B17 gate tests use.

const CLIENT = resolve(import.meta.dir, "../../src/client")
const read = (rel: string) => readFileSync(resolve(CLIENT, rel), "utf-8")

// ── redistill-sse-signal-equality-no-retrigger ──────────────────────
// lastDistilledSessionId used Solid's default === equality, so re-distilling
// the SAME session twice wrote an identical session_id and notified no
// subscribers — a manual Re-analyze of an already-viewed session never
// refetched the detail. The fix creates the signal with { equals: false }.
describe("lastDistilledSessionId re-fires on identical session_id (redistill regression)", () => {
	const source = read("lib/events.ts")

	test("the distill-complete signal is created with equals:false", () => {
		// Match the destructuring assignment through to the equals:false option,
		// allowing arbitrary whitespace/newlines between the args.
		const pattern = /\[\s*lastDistilledSessionId\s*,\s*setLastDistilledSessionId\s*\]\s*=\s*createSignal<string \| undefined>\(\s*undefined\s*,\s*\{\s*equals:\s*false\s*\}\s*,?\s*\)/
		expect(pattern.test(source)).toBe(true)
	})

	test("the distill-complete handler still sets the session_id", () => {
		expect(source).toContain("setLastDistilledSessionId(data.session_id)")
	})
})

// ── live-store-userprompt-reads-text-not-prompt ─────────────────────
// processEvent read `event.data.text` for UserPromptSubmit, but real capture
// data stores the prompt under `data.prompt` (989/989 events across
// .clens/sessions). Every live user prompt rendered blank. The fix reads
// `data.prompt` (with a `data.text` legacy fallback).
describe("UserPromptSubmit reads data.prompt (live user-prompt regression)", () => {
	const source = read("lib/live-store.ts")
	// Isolate the UserPromptSubmit case body so we don't match `text` elsewhere.
	const start = source.indexOf('case "UserPromptSubmit"')
	const caseBody = source.slice(start, source.indexOf("case ", start + 1))

	test("the UserPromptSubmit case reads event.data.prompt", () => {
		expect(start).toBeGreaterThanOrEqual(0)
		expect(caseBody).toContain("event.data.prompt")
	})

	test("it no longer reads ONLY data.text (the broken key)", () => {
		// data.text may remain as a legacy fallback, but data.prompt must be the
		// primary read — pin that prompt appears before any text fallback.
		const promptIdx = caseBody.indexOf("event.data.prompt")
		const textIdx = caseBody.indexOf("event.data.text")
		expect(promptIdx).toBeGreaterThanOrEqual(0)
		if (textIdx >= 0) expect(promptIdx).toBeLessThan(textIdx)
	})
})

// ── auto-distill-flag-never-resets-on-param-change ──────────────────
// autoDistillTriggered was a bare boolean set once and never reset; a single
// reused SessionDetail instance (params.id changes without remount) would then
// suppress auto-distill for every subsequent session forever. The fix tracks
// the triggered session id and derives alreadyTriggered from whether it still
// equals params.id, which resets automatically on navigation.
describe("auto-distill guard resets on params.id change (instance-reuse regression)", () => {
	const source = read("pages/SessionDetail.tsx")

	test("the trigger state is an id, not a bare boolean flag", () => {
		expect(source).toContain("setAutoDistilledId")
		expect(source).not.toContain("setAutoDistillTriggered")
	})

	test("alreadyTriggered is derived from the triggered id matching params.id", () => {
		expect(source).toContain("alreadyTriggered: autoDistilledId() === params.id")
	})

	test("the triggered id is recorded as params.id when auto-distill fires", () => {
		expect(source).toContain("setAutoDistilledId(params.id)")
	})
})

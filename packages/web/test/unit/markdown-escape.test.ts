import { describe, expect, test } from "bun:test"
import { escapeMarkdown, renderMarkdown, renderPlainText } from "../../src/client/lib/markdown"

// Regression guards for bug B16 (specs/revive/bug-register.md): markdown was
// applied to RAW text (user prompts, file paths, model ids, error text), so
// `claude-fable-5[1m]` rendered as a broken link ("claude-fable-51m") and
// underscores in file paths rendered as italics. Raw values must survive
// VERBATIM. Two surfaces:
//   - renderPlainText  -> for fields that are entirely raw (the REQUEST panel)
//   - escapeMarkdown   -> to neutralize a raw value interpolated into genuine
//                          markdown (e.g. a model name inside a narrative)

const MODEL = "claude-fable-5[1m]"
const PATH = "src/_internal_/foo_bar_baz.ts"

describe("renderPlainText (raw REQUEST panel text)", () => {
	test("model id with [1m] is not turned into a link", () => {
		const html = renderPlainText(`Use ${MODEL} please`)
		expect(html).toContain("claude-fable-5[1m]")
		expect(html).not.toContain("<a ")
		expect(html).not.toContain("href")
	})

	test("underscored file path is not italicized", () => {
		const html = renderPlainText(`Edit ${PATH}`)
		expect(html).toContain("src/_internal_/foo_bar_baz.ts")
		expect(html).not.toContain("<em>")
	})

	test("newlines become <br> so multi-line prompts read correctly", () => {
		expect(renderPlainText("line one\nline two")).toBe("line one<br>line two")
	})

	test("HTML is escaped (no XSS)", () => {
		const html = renderPlainText("<script>alert(1)</script>")
		expect(html).not.toContain("<script>")
		expect(html).toContain("&lt;script&gt;")
	})
})

describe("escapeMarkdown (raw value interpolated into markdown)", () => {
	test("escaped [1m] survives markdown rendering verbatim (no link)", () => {
		const html = renderMarkdown(`Ran with ${escapeMarkdown(MODEL)} today`)
		expect(html).not.toContain("<a ")
		expect(html).not.toContain("href=\"undefined\"")
		// the literal bracket survives as an HTML entity (renders as "[" / "]")
		expect(html).toContain("&#91;1m&#93;")
	})

	test("escaped underscores survive markdown rendering verbatim (no italics)", () => {
		const html = renderMarkdown(`Edited ${escapeMarkdown(PATH)} today`)
		expect(html).not.toContain("<em>")
		expect(html).toContain("&#95;internal&#95;")
	})

	test("escaping does not break surrounding genuine markdown", () => {
		const html = renderMarkdown(`This is **bold** next to ${escapeMarkdown(MODEL)}`)
		expect(html).toContain("<strong>bold</strong>")
		expect(html).toContain("&#91;1m&#93;")
	})

	test("escaping is HTML-safe (no raw angle brackets injected)", () => {
		const html = renderMarkdown(escapeMarkdown("<img src=x onerror=1>"))
		expect(html).not.toContain("<img")
	})
})

describe("renderMarkdown still renders genuine markdown", () => {
	test("real links and emphasis are preserved for actual markdown prose", () => {
		const html = renderMarkdown("See [docs](https://example.com) and *emphasis*.")
		expect(html).toContain('href="https://example.com"')
		expect(html).toContain("<em>emphasis</em>")
	})
})

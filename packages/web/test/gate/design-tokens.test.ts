import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression guard for B13 (`--clens-surface: é#fafaf9;`): an invalid token
// value falls back silently in the browser, so only a source-level lint
// catches the corruption. Validates every --clens-* declaration in index.css.

const CSS_PATH = resolve(import.meta.dir, "../../src/client/index.css");

const TOKEN_RE = /--clens-[\w-]+\s*:\s*([^;]+);/g;

/** Accepted value shapes for design tokens. */
const VALID_VALUE = new RegExp(
	[
		/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.source, // hex colors
		/^theme\("[^"]+"\)$/.source, // tailwind theme() refs
		/^(?:rgb|rgba|hsl|hsla|oklch|color-mix)\(.+\)$/.source, // css color functions
		/^var\(--[\w-]+(?:,\s*[^)]+)?\)$/.source, // var() refs
		/^-?\d+(?:\.\d+)?(?:px|rem|em|%|ms|s|vh|vw)?$/.source, // numbers/lengths
		/^(?:none|transparent|currentColor|inherit)$/.source, // keywords
		/^[\d.]+(?:px|rem|em)?(?:\s+[\d.]+(?:px|rem|em)?)+$/.source, // shorthand lists (e.g. spacing pairs)
		/^(?:[-\d.]+(?:px)?\s+){2,4}(?:rgba?|hsla?)\(.+\)(?:,\s*(?:[-\d.]+(?:px)?\s+){2,4}(?:rgba?|hsla?)\(.+\))*$/
			.source, // box-shadow stacks
		/^['"][^'"]*['"](?:\s*,\s*['"]?[\w\s-]+['"]?)*$/.source, // font stacks
	].join("|"),
);

describe("design token lint (index.css)", () => {
	const css = readFileSync(CSS_PATH, "utf-8");
	const tokens = [...css.matchAll(TOKEN_RE)].map((m) => ({
		declaration: m[0],
		value: m[1].trim(),
	}));

	test("token declarations exist", () => {
		expect(tokens.length).toBeGreaterThan(10);
	});

	test("every --clens-* token has a syntactically valid value", () => {
		const invalid = tokens.filter((t) => !VALID_VALUE.test(t.value));
		expect(
			invalid.map((t) => t.declaration),
			`Invalid token values found (stray characters corrupt silently in the browser)`,
		).toEqual([]);
	});

	test("no token value contains non-ASCII garbage", () => {
		// The B13 corruption was a stray 'é' prefix before a hex color.
		const garbage = tokens.filter((t) => /[^\x20-\x7E]/.test(t.value));
		expect(garbage.map((t) => t.declaration)).toEqual([]);
	});
});

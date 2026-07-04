import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Glob } from "bun";

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

// ── LOCKED INSTRUMENT palette (TEST-6) ──────────────────────────────
// The previous gate validated token *syntax* only — a designer could swap
// the signal green for blue and the gate stayed green. The INSTRUMENT
// direction (instrument-design-direction / SHARED-CONTEXT.md) locks five
// hex values; pin each to its theme block so a palette drift fails the build.
//   light paper      #F7F7F5   (:root --clens-surface)
//   light ink        #1A1C1B   (:root --clens-text-primary)
//   dark instrument  #0A0C0B   (.dark  --clens-surface)
//   dark phosphor    #C8D1CC   (.dark  --clens-text-primary)
//   phosphor green   #33FF99   (.dark  --clens-brand / accent / live)

const css = readFileSync(CSS_PATH, "utf-8");

/** Extract a `selector { ... }` block body (no nested braces in token blocks). */
function blockBody(selector: string): string {
	const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
	const m = css.match(re);
	if (!m) throw new Error(`Block ${selector} not found in index.css`);
	return m[1];
}

/** Map of `--clens-*` token name → uppercased value within a block. */
function blockTokens(selector: string): Map<string, string> {
	const body = blockBody(selector);
	const out = new Map<string, string>();
	for (const m of body.matchAll(/(--clens-[\w-]+)\s*:\s*([^;]+);/g)) {
		out.set(m[1], m[2].trim().toUpperCase());
	}
	return out;
}

describe("locked INSTRUMENT palette (index.css)", () => {
	const root = blockTokens(":root");
	const dark = blockTokens(".dark");

	// token→hex assertions are case-insensitive: `#f7f7f5` is the SAME color,
	// not a change; only a different hex (a real drift) must fail.
	const cases: Array<[Map<string, string>, string, string, string]> = [
		[root, ":root", "--clens-surface", "#F7F7F5"],
		[root, ":root", "--clens-text-primary", "#1A1C1B"],
		[dark, ".dark", "--clens-surface", "#0A0C0B"],
		[dark, ".dark", "--clens-text-primary", "#C8D1CC"],
		[dark, ".dark", "--clens-brand", "#33FF99"],
	];

	for (const [tokens, scope, name, hex] of cases) {
		test(`${scope} ${name} === ${hex}`, () => {
			expect(tokens.get(name)).toBe(hex);
		});
	}

	test("phosphor green is the dark accent / live / success token", () => {
		// One accent: signal green for live/active/ok. In dark mode that accent
		// is phosphor green across the live-state tokens — guard them together.
		expect(dark.get("--clens-accent")).toBe("#33FF99");
		expect(dark.get("--clens-success")).toBe("#33FF99");
		expect(dark.get("--clens-live")).toBe("#33FF99");
	});

	test("the token→value check rejects a drifted hex (guard bites)", () => {
		// Proof the assertion would FAIL on a one-digit drift, not just pass today.
		expect(dark.get("--clens-brand")).not.toBe("#33FF98");
	});
});

// ── Banned drop-shadow / pill idioms (TEST-6) ───────────────────────
// INSTRUMENT = square corners, hairline rules, NO shadows; separation by
// 1px lines only. The carve-outs are deliberate and must NOT be flagged:
//   • box-shadow: 0 0 0 1px … (inset/outline RINGS — hairlines, not depth)
//   • shadow-[inset_2px_0_0_0_…] (Tailwind arbitrary inset left-rule)
//   • rounded-full on the ColorFlag swatch (a status/color DOT)
// What IS banned: elevation drop shadows (shadow / shadow-sm…2xl / inner)
// and `rounded-full` anywhere else (pill chips break square-corner rule).

const CLIENT_DIR = resolve(import.meta.dir, "../../src/client");

/** All authored client source, excluding the captured `logs/` JSONL dumps. */
function clientSourceFiles(): string[] {
	const glob = new Glob("**/*.{ts,tsx,css}");
	return [...glob.scanSync({ cwd: CLIENT_DIR, absolute: true })].filter(
		(p) => !p.includes("/logs/"),
	);
}

// A banned class token is delimited by quote/space/backtick on both sides so
// `box-shadow`/`inset-shadow` (prefixed by `-`) in comments and the allowed
// `shadow-[inset_…]` arbitrary utility (followed by `-[`) do NOT match.
const BANNED_SHADOW = /(?<=["'\s`])shadow(?:-(?:sm|md|lg|xl|2xl|inner))?(?=["'\s`])/;
const BANNED_ROUNDED_FULL = /(?<=["'\s`])rounded-full(?=["'\s`])/;

/** Files allowed to use rounded-full (status / color dots). */
const ROUNDED_FULL_ALLOWED = /\/ColorFlag\.tsx$/;

describe("banned INSTRUMENT idioms (client source)", () => {
	const files = clientSourceFiles();

	test("source tree was discovered", () => {
		expect(files.length).toBeGreaterThan(20);
	});

	test("no elevation drop-shadow Tailwind utilities", () => {
		const offenders = files.filter((f) => BANNED_SHADOW.test(readFileSync(f, "utf-8")));
		expect(
			offenders,
			"INSTRUMENT forbids drop shadows; use a 1px hairline (inset shadow-[…] or border) instead",
		).toEqual([]);
	});

	test("rounded-full confined to status/color dots (ColorFlag)", () => {
		const offenders = files.filter(
			(f) => !ROUNDED_FULL_ALLOWED.test(f) && BANNED_ROUNDED_FULL.test(readFileSync(f, "utf-8")),
		);
		expect(
			offenders,
			"INSTRUMENT uses square corners (≤2px); pill shapes are reserved for status dots",
		).toEqual([]);
	});

	test("index.css box-shadows are hairline rings, never depth", () => {
		// Every box-shadow layer must be `none` or zero-offset/zero-blur (a ring).
		const offenders: string[] = [];
		for (const m of css.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
			const value = m[1].trim();
			if (value === "none") continue;
			// Collapse parenthesized groups (color-mix/rgba contain commas) so we
			// can split the value into top-level shadow layers safely.
			let flat = value;
			let prev: string;
			do {
				prev = flat;
				flat = flat.replace(/\([^()]*\)/g, "");
			} while (flat !== prev);
			for (const layer of flat.split(",")) {
				const t = layer.trim().replace(/^inset\s+/, "");
				// First three tokens = offset-x, offset-y, blur — all must be 0.
				if (!/^0\s+0\s+0(\s|$)/.test(t)) offenders.push(layer.trim());
			}
		}
		expect(offenders, "box-shadow with offset/blur is a banned drop shadow").toEqual([]);
	});

	test("the idiom discriminators bite (guard self-check)", () => {
		// Banned named-elevation utilities are caught …
		expect(BANNED_SHADOW.test('class="shadow-lg"')).toBe(true);
		expect(BANNED_SHADOW.test('class="card shadow"')).toBe(true);
		expect(BANNED_SHADOW.test('class="shadow-inner p-2"')).toBe(true);
		// … while the allowed inset hairline rule and comment prose are NOT.
		expect(BANNED_SHADOW.test('class="shadow-[inset_2px_0_0_0_var(--clens-brand)]"')).toBe(false);
		expect(BANNED_SHADOW.test("// use a left BORDER not box-shadow for the flag")).toBe(false);
		// rounded-full is caught as a standalone class token.
		expect(BANNED_ROUNDED_FULL.test('class="h-2 w-2 rounded-full"')).toBe(true);
		expect(BANNED_ROUNDED_FULL.test('class="rounded-md border"')).toBe(false);
	});
});

// ── LOCKED semantic category palette (overview-moat-refactor) ────────
// The Overview moat refactor adds an ADDITIVE semantic accent palette: one
// restrained hue per signal category (timing / cost / risk / context /
// outcome / edits / comms / agents), defined in BOTH themes. Per constraint
// C1 the 5 base assertions above are untouched; these are NEW locked
// assertions so a future palette drift fails the build just like the base.
//
// IMPORTANT — the category palette DELIBERATELY REUSES existing base / status
// / flag hues as coordinated instrument channels (it is not a second
// rainbow). These collisions are INTENTIONAL and must NOT be asserted as
// "distinct from base":
//   outcome  == --clens-brand / --clens-success / --clens-flag-green
//               (dark outcome #33FF99 == the LOCKED dark brand value)
//   cost     == --clens-warning / --clens-flag-amber
//   risk     == --clens-danger  (dark also == --clens-flag-red)
//   context  == --clens-flag-violet
//   edits    == --clens-flag-blue
// The meaningful guards therefore are: (1) each category token is pinned to
// its exact hex per theme, (2) the 8 category tokens are mutually distinct
// within a theme (no two channels collapse to the same color), and (3) no
// category token collides with a LOCKED readability anchor (surface /
// text-primary) — the one collision that would actually break legibility.

describe("locked category palette (index.css)", () => {
	const root = blockTokens(":root");
	const dark = blockTokens(".dark");

	const CAT_KEYS = [
		"timing",
		"cost",
		"risk",
		"context",
		"outcome",
		"edits",
		"comms",
		"agents",
	] as const;

	// Exact per-theme hex pins. A one-digit drift must fail (mirrors the base
	// guard's intent). Case-insensitive via the uppercasing in blockTokens.
	const lightHex: Readonly<Record<string, string>> = {
		"--clens-cat-timing": "#0E7C7B",
		"--clens-cat-cost": "#9A6700",
		"--clens-cat-risk": "#B42318",
		"--clens-cat-context": "#6B4A9A",
		"--clens-cat-outcome": "#0A8754",
		"--clens-cat-edits": "#2C5E8A",
		"--clens-cat-comms": "#1E7A8C",
		"--clens-cat-agents": "#4A5B9A",
	};
	const darkHex: Readonly<Record<string, string>> = {
		"--clens-cat-timing": "#4FD6C9",
		"--clens-cat-cost": "#FFB000",
		"--clens-cat-risk": "#FF6B5E",
		"--clens-cat-context": "#B08AE0",
		"--clens-cat-outcome": "#33FF99",
		"--clens-cat-edits": "#5EA8E0",
		"--clens-cat-comms": "#5FD0E0",
		"--clens-cat-agents": "#8A9AE0",
	};

	CAT_KEYS.forEach((key) => {
		const name = `--clens-cat-${key}`;
		test(`:root ${name} === ${lightHex[name]}`, () => {
			expect(root.get(name)).toBe(lightHex[name]);
		});
		test(`.dark ${name} === ${darkHex[name]}`, () => {
			expect(dark.get(name)).toBe(darkHex[name]);
		});
	});

	const catValues = (tokens: Map<string, string>): string[] =>
		CAT_KEYS.map((k) => tokens.get(`--clens-cat-${k}`)).filter((v): v is string => v !== undefined);

	test("all 8 category tokens are present in both themes", () => {
		expect(catValues(root).length).toBe(8);
		expect(catValues(dark).length).toBe(8);
	});

	test("category channels are mutually distinct within :root (no two collapse)", () => {
		const values = catValues(root);
		expect(new Set(values).size).toBe(values.length);
	});

	test("category channels are mutually distinct within .dark (no two collapse)", () => {
		const values = catValues(dark);
		expect(new Set(values).size).toBe(values.length);
	});

	test("no category token collides with a LOCKED readability anchor", () => {
		// The readability anchors are the surfaces and primary text — a category
		// hue equal to one of these would be invisible on/against it. (Collisions
		// with brand/status/flag tokens are intentional channel reuse, NOT checked.)
		const lightAnchors = new Set([root.get("--clens-surface"), root.get("--clens-text-primary")]);
		const darkAnchors = new Set([dark.get("--clens-surface"), dark.get("--clens-text-primary")]);
		expect(catValues(root).filter((v) => lightAnchors.has(v))).toEqual([]);
		expect(catValues(dark).filter((v) => darkAnchors.has(v))).toEqual([]);
	});

	test("the category hex pin rejects a drift (guard bites)", () => {
		// Proof the pin would FAIL on a one-digit drift, not just pass today.
		expect(dark.get("--clens-cat-risk")).not.toBe("#FF6B5F");
		expect(root.get("--clens-cat-timing")).not.toBe("#0E7C7C");
	});
});

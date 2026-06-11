import snarkdown from "snarkdown";

/** Escape HTML entities to prevent XSS */
const escapeHtml = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/**
 * Render markdown to HTML.
 *
 * Extracts fenced code blocks as placeholders first (so snarkdown doesn't
 * mangle them), runs snarkdown on the rest, then re-inserts the blocks.
 */
export const renderMarkdown = (text: string): string => {
	const placeholder = (i: number) => `\x00CODEBLOCK${i}\x00`;

	// 1. Extract fenced code blocks
	const blocks: string[] = [];
	const stripped = text.replace(/```[\s\S]*?```/g, (match) => {
		const inner = match.slice(3, -3).replace(/^\w*\n?/, "");
		blocks.push(`<pre><code>${escapeHtml(inner.trim())}</code></pre>`);
		return placeholder(blocks.length - 1);
	});

	// 2. Run snarkdown on the remaining text
	const rendered = snarkdown(stripped);

	// 3. Re-insert code blocks
	return blocks.reduce(
		(html, block, i) => html.replace(placeholder(i), block),
		rendered,
	);
};

/**
 * Render untrusted/raw text (user prompts, file paths, model ids, error text)
 * VERBATIM as HTML. No markdown syntax is interpreted — only HTML entities are
 * escaped — so that strings like `claude-fable-5[1m]` and `_path_underscores_`
 * survive intact (bug B16). Newlines become <br> so multi-line prompts still
 * read correctly.
 */
export const renderPlainText = (text: string): string =>
	escapeHtml(text).replace(/\r?\n/g, "<br>");

/**
 * HTML-entity substitutions for the characters snarkdown treats as markdown
 * structure. Encoding them as entities (rather than backslash-escaping) means
 * snarkdown passes them through untouched and the browser renders them as the
 * literal character — snarkdown does NOT strip backslash escapes, so `\[` would
 * leak a visible backslash.
 */
const MARKDOWN_ENTITY_MAP: Readonly<Record<string, string>> = {
	"[": "&#91;",
	"]": "&#93;",
	"(": "&#40;",
	")": "&#41;",
	"_": "&#95;",
	"*": "&#42;",
	"`": "&#96;",
	"~": "&#126;",
	"#": "&#35;",
	"|": "&#124;",
	"!": "&#33;",
	"<": "&lt;",
	">": "&gt;",
	"&": "&amp;",
	"\\": "&#92;",
};

/**
 * Neutralize markdown special characters in a raw value so it can be safely
 * interpolated into otherwise-markdown content (e.g. a model name or file path
 * inside an assistant narrative) without being reinterpreted as a link,
 * emphasis, code span, etc. The escaped value renders identically to the
 * literal text — strings like `claude-fable-5[1m]` and `_path_underscores_`
 * survive verbatim (bug B16).
 */
export const escapeMarkdown = (text: string): string =>
	text.replace(/[\[\]()_*`~#|!<>&\\]/g, (ch) => MARKDOWN_ENTITY_MAP[ch] ?? ch);

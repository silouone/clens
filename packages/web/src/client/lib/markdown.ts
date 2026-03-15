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
	const blocks: string[] = [];
	const placeholder = (i: number) => `\x00CODEBLOCK${i}\x00`;

	// 1. Extract fenced code blocks
	const stripped = text.replace(/```[\s\S]*?```/g, (match) => {
		const inner = match.slice(3, -3).replace(/^\w*\n?/, "");
		blocks.push(`<pre><code>${escapeHtml(inner.trim())}</code></pre>`);
		return placeholder(blocks.length - 1);
	});

	// 2. Run snarkdown on the remaining text
	let html = snarkdown(stripped);

	// 3. Re-insert code blocks
	for (let i = 0; i < blocks.length; i++) {
		html = html.replace(placeholder(i), blocks[i]);
	}

	return html;
};

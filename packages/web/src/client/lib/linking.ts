import { createSignal, type Accessor } from "solid-js";
import type { ConversationEntry } from "@clens/cli";

// ── Types ────────────────────────────────────────────────────────────

type BidirectionalLink = {
	/** File path that DiffPanel should scroll to + expand */
	readonly highlightedFile: Accessor<string | undefined>;

	/** File path that ConversationPanel should scroll to (first matching tool_call) */
	readonly scrollToFileInConversation: Accessor<string | undefined>;

	/** Element selector currently flashing — consumed via data attribute matching */
	readonly flashSelector: Accessor<string | undefined>;

	/**
	 * Called from ConversationPanel when a tool_call (Edit/Write) is clicked.
	 * Resolves tool_use_id → file_path → triggers DiffPanel scroll.
	 */
	readonly handleToolClick: (toolUseId: string) => void;

	/**
	 * Called from DiffPanel when a file row is clicked.
	 * Triggers ConversationPanel scroll to first tool_call touching that file.
	 */
	readonly handleFileClick: (filePath: string) => void;

	/** Clear all highlights */
	readonly clearHighlights: () => void;
};

// ── Constants ────────────────────────────────────────────────────────

const FLASH_DURATION_MS = 1200;

// ── Hook ─────────────────────────────────────────────────────────────

/**
 * Creates bidirectional linking state between ConversationPanel and DiffPanel.
 *
 * @param entries - Reactive accessor for conversation entries (used to build tool→file index)
 */
const createBidirectionalLink = (
	entries: Accessor<readonly ConversationEntry[]>,
): BidirectionalLink => {
	const [highlightedFile, setHighlightedFile] = createSignal<string | undefined>(undefined);
	const [scrollToFileInConversation, setScrollToFileInConversation] = createSignal<string | undefined>(undefined);
	const [flashSelector, setFlashSelector] = createSignal<string | undefined>(undefined);

	const flash = (selector: string): void => {
		setFlashSelector(selector);
		setTimeout(() => setFlashSelector(undefined), FLASH_DURATION_MS);
	};

	const handleToolClick = (toolUseId: string): void => {
		// Find the file_path for this tool_use_id from conversation entries
		const entry = entries().find(
			(e) => e.type === "tool_call" && e.tool_use_id === toolUseId,
		);
		if (entry?.type !== "tool_call" || !entry.file_path) return;

		setHighlightedFile(entry.file_path);
		flash(`[data-file-path="${entry.file_path}"]`);
	};

	const handleFileClick = (filePath: string): void => {
		setScrollToFileInConversation(filePath);
		// Find first tool_call touching this file to flash it
		const entry = entries().find(
			(e) => e.type === "tool_call" && e.file_path === filePath,
		);
		if (entry?.type === "tool_call") {
			flash(`[data-tool-use-id="${entry.tool_use_id}"]`);
		}
	};

	const clearHighlights = (): void => {
		setHighlightedFile(undefined);
		setScrollToFileInConversation(undefined);
		setFlashSelector(undefined);
	};

	return {
		highlightedFile,
		scrollToFileInConversation,
		flashSelector,
		handleToolClick,
		handleFileClick,
		clearHighlights,
	};
};

export { createBidirectionalLink, FLASH_DURATION_MS };
export type { BidirectionalLink };

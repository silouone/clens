import type { TranscriptContentBlock, TranscriptEntry, TranscriptReasoning } from "../types";

const THINKING_TRUNCATE_LIMIT = 5000;

const classifyIntent = (thinking: string): TranscriptReasoning["intent_hint"] => {
	const lower = thinking.toLowerCase();
	if (/\b(error|fix|bug|fail|crash|broken|issue|wrong|debug)\b/.test(lower)) return "debugging";
	if (/\b(plan|approach|strategy|design|architect|phase|step)\b/.test(lower)) return "planning";
	if (/\b(search|look up|check|investigate|find|read|explore)\b/.test(lower)) return "research";
	if (/\b(should|decide|option|choose|between|alternative|trade.?off)\b/.test(lower))
		return "deciding";
	return "general";
};

const findCorrelatedToolInBlocks = (
	blocks: readonly TranscriptContentBlock[],
	startIndex: number,
): { id: string; name: string } | undefined => {
	const toolBlock = blocks.slice(startIndex + 1).find((b) => b.type === "tool_use");
	return toolBlock?.type === "tool_use" ? { id: toolBlock.id, name: toolBlock.name } : undefined;
};

const findCorrelatedTool = (
	entries: readonly TranscriptEntry[],
	entryIndex: number,
	blocks: readonly TranscriptContentBlock[],
	blockIndex: number,
): { id: string; name: string } | undefined => {
	// First try within the same message (co-located thinking + tool_use)
	const sameMessage = findCorrelatedToolInBlocks(blocks, blockIndex);
	if (sameMessage) return sameMessage;

	// Otherwise scan forward for the next assistant entry with tool_use blocks
	const nextAssistant = entries.slice(entryIndex + 1).find(
		(e) =>
			e.type === "assistant" &&
			Array.isArray(e.message?.content) &&
			e.message.content.some((b) => b.type === "tool_use"),
	);
	if (!nextAssistant || !Array.isArray(nextAssistant.message?.content)) return undefined;

	const toolBlock = nextAssistant.message.content.find((b) => b.type === "tool_use");
	return toolBlock?.type === "tool_use" ? { id: toolBlock.id, name: toolBlock.name } : undefined;
};

export const extractReasoning = (entries: readonly TranscriptEntry[]): TranscriptReasoning[] =>
	entries.flatMap((entry, entryIndex): TranscriptReasoning[] => {
		if (entry.type !== "assistant" || !entry.message?.content) return [];
		if (!Array.isArray(entry.message.content)) return [];

		const t = new Date(entry.timestamp).getTime();
		const blocks = entry.message.content;

		return blocks.flatMap((block, blockIndex): TranscriptReasoning[] => {
			if (block.type !== "thinking") return [];

			const correlated = findCorrelatedTool(entries, entryIndex, blocks, blockIndex);
			const truncated = block.thinking.length > THINKING_TRUNCATE_LIMIT;

			return [
				{
					t,
					thinking: block.thinking.slice(0, THINKING_TRUNCATE_LIMIT),
					tool_use_id: correlated?.id,
					tool_name: correlated?.name,
					intent_hint: classifyIntent(block.thinking),
					truncated,
				},
			];
		});
	});

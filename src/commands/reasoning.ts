import type { DistilledSession } from "../types/distill";
import type { TranscriptReasoning } from "../types/transcript";
import { fmtTime } from "./format-helpers";
import { bold, cyan, dim, green, yellow } from "./shared";

const INTENT_TYPES = ["planning", "debugging", "research", "deciding", "general"] as const;

/**
 * Count items matching a predicate in an array.
 */
const countWhere = <T>(arr: readonly T[], pred: (item: T) => boolean): number =>
	arr.reduce((acc, item) => acc + (pred(item) ? 1 : 0), 0);

/**
 * Build intent distribution: count and percentage per intent type.
 */
const buildIntentDistribution = (
	blocks: readonly TranscriptReasoning[],
): readonly { readonly intent: string; readonly count: number; readonly pct: string }[] => {
	const total = blocks.length;
	if (total === 0) return [];

	const knownIntents = INTENT_TYPES.map((intent) => {
		const count = countWhere(blocks, (b) => b.intent_hint === intent);
		const pct = ((count / total) * 100).toFixed(1);
		return { intent, count, pct } as const;
	});

	const unknownCount = countWhere(blocks, (b) => b.intent_hint === undefined);
	const unknownPct = ((unknownCount / total) * 100).toFixed(1);

	return unknownCount > 0
		? [...knownIntents, { intent: "unknown", count: unknownCount, pct: unknownPct }]
		: knownIntents;
};

/**
 * Render a summary of reasoning blocks from a distilled session.
 */
export const renderReasoningSummary = (distilled: DistilledSession): string => {
	const blocks = distilled.reasoning;
	const sessionPrefix = distilled.session_id.slice(0, 8);

	const header = bold(`Session ${sessionPrefix} -- Reasoning Analysis`);

	const blockCount = `Block count: ${blocks.length}`;
	const truncatedCount = `Truncated: ${countWhere(blocks, (b) => b.truncated === true)}`;

	const distribution = buildIntentDistribution(blocks);
	const intentHeader = bold("Intent distribution:");
	const intentLines = distribution.map(
		({ intent, count, pct }) => `  ${cyan(intent.padEnd(12))} ${String(count).padStart(4)}  (${pct}%)`,
	);

	const withTool = countWhere(blocks, (b) => b.tool_use_id !== undefined);
	const standalone = blocks.length - withTool;
	const correlationHeader = bold("Tool correlations:");
	const correlationLines = [
		`  ${green("with tool".padEnd(12))} ${String(withTool).padStart(4)}`,
		`  ${yellow("standalone".padEnd(12))} ${String(standalone).padStart(4)}`,
	];

	return [
		header,
		"",
		blockCount,
		truncatedCount,
		"",
		intentHeader,
		...intentLines,
		"",
		correlationHeader,
		...correlationLines,
	].join("\n");
};

/**
 * Render the full detail of each reasoning block.
 */
export const renderReasoningFull = (
	distilled: DistilledSession,
	intentFilter?: string,
): string => {
	const blocks = intentFilter
		? distilled.reasoning.filter((b) => b.intent_hint === intentFilter)
		: distilled.reasoning;

	if (blocks.length === 0) {
		return dim(
			intentFilter
				? `No reasoning blocks found with intent "${intentFilter}".`
				: "No reasoning blocks found.",
		);
	}

	const sessionPrefix = distilled.session_id.slice(0, 8);
	const header = bold(
		`Session ${sessionPrefix} -- ${blocks.length} reasoning block${blocks.length === 1 ? "" : "s"}${intentFilter ? ` (intent: ${intentFilter})` : ""}`,
	);

	const separator = dim("─".repeat(60));

	const renderedBlocks = blocks.map((block) => {
		const time = fmtTime(block.t);
		const intent = block.intent_hint ?? "unknown";
		const toolInfo = block.tool_name ? `tool: ${block.tool_name}` : "standalone";
		const truncatedSuffix = block.truncated === true ? ` ${yellow("[truncated]")}` : "";

		const metaLine = `${cyan(time)}  ${bold(intent.padEnd(12))} ${dim(toolInfo)}`;
		const thinkingText = `${block.thinking}${truncatedSuffix}`;

		return [metaLine, thinkingText].join("\n");
	});

	return [header, separator, ...renderedBlocks.flatMap((b) => [b, separator])].join("\n");
};


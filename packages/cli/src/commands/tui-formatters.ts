import { dirname } from "node:path";
import type {
	AgentLifetime,
	CommunicationEdge,
	CommunicationSequenceEntry,
	DecisionPoint,
	EditChain,
	FileDiffAttribution,
	GitDiffResult,
	TimelineEntry,
} from "../types";
import { formatDuration } from "../utils";
import { renderStep } from "./edits";

// --- ANSI escape helpers ---

const ESC = "\x1b";
const CSI = `${ESC}[`;

export const ansi = {
	enterAltScreen: `${CSI}?1049h`,
	leaveAltScreen: `${CSI}?1049l`,
	clearScreen: `${CSI}2J${CSI}H`,
	clearToEnd: `${CSI}J`,
	cursorHome: `${CSI}H`,
	hideCursor: `${CSI}?25l`,
	showCursor: `${CSI}?25h`,
	moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
	bold: (s: string) => `${CSI}1m${s}${CSI}0m`,
	dim: (s: string) => `${CSI}2m${s}${CSI}0m`,
	inverse: (s: string) => `${CSI}7m${s}${CSI}0m`,
	cyan: (s: string) => `${CSI}36m${s}${CSI}0m`,
	green: (s: string) => `${CSI}32m${s}${CSI}0m`,
	yellow: (s: string) => `${CSI}33m${s}${CSI}0m`,
	red: (s: string) => `${CSI}31m${s}${CSI}0m`,
	blue: (s: string) => `${CSI}34m${s}${CSI}0m`,
	magenta: (s: string) => `${CSI}35m${s}${CSI}0m`,
	clearLine: `${CSI}2K`,
} as const;

// --- Timeline color helper ---

export const colorizeTimelineType = (entry: TimelineEntry): string => {
	const label = entry.tool_name ? `${entry.type} [${entry.tool_name}]` : entry.type;
	switch (entry.type) {
		case "agent_spawn":
		case "agent_stop":
			return ansi.cyan(label);
		case "task_create":
		case "task_assign":
		case "task_complete":
			return ansi.green(label);
		case "failure":
			return ansi.red(label);
		case "thinking":
			return ansi.yellow(label);
		case "tool_call":
			return ansi.dim(label);
		case "phase_boundary":
			return ansi.bold(label);
		case "msg_send":
			return ansi.magenta(label);
		default:
			return label;
	}
};

// --- Edit chain suffix formatter ---

export const formatEditChainSuffix = (chain: EditChain | undefined): string => {
	if (!chain) return "";
	const abandoned = chain.abandoned_edit_ids.length;
	const parts = [
		...(abandoned > 0 ? [`${abandoned} abandoned`] : []),
		...(chain.has_backtrack ? ["backtrack"] : []),
	];
	return parts.length > 0
		? chain.has_backtrack
			? ansi.red(` [${parts.join(", ")}]`)
			: ` [${parts.join(", ")}]`
		: "";
};

// --- File grouping helper ---

export const groupFilesByDirectory = (
	files: readonly { file_path: string; reads: number; edits: number; writes: number }[],
	projectDir: string,
	editChainMap?: ReadonlyMap<string, EditChain>,
	agentMap?: ReadonlyMap<string, string>,
	agentNames?: readonly string[],
	highlightIndex?: number,
): readonly string[] => {
	const toRelative = (p: string): string =>
		p.startsWith(projectDir) ? p.slice(projectDir.length + 1) : p;

	const sorted = files
		.slice()
		.sort((a, b) => toRelative(a.file_path).localeCompare(toRelative(b.file_path)));

	const grouped = sorted.reduce(
		(acc, f) => {
			const rel = toRelative(f.file_path);
			const dir = dirname(rel);
			const name = rel.slice(dir === "." ? 0 : dir.length + 1);
			const entry = {
				name,
				reads: f.reads,
				edits: f.edits,
				writes: f.writes,
				file_path: f.file_path,
			};
			return {
				...acc,
				[dir]: [...(acc[dir] ?? []), entry],
			};
		},
		{} as Record<
			string,
			{ name: string; reads: number; edits: number; writes: number; file_path: string }[]
		>,
	);

	// Pre-compute cumulative file index offset for each directory group
	const groupEntries = Object.entries(grouped);
	const groupOffsets = groupEntries.reduce<readonly number[]>(
		(acc, [, entries], i) =>
			i === 0 ? [0] : [...acc, (acc[acc.length - 1] ?? 0) + groupEntries[i - 1][1].length],
		[0],
	);

	return groupEntries.flatMap(([dir, entries], groupIdx) => {
		const baseIdx = groupOffsets[groupIdx] ?? 0;
		const displayDir =
			dir === "." ? "./" : dir.length > 60 ? `\u2026${dir.slice(-59)}/` : `${dir}/`;
		const dirHeader = ansi.dim(displayDir);
		const fileLines = entries.map((f, i) => {
			const fileIdx = baseIdx + i;
			const isHighlighted = highlightIndex !== undefined && fileIdx === highlightIndex;
			const parts = [
				...(f.reads > 0 ? [`${f.reads}R`] : []),
				...(f.edits > 0 ? [`${f.edits}E`] : []),
				...(f.writes > 0 ? [`${f.writes}W`] : []),
			];
			const chainSuffix = editChainMap ? formatEditChainSuffix(editChainMap.get(f.file_path)) : "";
			const agentTag = agentMap?.get(f.file_path);
			const agentLabel = agentTag && agentNames ? ` ${colorizeAgent(agentTag, agentNames)}` : "";
			const lineStr = `    ${f.name.padEnd(30)} ${parts.join(" ")}${chainSuffix}${agentLabel}`;
			return isHighlighted ? ansi.inverse(lineStr) : lineStr;
		});
		return [dirHeader, ...fileLines];
	});
};

// --- File grouping by agent helper ---

export const groupFilesByAgent = (
	files: readonly { file_path: string; reads: number; edits: number; writes: number }[],
	projectDir: string,
	editChains: readonly EditChain[],
	agentNames: readonly string[],
	editChainMap?: ReadonlyMap<string, EditChain>,
	highlightIndex?: number,
): readonly string[] => {
	if (editChains.length === 0) return [];

	const toRelative = (p: string): string =>
		p.startsWith(projectDir) ? p.slice(projectDir.length + 1) : p;

	// Group editChains by agent_name (default to "session")
	const agentGroups = editChains.reduce(
		(acc, chain) => {
			const name = chain.agent_name ?? "session";
			return { ...acc, [name]: [...(acc[name] ?? []), chain] };
		},
		{} as Record<string, EditChain[]>,
	);

	// Sort groups by earliest timestamp (chronological agent appearance)
	const sortedGroups = Object.entries(agentGroups).sort(([, chainsA], [, chainsB]) => {
		const stepsA = chainsA.flatMap((c) => c.steps.map((s) => s.t));
		const stepsB = chainsB.flatMap((c) => c.steps.map((s) => s.t));
		const minTA = stepsA.length > 0 ? Math.min(...stepsA) : Infinity;
		const minTB = stepsB.length > 0 ? Math.min(...stepsB) : Infinity;
		return minTA - minTB;
	});

	// Pre-compute file counts per agent group for functional index tracking
	// Each agent group contributes N files; we need cumulative offsets
	const agentGroupData = sortedGroups.map(([agentName, agentChains]) => {
		const agentFilePaths = new Set(agentChains.map((c) => c.file_path));
		const agentFiles = files.filter((f) => agentFilePaths.has(f.file_path));
		return { agentName, agentChains, agentFiles };
	});

	const agentGroupOffsets = agentGroupData.reduce<readonly number[]>(
		(acc, _, i) =>
			i === 0
				? [0]
				: [...acc, (acc[acc.length - 1] ?? 0) + agentGroupData[i - 1].agentFiles.length],
		[0],
	);

	return agentGroupData.flatMap(({ agentName, agentChains, agentFiles }, groupIdx) => {
		const groupBaseIdx = agentGroupOffsets[groupIdx] ?? 0;

		const totalEdits = agentChains.reduce((sum, c) => sum + c.total_edits, 0);
		const fileCount = agentChains.length;
		const coloredName =
			agentName === "session" ? ansi.dim(agentName) : colorizeAgent(agentName, agentNames);
		const header = `▸ ${coloredName} (${totalEdits} edits, ${fileCount} files)`;

		// Skip agent group if no matching files
		if (agentFiles.length === 0) return [];

		// Group by directory within agent
		const sorted = agentFiles
			.slice()
			.sort((a, b) => toRelative(a.file_path).localeCompare(toRelative(b.file_path)));

		const grouped = sorted.reduce(
			(acc, f) => {
				const rel = toRelative(f.file_path);
				const dir = dirname(rel);
				const name = rel.slice(dir === "." ? 0 : dir.length + 1);
				return {
					...acc,
					[dir]: [
						...(acc[dir] ?? []),
						{ name, file_path: f.file_path, reads: f.reads, edits: f.edits, writes: f.writes },
					],
				};
			},
			{} as Record<
				string,
				{ name: string; file_path: string; reads: number; edits: number; writes: number }[]
			>,
		);

		// Pre-compute cumulative file offsets within this agent group's directory subgroups
		const dirEntries = Object.entries(grouped);
		const dirOffsets = dirEntries.reduce<readonly number[]>(
			(acc, _, i) =>
				i === 0 ? [0] : [...acc, (acc[acc.length - 1] ?? 0) + dirEntries[i - 1][1].length],
			[0],
		);

		const fileLines = dirEntries.flatMap(([dir, entries], dirIdx) => {
			const dirBaseIdx = groupBaseIdx + (dirOffsets[dirIdx] ?? 0);
			const displayDir = dir === "." ? "./" : `${dir}/`;
			const dirLine = `    ${ansi.dim(displayDir)}`;
			const entryLines = entries.map((f, i) => {
				const fileIdx = dirBaseIdx + i;
				const parts = [
					...(f.reads > 0 ? [`${f.reads}R`] : []),
					...(f.edits > 0 ? [`${f.edits}E`] : []),
					...(f.writes > 0 ? [`${f.writes}W`] : []),
				];
				const chainSuffix = editChainMap
					? formatEditChainSuffix(editChainMap.get(f.file_path))
					: "";
				const isHighlighted = highlightIndex !== undefined && fileIdx === highlightIndex;
				const line = `        ${f.name.padEnd(28)} ${parts.join(" ")}${chainSuffix}`;
				return isHighlighted ? ansi.inverse(line) : line;
			});
			return [dirLine, ...entryLines];
		});

		return [header, ...fileLines, ""];
	});
};

// --- Pluralization helper ---

export const pluralize = (word: string, count: number): string => {
	if (count === 1) return word;
	if (word.endsWith("y") && !/[aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
	return `${word}s`;
};

// --- ANSI strip helper ---

/**
 * Strip ANSI escape codes from a string to get its visible length.
 */
export const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * Word-wrap plain text to a given width.
 */
export const wrapText = (text: string, width: number): readonly string[] => {
	if (text.length <= width) return [text];
	const words = text.split(" ");
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (current.length === 0) {
			current = word;
		} else if (current.length + 1 + word.length <= width) {
			current += ` ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current.length > 0) lines.push(current);
	return lines;
};

// --- Agent color helpers ---

const AGENT_COLORS = [
	ansi.cyan,
	ansi.green,
	ansi.yellow,
	ansi.magenta,
	ansi.blue,
	ansi.red,
] as const;

export const colorizeAgent = (name: string, agentNames: readonly string[]): string => {
	const idx = agentNames.indexOf(name);
	const colorFn = AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0];
	return colorFn(name);
};

// --- Communication sequence formatters ---

const formatTime = (t: number): string => {
	const d = new Date(t);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
};

export const formatSequenceEntry = (
	entry: CommunicationSequenceEntry,
	agentNames: readonly string[],
): string => {
	const time = ansi.dim(formatTime(entry.t));
	const fromName = displayName(entry.from_name);
	const toName = displayName(entry.to_name);
	const from = colorizeAgent(fromName, agentNames);
	const to = colorizeAgent(toName, agentNames);
	const arrow = ansi.dim("\u2192");
	const summary = entry.summary ? ` "${entry.summary}"` : "";
	const msgType = ansi.dim(`[${entry.msg_type}]`);
	return `  ${time} ${from} ${arrow} ${to} ${msgType}${summary}`;
};

export const formatAgentLifetimeBar = (
	lifetime: AgentLifetime,
	minT: number,
	maxT: number,
	barWidth: number,
	agentNames: readonly string[],
	maxLabelLen: number = 18,
): string => {
	const totalSpan = maxT - minT;
	const rawName = `${lifetime.agent_name ?? lifetime.agent_type} (${lifetime.agent_id.slice(0, 8)})`;
	if (totalSpan <= 0)
		return `  ${rawName.length > maxLabelLen ? `${rawName.slice(0, maxLabelLen - 1)}\u2026` : rawName}`;

	const startFrac = (lifetime.start_t - minT) / totalSpan;
	const endFrac = (lifetime.end_t - minT) / totalSpan;
	const startCol = Math.round(startFrac * barWidth);
	const endCol = Math.max(startCol + 1, Math.round(endFrac * barWidth));

	const before = "\u2500".repeat(startCol);
	const active = "\u2588".repeat(Math.min(endCol - startCol, barWidth - startCol));
	const after = "\u2500".repeat(Math.max(0, barWidth - endCol));

	const truncName =
		rawName.length > maxLabelLen ? `${rawName.slice(0, maxLabelLen - 1)}\u2026` : rawName;
	const coloredName = colorizeAgent(truncName, agentNames);
	const visibleLen = stripAnsi(coloredName).length;
	const padding = " ".repeat(Math.max(0, maxLabelLen - visibleLen));
	const bar = `${ansi.dim(before)}${colorizeAgent(active, agentNames)}${ansi.dim(after)}`;
	return `  ${coloredName}${padding} ${bar}`;
};

// --- UUID truncation fallback ---

/** Truncate names that look like full UUIDs to first 8 chars for display. */
const displayName = (name: string): string =>
	name.includes("-") && name.length > 20 ? name.slice(0, 8) : name;

// --- Communication graph summary ---

export const formatCommGraphSummary = (edges: readonly CommunicationEdge[]): readonly string[] => {
	if (edges.length === 0) return [];

	const sorted = [...edges].sort((a, b) => b.count - a.count);
	const top5 = sorted.slice(0, 5);

	return [
		ansi.bold(`Communication Summary (${edges.length} edge${edges.length !== 1 ? "s" : ""}):`),
		"",
		...top5.map((e) => {
			const types = e.msg_types.join(", ");
			return `  ${displayName(e.from_name).padEnd(16)} -> ${displayName(e.to_name).padEnd(16)} ${String(e.count).padStart(3)} msg${e.count !== 1 ? "s" : " "} [${types}]`;
		}),
		"",
	];
};

// --- Decision point formatter ---

export const formatDecisionsSection = (decisions: readonly DecisionPoint[]): readonly string[] => {
	if (decisions.length === 0) return [];

	const countByType = decisions.reduce<Readonly<Record<string, number>>>(
		(acc, d) => ({
			...acc,
			[d.type]: (acc[d.type] ?? 0) + 1,
		}),
		{},
	);

	const summaryParts = Object.entries(countByType)
		.map(([type, count]) => `${count} ${pluralize(type.replace(/_/g, " "), count)}`)
		.join(", ");

	const recent = [...decisions]
		.sort((a, b) => b.t - a.t)
		.slice(0, 3)
		.map((d) => {
			const time = new Date(d.t).toLocaleTimeString();
			const detail = (() => {
				switch (d.type) {
					case "timing_gap":
						return `${formatDuration(d.gap_ms)} gap (${d.classification})`;
					case "tool_pivot":
						return `${d.from_tool} -> ${d.to_tool}${d.after_failure ? " (after failure)" : ""}`;
					case "phase_boundary":
						return `phase ${d.phase_index + 1}: ${d.phase_name}`;
					case "agent_spawn":
						return `spawned ${d.agent_name} (${d.agent_type})`;
					case "task_delegation":
						return `delegated to ${d.agent_name}${d.subject ? `: ${d.subject}` : ""}`;
					case "task_completion":
						return `completed by ${d.agent_name}${d.subject ? `: ${d.subject}` : ""}`;
				}
			})();
			return `  ${ansi.dim(time)} ${d.type.replace(/_/g, " ")}: ${detail}`;
		});

	return ["", ansi.bold(`Decision Points: ${summaryParts}`), ...recent];
};

// --- Git diff formatter ---

export const formatGitDiffSection = (gitDiff: GitDiffResult): readonly string[] => {
	if (
		gitDiff.hunks.length === 0 &&
		(!gitDiff.working_tree_changes || gitDiff.working_tree_changes.length === 0)
	)
		return [];

	const totalAdditions = gitDiff.hunks.reduce((sum, h) => sum + h.additions, 0);
	const totalDeletions = gitDiff.hunks.reduce((sum, h) => sum + h.deletions, 0);

	const header = `Git Changes: ${gitDiff.commits.length} commit${gitDiff.commits.length !== 1 ? "s" : ""}, +${totalAdditions} -${totalDeletions} lines`;

	const topHunks = [...gitDiff.hunks]
		.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
		.slice(0, 5)
		.map(
			(h) =>
				`  ${h.file_path.padEnd(35)} +${String(h.additions).padStart(4)} -${String(h.deletions).padStart(4)}`,
		);

	return ["", ansi.bold(header), ...topHunks];
};

// --- Edit chain detail formatter ---

export const formatEditDetail = (
	chain: EditChain,
	agentNames: readonly string[],
): readonly string[] => {
	const agentLabel = chain.agent_name ? ` (${colorizeAgent(chain.agent_name, agentNames)})` : "";
	const duration = formatDuration(chain.effort_ms);
	const header = ansi.bold(
		`${chain.file_path}${agentLabel} — ${chain.total_edits} edits, ${chain.total_failures} failures, ${chain.total_reads} reads (${duration})`,
	);

	const stepLines = chain.steps.flatMap(renderStep);

	const successCount = chain.surviving_edit_ids.length;
	const survivingLine =
		successCount > 0
			? `Successful: ${successCount} edit${successCount !== 1 ? "s" : ""}`
			: "Successful: (none)";

	const failCount = chain.abandoned_edit_ids.length;
	const abandonedLine =
		failCount > 0 ? `Failed: ${failCount} edit${failCount !== 1 ? "s" : ""}` : "Failed: (none)";

	return [header, "", ...stepLines, "", survivingLine, abandonedLine];
};

// --- Attributed diff formatter ---

export const formatAttributedDiff = (
	attribution: FileDiffAttribution,
	agentNames: readonly string[],
	_width: number,
): readonly string[] => {
	const header = ansi.bold(
		`${attribution.file_path}  ${ansi.green(`+${attribution.total_additions}`)} ${ansi.red(`-${attribution.total_deletions}`)}`,
	);

	const lines = attribution.lines.map((line) => {
		const agentTag = line.agent_name ? colorizeAgent(line.agent_name, agentNames) : "";
		const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
		const colorFn = line.type === "add" ? ansi.green : line.type === "remove" ? ansi.red : ansi.dim;
		const content = colorFn(`${prefix} ${line.content}`);
		return agentTag ? `${content}  ${agentTag}` : content;
	});

	return [header, "", ...lines];
};

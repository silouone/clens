import { html } from "diff2html";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
	type Accessor,
	type Component,
} from "solid-js";
import type {
	DiffLine,
	EditChain,
	EditChainsResult,
	FileMapEntry,
	FileMapResult,
	FileRiskScore,
	GitDiffResult,
	RiskLevel,
	WorkingTreeChange,
} from "../../shared/types";

// ── Types ───────────────────────────────────────────────────────────

type DiffPanelProps = {
	readonly fileMap: FileMapResult;
	readonly gitDiff: GitDiffResult;
	readonly editChains?: EditChainsResult;
	readonly riskScores?: readonly FileRiskScore[];
	readonly onFileClick?: (filePath: string) => void;
	readonly highlightedFile?: string;
	/** Reactive signal — when set, auto-expands the file and scrolls to it */
	readonly scrollToFile?: Accessor<string | undefined>;
	/** Reactive signal — CSS selector of element to flash */
	readonly flashSelector?: Accessor<string | undefined>;
};

/** Merged file info combining file_map + working_tree_changes + edit_chains. */
type FileEntry = {
	readonly filePath: string;
	readonly status: "added" | "modified" | "deleted" | "renamed";
	readonly additions: number;
	readonly deletions: number;
	readonly reads: number;
	readonly edits: number;
	readonly hasAbandonedEdits: boolean;
	readonly diffLines: readonly DiffLine[];
};

// ── Pure helpers ────────────────────────────────────────────────────

const statusBadge: Record<string, { label: string; cls: string }> = {
	added: { label: "A", cls: "bg-emerald-900/60 text-emerald-400 border-emerald-700/50" },
	modified: { label: "M", cls: "bg-blue-900/60 text-blue-400 border-blue-700/50" },
	deleted: { label: "D", cls: "bg-red-900/60 text-red-400 border-red-700/50" },
	renamed: { label: "R", cls: "bg-purple-900/60 text-purple-400 border-purple-700/50" },
};

/**
 * Convert DiffLine[] to unified diff string for diff2html.
 * Pure client-side equivalent of @clens/cli diffLinesToUnified.
 */
const diffLinesToUnified = (
	filePath: string,
	lines: readonly DiffLine[],
): string => {
	if (lines.length === 0) return "";
	const header = `--- a/${filePath}\n+++ b/${filePath}`;
	const oldCount = lines.filter((l) => l.type === "remove" || l.type === "context").length;
	const newCount = lines.filter((l) => l.type === "add" || l.type === "context").length;
	const hunkHeader = `@@ -1,${oldCount} +1,${newCount} @@`;
	const body = lines
		.map((l) => {
			const prefix = l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
			return `${prefix}${l.content}`;
		})
		.join("\n");
	return `${header}\n${hunkHeader}\n${body}`;
};

/** Merge file_map entries, working_tree_changes, and edit_chains into a unified list. */
const mergeFileEntries = (
	fileMap: FileMapResult,
	gitDiff: GitDiffResult,
	editChains?: EditChainsResult,
): readonly FileEntry[] => {
	const wtcMap = new Map<string, WorkingTreeChange>();
	[...(gitDiff.working_tree_changes ?? []), ...(gitDiff.staged_changes ?? [])].forEach((c) => {
		wtcMap.set(c.file_path, c);
	});

	const chainMap = new Map<string, EditChain>();
	(editChains?.chains ?? []).forEach((c) => {
		chainMap.set(c.file_path, c);
	});

	const attrMap = new Map<string, readonly DiffLine[]>();
	(editChains?.diff_attribution ?? []).forEach((a) => {
		attrMap.set(a.file_path, a.lines);
	});

	// Build from file_map entries (primary source)
	const seenPaths = new Set(fileMap.files.map((f) => f.file_path));
	const fileMapEntries: readonly FileEntry[] = fileMap.files.map((f) => {
		const wtc = wtcMap.get(f.file_path);
		const chain = chainMap.get(f.file_path);
		return {
			filePath: f.file_path,
			status: wtc?.status ?? "modified",
			additions: wtc?.additions ?? 0,
			deletions: wtc?.deletions ?? 0,
			reads: f.reads,
			edits: f.edits,
			hasAbandonedEdits: (chain?.abandoned_edit_ids.length ?? 0) > 0,
			diffLines: attrMap.get(f.file_path) ?? [],
		};
	});

	// Add working tree changes not in file_map
	const extraEntries: readonly FileEntry[] = [...wtcMap.entries()]
		.filter(([path]) => !seenPaths.has(path))
		.map(([path, wtc]) => ({
			filePath: path,
			status: wtc.status,
			additions: wtc.additions ?? 0,
			deletions: wtc.deletions ?? 0,
			reads: 0,
			edits: 0,
			hasAbandonedEdits: false,
			diffLines: attrMap.get(path) ?? [],
		}));

	// Sort: files with diffs first, then alphabetically
	return [...fileMapEntries, ...extraEntries].sort((a, b) => {
		const aHasDiff = a.diffLines.length > 0 ? 0 : 1;
		const bHasDiff = b.diffLines.length > 0 ? 0 : 1;
		if (aHasDiff !== bHasDiff) return aHasDiff - bHasDiff;
		return a.filePath.localeCompare(b.filePath);
	});
};

// ── FileCard component ──────────────────────────────────────────────

// ── Risk dot helpers ─────────────────────────────────────────────────

const riskDotCls: Record<RiskLevel, string> = {
	low: "bg-emerald-500",
	medium: "bg-amber-500",
	high: "bg-red-500",
};

const formatRiskTooltip = (score: FileRiskScore): string => {
	const parts: string[] = [`Risk: ${score.risk_level}`];
	if (score.backtrack_count > 0) parts.push(`${score.backtrack_count} backtrack(s)`);
	if (score.abandoned_edit_count > 0) parts.push(`${score.abandoned_edit_count} abandoned edit(s)`);
	if (score.failure_rate > 0) parts.push(`${(score.failure_rate * 100).toFixed(0)}% failure rate`);
	return parts.join(" \u2022 ");
};

const FileCard: Component<{
	readonly entry: FileEntry;
	readonly expanded: boolean;
	readonly highlighted: boolean;
	readonly flashing: boolean;
	readonly riskScore?: FileRiskScore;
	readonly onToggle: () => void;
	readonly onFileClick?: (filePath: string) => void;
}> = (props) => {
	const badge = () => statusBadge[props.entry.status] ?? statusBadge.modified;

	const diffHtml = createMemo(() => {
		if (!props.expanded || props.entry.diffLines.length === 0) return "";
		const unified = diffLinesToUnified(props.entry.filePath, props.entry.diffLines);
		return html(unified, { outputFormat: "line-by-line", drawFileList: false });
	});

	return (
		<div
			class={`rounded-lg overflow-hidden border transition-all ${props.highlighted ? "border-blue-600 ring-1 ring-blue-600/30" : "border-gray-800"}`}
			classList={{ "clens-flash": props.flashing }}
			data-file-path={props.entry.filePath}
		>
			{/* Header row */}
			<button
				onClick={() => {
					props.onToggle();
					props.onFileClick?.(props.entry.filePath);
				}}
				class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-gray-800/50"
			>
				{/* Expand arrow */}
				<span
					class={`text-gray-500 transition-transform ${props.expanded ? "rotate-90" : ""}`}
				>
					&#9654;
				</span>

				{/* Status badge */}
				<span
					class={`inline-flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${badge().cls}`}
				>
					{badge().label}
				</span>

				{/* File path */}
				<span class="flex-1 truncate font-mono text-gray-200">
					{props.entry.filePath}
				</span>

				{/* Risk dot */}
				<Show when={props.riskScore}>
					{(score) => (
						<span
							class={`inline-block h-2.5 w-2.5 rounded-full ${riskDotCls[score().risk_level]}`}
							title={formatRiskTooltip(score())}
						/>
					)}
				</Show>

				{/* Abandoned marker */}
				<Show when={props.entry.hasAbandonedEdits}>
					<span class="rounded border border-amber-700/50 bg-amber-900/30 px-1.5 py-0.5 text-xs text-amber-400">
						abandoned edits
					</span>
				</Show>

				{/* Line counts */}
				<Show when={props.entry.additions > 0}>
					<span class="text-xs text-emerald-400">+{props.entry.additions}</span>
				</Show>
				<Show when={props.entry.deletions > 0}>
					<span class="text-xs text-red-400">-{props.entry.deletions}</span>
				</Show>
			</button>

			{/* Diff content */}
			<Show when={props.expanded}>
				<div class="border-t border-gray-800">
					<Show
						when={props.entry.diffLines.length > 0}
						fallback={
							<div class="px-4 py-6 text-center text-sm text-gray-500">
								Diff not available for this file
							</div>
						}
					>
						<div class="diff-panel-content overflow-x-auto text-xs" innerHTML={diffHtml()} />
					</Show>
				</div>
			</Show>
		</div>
	);
};

// ── DiffPanel main component ────────────────────────────────────────

const SCROLL_DELAY_MS = 100;

export const DiffPanel: Component<DiffPanelProps> = (props) => {
	let containerRef: HTMLDivElement | undefined;

	const [expandedFiles, setExpandedFiles] = createSignal<ReadonlySet<string>>(
		new Set(),
	);

	const entries = createMemo(() =>
		mergeFileEntries(props.fileMap, props.gitDiff, props.editChains),
	);

	const riskMap = createMemo(() => {
		const map = new Map<string, FileRiskScore>();
		(props.riskScores ?? []).forEach((s) => map.set(s.file_path, s));
		return map;
	});

	const isExpanded = (path: string) => expandedFiles().has(path);

	const toggleFile = (path: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	const expandFile = (path: string) => {
		setExpandedFiles((prev) => {
			if (prev.has(path)) return prev;
			const next = new Set(prev);
			next.add(path);
			return next;
		});
	};

	const expandAll = () => {
		setExpandedFiles(new Set<string>(entries().map((e) => e.filePath)));
	};

	const collapseAll = () => {
		setExpandedFiles(new Set<string>());
	};

	const totalAdditions = createMemo(() =>
		entries().reduce((sum, e) => sum + e.additions, 0),
	);
	const totalDeletions = createMemo(() =>
		entries().reduce((sum, e) => sum + e.deletions, 0),
	);

	// ── React to scrollToFile signal ─────────────────────────────

	createEffect(() => {
		const filePath = props.scrollToFile?.();
		if (!filePath || !containerRef) return;

		// Auto-expand the target file
		expandFile(filePath);

		// Scroll to it after a brief delay (allows DOM to update)
		setTimeout(() => {
			const el = containerRef?.querySelector(`[data-file-path="${CSS.escape(filePath)}"]`);
			el?.scrollIntoView({ behavior: "smooth", block: "center" });
		}, SCROLL_DELAY_MS);
	});

	// ── Flash detection ──────────────────────────────────────────

	const isFlashing = (filePath: string): boolean => {
		const sel = props.flashSelector?.();
		return sel === `[data-file-path="${filePath}"]`;
	};

	return (
		<div ref={containerRef} class="flex h-full flex-col">
			{/* Header */}
			<div class="flex items-center justify-between border-b border-gray-800 px-4 py-2">
				<div class="flex items-center gap-3">
					<h2 class="text-sm font-semibold text-gray-300">
						Files Changed
					</h2>
					<span class="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
						{entries().length}
					</span>
					<Show when={totalAdditions() > 0}>
						<span class="text-xs text-emerald-400">
							+{totalAdditions()}
						</span>
					</Show>
					<Show when={totalDeletions() > 0}>
						<span class="text-xs text-red-400">
							-{totalDeletions()}
						</span>
					</Show>
				</div>
				<div class="flex gap-2">
					<button
						onClick={expandAll}
						class="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
					>
						Expand all
					</button>
					<button
						onClick={collapseAll}
						class="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
					>
						Collapse all
					</button>
				</div>
			</div>

			{/* File list */}
			<div class="flex-1 overflow-y-auto p-3">
				<Show
					when={entries().length > 0}
					fallback={
						<div class="py-12 text-center text-sm text-gray-500">
							No file changes detected
						</div>
					}
				>
					<div class="flex flex-col gap-2">
						<For each={entries()}>
							{(entry) => (
								<FileCard
									entry={entry}
									expanded={isExpanded(entry.filePath)}
									highlighted={props.highlightedFile === entry.filePath}
									flashing={isFlashing(entry.filePath)}
									riskScore={riskMap().get(entry.filePath)}
									onToggle={() => toggleFile(entry.filePath)}
									onFileClick={props.onFileClick}
								/>
							)}
						</For>
					</div>
				</Show>
			</div>
		</div>
	);
};

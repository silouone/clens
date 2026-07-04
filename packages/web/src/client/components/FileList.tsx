import { html } from "diff2html";
import { ChevronRight } from "lucide-solid";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { isFilePath } from "../../shared/paths";
import type {
	AgentNode,
	DiffLine,
	DistilledSession,
	FileMapEntry,
	RiskLevel,
} from "../../shared/types";
import { diffLinesToUnified } from "../lib/diff-utils";
import { riskBadgeClass } from "../lib/risk";

// ── Types ────────────────────────────────────────────────────────────

export type FileRow = {
	readonly filePath: string;
	readonly reads: number;
	readonly edits: number;
	readonly additions: number;
	readonly deletions: number;
	readonly diffLines: readonly DiffLine[];
	readonly riskLevel?: RiskLevel;
};

type FileListProps = {
	readonly rows: readonly FileRow[];
	readonly emptyMessage?: string;
};

// ── Pure helpers ─────────────────────────────────────────────────────

export const truncatePath = (path: string, maxLen = 60): string =>
	path.length <= maxLen ? path : `...${path.slice(-(maxLen - 3))}`;

/**
 * Build file rows from session-level file_map + edit_chains diff attribution.
 * Filters non-file paths, enriches with diff data, sorts edits-first then alpha.
 */
export const buildFileRows = (
	session: DistilledSession,
	riskMap?: ReadonlyMap<string, RiskLevel>,
): readonly FileRow[] => {
	const attrMap = new Map(
		(session.edit_chains?.diff_attribution ?? []).map((a) => [a.file_path, a] as const),
	);

	const rows = session.file_map.files
		.filter((f) => isFilePath(f.file_path))
		.map((f) => {
			const attr =
				attrMap.get(f.file_path) ??
				[...attrMap.values()].find(
					(a) => f.file_path.endsWith(a.file_path) || a.file_path.endsWith(f.file_path),
				);
			return {
				filePath: f.file_path,
				reads: f.reads,
				edits: f.edits,
				additions: attr?.total_additions ?? 0,
				deletions: attr?.total_deletions ?? 0,
				diffLines: attr?.lines ?? [],
				riskLevel: riskMap?.get(f.file_path),
			};
		});

	return [...rows].sort((a, b) => {
		if (a.edits !== b.edits) return a.edits > 0 ? -1 : 1;
		return a.filePath.localeCompare(b.filePath);
	});
};

/**
 * Build file rows from agent-level file_map + edit_chains diff attribution.
 * Same logic as buildFileRows but sources data from an AgentNode.
 */
export const buildAgentFileRows = (agent: AgentNode): readonly FileRow[] => {
	const files = agent.file_map?.files ?? [];
	if (files.length === 0) return [];

	const attrMap = new Map(
		(agent.edit_chains?.diff_attribution ?? []).map((a) => [a.file_path, a] as const),
	);

	const rows = files.map((f: FileMapEntry) => {
		const attr =
			attrMap.get(f.file_path) ??
			[...attrMap.values()].find(
				(a) => f.file_path.endsWith(a.file_path) || a.file_path.endsWith(f.file_path),
			);
		return {
			filePath: f.file_path,
			reads: f.reads,
			edits: f.edits,
			additions: attr?.total_additions ?? 0,
			deletions: attr?.total_deletions ?? 0,
			diffLines: attr?.lines ?? [],
		};
	});

	return [...rows].sort((a, b) => {
		if (a.edits !== b.edits) return a.edits > 0 ? -1 : 1;
		return a.filePath.localeCompare(b.filePath);
	});
};

// ── Component ────────────────────────────────────────────────────────

export const FileList: Component<FileListProps> = (props) => {
	const [expandedFiles, setExpandedFiles] = createSignal<ReadonlySet<string>>(new Set());

	const isExpanded = (path: string) => expandedFiles().has(path);

	// Immutable-copy-then-mutate: creates a new Set from prev, then mutates the copy.
	// This is safe because the copy is never shared before mutation completes.
	const toggleFile = (path: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const allExpanded = createMemo(() => {
		const rows = props.rows;
		return rows.length > 0 && expandedFiles().size === rows.length;
	});

	const toggleAll = () => {
		if (allExpanded()) setExpandedFiles(new Set<string>());
		else setExpandedFiles(new Set<string>(props.rows.map((r) => r.filePath)));
	};

	return (
		<>
			{/* Header row with expand/collapse toggle */}
			<div class="flex items-center justify-between px-4 py-2.5 border-b border-clens">
				<div class="flex items-center gap-3">
					<span class="rounded-none border border-clens bg-surface-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted">
						{props.rows.length}
					</span>
				</div>
				<Show when={props.rows.length > 0}>
					<button
						type="button"
						onClick={toggleAll}
						class="instrument-microcaps rounded-none border border-clens px-2 py-0.5 text-[10px] text-muted transition hover:bg-surface-hover hover:text-secondary"
					>
						{allExpanded() ? "Collapse all" : "Expand all"}
					</button>
				</Show>
			</div>

			{/* File rows */}
			<Show
				when={props.rows.length > 0}
				fallback={
					<div class="flex flex-col items-center gap-1 py-8 text-center">
						<span class="instrument-microcaps text-[10px] text-muted">No data</span>
						<span class="text-xs text-muted">
							{props.emptyMessage ?? "No file changes detected"}
						</span>
					</div>
				}
			>
				<div class="overflow-y-auto">
					<For each={props.rows}>
						{(row) => {
							const expanded = () => isExpanded(row.filePath);
							const diffHtml = createMemo(() => {
								if (!expanded() || row.diffLines.length === 0) return "";
								return html(diffLinesToUnified(row.filePath, row.diffLines), {
									outputFormat: "line-by-line",
									drawFileList: false,
								});
							});
							return (
								<div class="border-b border-clens last:border-0 overflow-hidden">
									<button
										type="button"
										onClick={() => toggleFile(row.filePath)}
										class="flex w-full items-center gap-2 px-4 py-1.5 text-xs text-left transition hover:bg-surface-hover"
									>
										<ChevronRight
											class={`h-3 w-3 text-muted transition-transform ${expanded() ? "rotate-90" : ""}`}
										/>
										<Show when={row.riskLevel && row.riskLevel !== "low"}>
											<span
												class={`instrument-led shrink-0 ${riskBadgeClass(row.riskLevel!)}`}
												title={`${row.riskLevel} risk`}
											/>
										</Show>
										<span class="flex-1 truncate font-mono text-secondary" title={row.filePath}>
											{truncatePath(row.filePath)}
										</span>
										<Show when={row.reads > 0}>
											<span class="font-mono text-muted tabular-nums" title="files read">
												{row.reads}r
											</span>
										</Show>
										<Show when={row.edits > 0}>
											<span class="font-mono text-brand-500 tabular-nums" title="files edited">
												{row.edits}e
											</span>
										</Show>
										<Show when={row.additions > 0}>
											<span
												class="font-mono text-[var(--clens-success)] tabular-nums"
												title="lines added"
											>
												+{row.additions}
											</span>
										</Show>
										<Show when={row.deletions > 0}>
											<span
												class="font-mono text-[var(--clens-danger)] tabular-nums"
												title="lines removed"
											>
												-{row.deletions}
											</span>
										</Show>
										<Show when={row.additions === 0 && row.deletions === 0 && row.edits > 0}>
											<span class="text-muted text-xs">N/A</span>
										</Show>
									</button>
									<Show when={expanded()}>
										<div class="border-t border-clens overflow-hidden">
											<Show
												when={row.diffLines.length > 0}
												fallback={
													<div class="px-4 py-4 text-center text-xs text-muted">
														{row.edits > 0 ? "Diff not captured" : "Read only \u2014 no changes"}
													</div>
												}
											>
												<div
													class="diff-panel-content max-h-96 overflow-y-auto overflow-x-auto text-xs"
													innerHTML={diffHtml()}
												/>
											</Show>
										</div>
									</Show>
								</div>
							);
						}}
					</For>
				</div>
			</Show>
		</>
	);
};

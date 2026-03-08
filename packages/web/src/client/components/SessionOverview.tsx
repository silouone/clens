import { html } from "diff2html";
import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import type { DiffLine, DistilledSession, FileDiffAttribution } from "../../shared/types";
import { isFilePath } from "../../shared/paths";
import { diffLinesToUnified } from "../lib/diff-utils";
import { SessionSnapshot } from "./SessionSnapshot";
import { NarrativeSection } from "./NarrativeSection";
import { AgentWorkloadTable } from "./AgentWorkloadTable";
import { IssuesPanel } from "./IssuesPanel";
import { ThinkingBreakdown } from "./ThinkingBreakdown";
import { PlanDriftSection } from "./PlanDriftSection";

// ── Types ────────────────────────────────────────────────────────────

type SessionOverviewProps = {
	readonly session: DistilledSession;
	readonly sessionId: string;
	readonly isMultiAgent: boolean;
};

// ── Pure helpers ─────────────────────────────────────────────────────

type FileRow = {
	readonly filePath: string;
	readonly reads: number;
	readonly edits: number;
	readonly additions: number;
	readonly deletions: number;
	readonly diffLines: readonly DiffLine[];
};

const buildFileRows = (session: DistilledSession): readonly FileRow[] => {
	const attrMap = new Map<string, FileDiffAttribution>(
		(session.edit_chains?.diff_attribution ?? []).map((a) => [a.file_path, a] as const),
	);

	const rows: readonly FileRow[] = session.file_map.files
		.filter((f) => isFilePath(f.file_path))
		.map((f) => {
			// Try exact match then suffix match for diff attribution
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

	// Sort: files with edits first, then alphabetically
	return [...rows].sort((a, b) => {
		if (a.edits !== b.edits) return a.edits > 0 ? -1 : 1;
		return a.filePath.localeCompare(b.filePath);
	});
};

const truncatePath = (path: string, maxLen = 60): string =>
	path.length <= maxLen ? path : `...${path.slice(-(maxLen - 3))}`;

// ── Component ────────────────────────────────────────────────────────

export const SessionOverview: Component<SessionOverviewProps> = (props) => {
	const fileRows = createMemo(() => buildFileRows(props.session));
	const totalAdditions = createMemo(() =>
		fileRows().reduce((sum, f) => sum + f.additions, 0),
	);
	const totalDeletions = createMemo(() =>
		fileRows().reduce((sum, f) => sum + f.deletions, 0),
	);

	const [expandedFiles, setExpandedFiles] = createSignal<ReadonlySet<string>>(new Set());
	const isExpanded = (path: string) => expandedFiles().has(path);
	const toggleFile = (path: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};
	const allExpanded = createMemo(() => {
		const rows = fileRows();
		return rows.length > 0 && expandedFiles().size === rows.length;
	});
	const toggleAll = () => {
		if (allExpanded()) setExpandedFiles(new Set<string>());
		else setExpandedFiles(new Set<string>(fileRows().map((r) => r.filePath)));
	};

	return (
		<div class="space-y-4">
			{/* 1. Session Snapshot (always visible hero) */}
			<SessionSnapshot session={props.session} />

			{/* 2. Narrative (conditional) */}
			<Show when={props.session.summary?.narrative}>
				<NarrativeSection session={props.session} />
			</Show>

			{/* 3. Agent Workload (conditional: multi-agent) */}
			<Show when={props.isMultiAgent}>
				<AgentWorkloadTable
					session={props.session}
					sessionId={props.sessionId}
				/>
			</Show>

			{/* 4. Issues & Errors (always visible — handles own empty state) */}
			<IssuesPanel session={props.session} />

			{/* 5. Thinking Breakdown (conditional) */}
			<Show when={props.session.reasoning.length > 0}>
				<ThinkingBreakdown session={props.session} />
			</Show>

			{/* 6. Modified Files List (EXISTING — kept as-is) */}
			<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/50">
				<div class="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
					<div class="flex items-center gap-3">
						<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
							Modified Files
						</h3>
						<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
							{fileRows().length}
						</span>
						<Show when={totalAdditions() > 0}>
							<span class="text-xs text-emerald-500">+{totalAdditions()}</span>
						</Show>
						<Show when={totalDeletions() > 0}>
							<span class="text-xs text-red-500">-{totalDeletions()}</span>
						</Show>
					</div>
					<Show when={fileRows().length > 0}>
						<button
							onClick={toggleAll}
							class="rounded px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
						>
							{allExpanded() ? "Collapse all" : "Expand all"}
						</button>
					</Show>
				</div>

				<Show
					when={fileRows().length > 0}
					fallback={
						<div class="py-8 text-center text-sm text-gray-400 dark:text-gray-600">
							No file changes detected
						</div>
					}
				>
					<div class="overflow-y-auto">
						<For each={fileRows()}>
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
									<div class="border-b border-gray-100 last:border-0 dark:border-gray-800/50 overflow-hidden">
										<button
											onClick={() => toggleFile(row.filePath)}
											class="flex w-full items-center gap-2 px-4 py-1.5 text-xs text-left transition hover:bg-gray-50 dark:hover:bg-gray-800/30"
										>
											<span class={`text-gray-400 transition-transform text-[10px] ${expanded() ? "rotate-90" : ""}`}>
												&#9654;
											</span>
											<span class="flex-1 truncate font-mono text-gray-700 dark:text-gray-300" title={row.filePath}>
												{truncatePath(row.filePath)}
											</span>
											<Show when={row.reads > 0}>
												<span class="text-gray-400 tabular-nums">{row.reads}r</span>
											</Show>
											<Show when={row.edits > 0}>
												<span class="text-blue-500 tabular-nums">{row.edits}e</span>
											</Show>
											<Show when={row.additions > 0}>
												<span class="text-emerald-500 tabular-nums">+{row.additions}</span>
											</Show>
											<Show when={row.deletions > 0}>
												<span class="text-red-500 tabular-nums">-{row.deletions}</span>
											</Show>
										</button>
										<Show when={expanded()}>
											<div class="border-t border-gray-100 dark:border-gray-800/50 overflow-hidden">
												<Show
													when={row.diffLines.length > 0}
													fallback={
														<div class="px-4 py-4 text-center text-xs text-gray-400">
															{row.edits > 0
																? "Diff not captured"
																: "Read only \u2014 no changes"}
														</div>
													}
												>
													<div class="diff-panel-content max-h-96 overflow-y-auto overflow-x-auto text-xs" innerHTML={diffHtml()} />
												</Show>
											</div>
										</Show>
									</div>
								);
							}}
						</For>
					</div>
				</Show>
			</div>

			{/* 7. Plan Drift (conditional) */}
			<Show when={props.session.plan_drift}>
				<PlanDriftSection session={props.session} />
			</Show>
		</div>
	);
};

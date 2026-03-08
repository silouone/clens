import { html } from "diff2html";
import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { DiffLine, DistilledSession, FileDiffAttribution } from "../../shared/types";
import { isFilePath } from "../../shared/paths";
import { formatDuration, formatCost } from "../lib/format";
import { diffLinesToUnified } from "../lib/diff-utils";

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
	const navigate = useNavigate();
	const agents = () => props.session.agents ?? [];
	const agentCount = () => agents().length;
	const subAgentCount = () =>
		agents().reduce((sum, a) => sum + a.children.length, 0);
	const leadAgent = () => agents()[0];

	const totalCost = () => props.session.cost_estimate?.estimated_cost_usd ?? 0;
	const totalDuration = () => props.session.stats.duration_ms;

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

	const handleViewDetails = () => {
		if (props.isMultiAgent) {
			navigate(`/session/${props.sessionId}/team`);
		} else {
			const first = agents()[0];
			if (first) {
				navigate(`/session/${props.sessionId}/agent/${first.session_id}`);
			}
		}
	};

	return (
		<div class="space-y-4">
			{/* Agent Team Overview */}
			<div class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/50">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
							Agent Team
						</h3>
						<span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/60 dark:text-blue-400">
							{agentCount() + subAgentCount()} agents
						</span>
					</div>
					<button
						onClick={handleViewDetails}
						class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
					>
						View Details
					</button>
				</div>

				<div class="mt-3 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
					<Show when={leadAgent()}>
						{(lead) => (
							<span>
								Lead: <span class="font-medium text-gray-700 dark:text-gray-300">{lead().agent_name || lead().agent_type}</span>
								{subAgentCount() > 0 && ` + ${subAgentCount()} sub-agents`}
							</span>
						)}
					</Show>
					<span>
						Cost: <span class="font-medium text-gray-700 dark:text-gray-300">{formatCost(totalCost())}</span>
					</span>
					<span>
						Duration: <span class="font-medium text-gray-700 dark:text-gray-300">{formatDuration(totalDuration())}</span>
					</span>
				</div>
			</div>

			{/* Modified Files List */}
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
		</div>
	);
};

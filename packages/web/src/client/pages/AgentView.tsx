import { html } from "diff2html";
import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, createSignal, createEffect, onCleanup, For, Show, type Component } from "solid-js";
import type { AgentNode, DiffLine, FileMapEntry } from "../../shared/types";
import { createSessionDetail } from "../lib/stores";
import { AgentListPanel } from "../components/AgentListPanel";
import { SystemPromptPanel } from "../components/SystemPromptPanel";
import { formatDuration, formatCost } from "../lib/format";
import { diffLinesToUnified } from "../lib/diff-utils";

// ── Resizable system prompt panel constants ──────────────────────────

const SYSPROMPT_STORAGE_KEY = "clens-sysprompt-width";
const SYSPROMPT_DEFAULT_WIDTH = 480;
const SYSPROMPT_MIN_WIDTH = 280;
const SYSPROMPT_MAX_VW_RATIO = 0.7;
const SYSPROMPT_HANDLE_WIDTH = 4;

const loadSyspromptWidth = (fallback: number): number => {
	try {
		const stored = localStorage.getItem(SYSPROMPT_STORAGE_KEY);
		if (stored === null) return fallback;
		const parsed = Number.parseFloat(stored);
		return Number.isFinite(parsed) ? Math.max(SYSPROMPT_MIN_WIDTH, parsed) : fallback;
	} catch {
		return fallback;
	}
};

const saveSyspromptWidth = (width: number): void => {
	try {
		localStorage.setItem(SYSPROMPT_STORAGE_KEY, String(Math.round(width)));
	} catch {
		// Storage full or unavailable -- silently ignore
	}
};

const clampSyspromptWidth = (width: number): number =>
	Math.max(SYSPROMPT_MIN_WIDTH, Math.min(window.innerWidth * SYSPROMPT_MAX_VW_RATIO, width));

// ── Stat row (reused from old sidebar) ──────────────────────────────

const StatRow: Component<{
	readonly label: string;
	readonly value: string;
}> = (props) => (
	<div class="flex items-center justify-between py-1">
		<span class="text-xs text-gray-500">{props.label}</span>
		<span class="text-xs font-medium text-gray-700 dark:text-gray-300">{props.value}</span>
	</div>
);

// ── Loading / error states ──────────────────────────────────────────

const LoadingSkeleton: Component = () => (
	<div class="flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-700" />
			<span class="text-sm text-gray-500">Loading agent data...</span>
		</div>
	</div>
);

const AgentNotFound: Component = () => (
	<div class="flex h-full items-center justify-center">
		<p class="text-sm text-gray-500">Agent not found in session data.</p>
	</div>
);

// ── Find agent in tree ──────────────────────────────────────────────

const findAgentInTree = (
	agents: readonly AgentNode[],
	agentId: string,
): AgentNode | undefined =>
	agents.reduce<AgentNode | undefined>(
		(found, agent) =>
			found ??
			(agent.session_id === agentId
				? agent
				: findAgentInTree(agent.children, agentId)),
		undefined,
	);

// ── Agent type badge colors ─────────────────────────────────────────

const TYPE_COLORS: Readonly<Record<string, string>> = {
	"general-purpose": "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-400",
	builder: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-400",
	validator: "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-400",
	Explore: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-400",
	Plan: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-400",
	leader: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-400",
};

const getTypeBadgeClass = (agentType: string): string =>
	TYPE_COLORS[agentType] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400";

// ── Per-agent file row helpers ──────────────────────────────────────

type AgentFileRow = {
	readonly filePath: string;
	readonly reads: number;
	readonly edits: number;
	readonly additions: number;
	readonly deletions: number;
	readonly diffLines: readonly DiffLine[];
};

const buildAgentFileRows = (agent: AgentNode): readonly AgentFileRow[] => {
	const files = agent.file_map?.files ?? [];
	if (files.length === 0) return [];

	const attrMap = new Map(
		(agent.edit_chains?.diff_attribution ?? []).map((a) => [a.file_path, a] as const),
	);

	const rows: readonly AgentFileRow[] = files.map((f: FileMapEntry) => {
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

const truncatePath = (path: string, maxLen = 55): string =>
	path.length <= maxLen ? path : `...${path.slice(-(maxLen - 3))}`;

// ── Main component ──────────────────────────────────────────────────

export const AgentView: Component = () => {
	const params = useParams<{ id: string; agentId: string }>();
	const navigate = useNavigate();

	// ── Data resources ──────────────────────────────────────────

	const sessionId = () => params.id;
	const [sessionDetail] = createSessionDetail(sessionId);

	// ── Derived state ───────────────────────────────────────────

	const session = createMemo(() => {
		const detail = sessionDetail();
		if (detail?.status === "ready") return detail.data;
		return undefined;
	});

	const allAgents = createMemo(() => session()?.agents ?? []);

	const isMultiAgent = createMemo(() => allAgents().length > 1);

	const agent = createMemo((): AgentNode | undefined => {
		const s = session();
		if (!s?.agents) return undefined;
		return findAgentInTree(s.agents, params.agentId);
	});

	const fileRows = createMemo(() => {
		const a = agent();
		return a ? buildAgentFileRows(a) : [];
	});

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

	// ── Resizable system prompt panel ────────────────────────────

	const [syspromptWidth, setSyspromptWidth] = createSignal(loadSyspromptWidth(SYSPROMPT_DEFAULT_WIDTH));
	const [syspromptDragging, setSyspromptDragging] = createSignal(false);

	createEffect(() => {
		saveSyspromptWidth(syspromptWidth());
	});

	const onSyspromptMouseMove = (e: MouseEvent) => {
		const newWidth = clampSyspromptWidth(window.innerWidth - e.clientX);
		setSyspromptWidth(newWidth);
	};

	const onSyspromptMouseUp = () => {
		setSyspromptDragging(false);
		document.removeEventListener("mousemove", onSyspromptMouseMove);
		document.removeEventListener("mouseup", onSyspromptMouseUp);
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	};

	const onSyspromptMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		setSyspromptDragging(true);
		document.addEventListener("mousemove", onSyspromptMouseMove);
		document.addEventListener("mouseup", onSyspromptMouseUp);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	};

	onCleanup(() => {
		document.removeEventListener("mousemove", onSyspromptMouseMove);
		document.removeEventListener("mouseup", onSyspromptMouseUp);
	});

	return (
		<div class="flex h-[calc(100vh-49px)] flex-col">
			{/* Nav bar */}
			<div class="flex items-center gap-2 border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
				<button
					onClick={() => navigate(`/session/${params.id}`)}
					class="rounded px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
				>
					&larr; Session
				</button>
				<span class="text-xs text-gray-400 dark:text-gray-600">/</span>
				<span class="text-xs text-gray-500 dark:text-gray-400">
					{agent()?.agent_name ?? agent()?.agent_type ?? params.agentId.slice(0, 12)}
				</span>
			</div>

			{/* Main content */}
			<Show when={!sessionDetail.loading} fallback={<LoadingSkeleton />}>
				<Show when={agent()} fallback={<AgentNotFound />}>
					{(a) => (
						<div class="flex flex-1 overflow-hidden">
							{/* Left: compact agent list (multi-agent only) */}
							<Show when={isMultiAgent()}>
								<AgentListPanel
									agents={allAgents()}
									sessionId={params.id}
									selectedAgentId={params.agentId}
									mode="compact"
								/>
							</Show>

							{/* Center: agent header + stats + per-agent files */}
							<div class="flex-1 overflow-y-auto p-4 space-y-4">
								{/* Agent header */}
								<div class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/50">
									<div class="flex items-center gap-3 mb-3">
										<span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getTypeBadgeClass(a().agent_type)}`}>
											{a().agent_type}
										</span>
										<h2 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
											{a().agent_name ?? a().agent_type}
										</h2>
										<span class="text-[10px] text-gray-400 font-mono dark:text-gray-600">
											{a().session_id.slice(0, 12)}
										</span>
									</div>
									<div class="grid grid-cols-2 gap-x-6 gap-y-0.5 max-w-sm">
										<StatRow label="Duration" value={formatDuration(a().duration_ms)} />
										<StatRow label="Tool calls" value={String(a().tool_call_count)} />
										<Show when={a().model}>
											{(m) => <StatRow label="Model" value={m()} />}
										</Show>
										<Show when={a().cost_estimate}>
											{(c) => <StatRow label="Cost" value={formatCost(c().estimated_cost_usd)} />}
										</Show>
										<Show when={a().tasks_completed !== undefined}>
											<StatRow label="Tasks done" value={String(a().tasks_completed)} />
										</Show>
									</div>
								</div>

								{/* Tools by name */}
								<Show when={a().stats?.tools_by_name}>
									{(tools) => {
										const sorted = createMemo(() =>
											Object.entries(tools())
												.sort(([, x], [, y]) => y - x)
												.slice(0, 10),
										);
										return (
											<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/50">
												<div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
													<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
														Top Tools
													</h3>
												</div>
												<div class="px-4 py-2">
													<For each={sorted()}>
														{([name, count]) => (
															<div class="flex items-center justify-between py-0.5">
																<span class="text-xs font-mono text-gray-500 truncate dark:text-gray-400">{name}</span>
																<span class="text-xs text-gray-400 tabular-nums dark:text-gray-600">{count}</span>
															</div>
														)}
													</For>
												</div>
											</div>
										);
									}}
								</Show>

								{/* Communication partners */}
								<Show when={(a().communication_partners?.length ?? 0) > 0}>
									<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/50">
										<div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
											<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
												Communication
											</h3>
										</div>
										<div class="px-4 py-2">
											<For each={a().communication_partners ?? []}>
												{(cp) => (
													<div class="flex items-center justify-between py-0.5">
														<span class="text-xs font-mono text-gray-500 truncate dark:text-gray-400">{cp.name}</span>
														<span class="text-xs text-gray-400 tabular-nums dark:text-gray-600">
															{cp.sent_count}&#8593; {cp.received_count}&#8595;
														</span>
													</div>
												)}
											</For>
										</div>
									</div>
								</Show>

								{/* Per-agent files */}
								<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/50">
									<div class="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
										<div class="flex items-center gap-3">
											<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
												Files
											</h3>
											<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
												{fileRows().length}
											</span>
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
											<div class="py-6 text-center text-sm text-gray-400 dark:text-gray-600">
												No file data for this agent
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
														<div class="border-b border-gray-100 last:border-0 dark:border-gray-800/50">
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
																<Show when={row.additions === 0 && row.deletions === 0 && row.edits > 0}>
																	<span class="text-gray-400 text-[10px]">N/A</span>
																</Show>
															</button>
															<Show when={expanded()}>
																<div class="border-t border-gray-100 dark:border-gray-800/50">
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

							{/* Right: resizable system prompt panel */}
							<Show when={a().task_prompt}>
								{/* Drag handle */}
								<div
									class="flex-shrink-0 flex items-center justify-center transition-colors duration-150 hover:bg-blue-600/30 cursor-col-resize"
									classList={{ "bg-blue-600/40": syspromptDragging() }}
									style={{ width: `${SYSPROMPT_HANDLE_WIDTH}px` }}
									onMouseDown={onSyspromptMouseDown}
									role="separator"
									aria-orientation="vertical"
									aria-label="Resize system prompt panel"
								>
									<div class="h-8 w-1 rounded-full bg-gray-600 transition-colors duration-150 hover:bg-blue-400" />
								</div>
								{/* Panel */}
								<div
									class="flex-shrink-0 border-l border-gray-200 dark:border-gray-800"
									style={{ width: `${syspromptWidth()}px` }}
								>
									<SystemPromptPanel prompt={a().task_prompt} />
								</div>
							</Show>
						</div>
					)}
				</Show>
			</Show>
		</div>
	);
};

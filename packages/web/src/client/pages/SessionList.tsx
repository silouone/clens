import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { Search, ArrowUp, ArrowDown, RefreshCw, Inbox, ChevronRight, Database, Calendar, Activity, Clock, Users } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js";
import { useKeyboard } from "../lib/keyboard";
import { sessionList, refetchSessions, globalError, clearError } from "../lib/stores";
import type { SessionSummary } from "../../shared/types";
import { formatDuration } from "../lib/format";
import { StatusBadge } from "../components/ui/StatusBadge";

// ── Live indicator ──────────────────────────────────────────────────

const LiveDot: Component = () => (
	<span class="relative flex h-2 w-2">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
		<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
	</span>
);

const formatDate = (ts: number): string => {
	const d = new Date(ts);
	const now = new Date();
	const diffMs = now.getTime() - d.getTime();
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffDays === 0) {
		return d.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return `${diffDays}d ago`;
	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
};

const formatSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(0)} KB`;
	return `${(kb / 1024).toFixed(1)} MB`;
};

// ── Loading skeleton ────────────────────────────────────────────────

const SkeletonRow: Component = () => (
	<tr class="animate-pulse">
		<td class="px-4 py-3"><div class="h-4 w-40 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="px-4 py-3"><div class="h-4 w-16 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="px-4 py-3"><div class="h-4 w-12 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="px-4 py-3"><div class="h-4 w-10 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="px-4 py-3"><div class="h-4 w-10 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="px-4 py-3"><div class="h-4 w-14 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="px-4 py-3"><div class="h-4 w-20 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="px-4 py-3"><div class="h-4 w-16 rounded bg-gray-200 dark:bg-gray-800" /></td>
		<td class="w-8 px-2 py-3" />
	</tr>
);

const LoadingSkeleton: Component = () => (
	<>
		<SkeletonRow />
		<SkeletonRow />
		<SkeletonRow />
		<SkeletonRow />
		<SkeletonRow />
	</>
);

// ── Empty state ─────────────────────────────────────────────────────

const EmptyState: Component = () => (
	<tr>
		<td colspan="9" class="px-4 py-12 text-center text-gray-500">
			<div class="flex flex-col items-center gap-2">
				<Inbox class="h-8 w-8 text-gray-300 dark:text-gray-400" />
				<p class="text-lg font-medium">No sessions found</p>
				<p class="text-sm">
					Run a Claude Code session with cLens hooks to capture data.
				</p>
			</div>
		</td>
	</tr>
);

// ── Summary stat pill ────────────────────────────────────────────────

const SummaryStatPill: Component<{
	readonly icon: Component<{ readonly class?: string }>;
	readonly label: string;
	readonly value: string | number;
}> = (props) => (
	<div class="flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-gray-900">
		<props.icon class="h-3 w-3 text-gray-400 dark:text-gray-400" />
		<span class="text-[10px] font-medium uppercase text-gray-400 dark:text-gray-400">{props.label}</span>
		<span class="text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">{props.value}</span>
	</div>
);

// ── Summary stats helpers ───────────────────────────────────────────

const isToday = (ts: number): boolean => {
	const d = new Date(ts);
	const now = new Date();
	return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

const computeAvgDuration = (sessions: readonly SessionSummary[]): number =>
	sessions.length === 0 ? 0 : Math.round(sessions.reduce((sum, s) => sum + s.duration_ms, 0) / sessions.length);

const computeTotalEvents = (sessions: readonly SessionSummary[]): number =>
	sessions.reduce((sum, s) => sum + s.event_count, 0);

// ── Filter types ────────────────────────────────────────────────────

type StatusFilter = "all" | "complete" | "incomplete";
type AnalyzedFilter = "all" | "analyzed" | "not_analyzed";
type AgentsFilter = "all" | "multi" | "solo";

const isValidStatus = (s: string | undefined): s is StatusFilter =>
	s === "all" || s === "complete" || s === "incomplete";

const isValidAnalyzed = (s: string | undefined): s is AnalyzedFilter =>
	s === "all" || s === "analyzed" || s === "not_analyzed";

const isValidAgents = (s: string | undefined): s is AgentsFilter =>
	s === "all" || s === "multi" || s === "solo";

// ── Sort types ──────────────────────────────────────────────────────

type SortField = "session_name" | "duration_ms" | "event_count" | "agent_count" | "file_size_bytes" | "start_time";
type SortDir = "asc" | "desc";
type SortState = { readonly field: SortField; readonly dir: SortDir } | null;

const SORTABLE_FIELDS = ["session_name", "duration_ms", "event_count", "agent_count", "file_size_bytes", "start_time"] as const;

const isValidSortField = (s: string): s is SortField =>
	SORTABLE_FIELDS.includes(s as SortField);

const parseSortParam = (raw: string | undefined): SortState => {
	if (!raw) return null;
	const isDesc = raw.startsWith("-");
	const field = isDesc ? raw.slice(1) : raw;
	if (!isValidSortField(field)) return null;
	return { field, dir: isDesc ? "desc" : "asc" };
};

const serializeSortParam = (sort: SortState): string | undefined => {
	if (!sort) return undefined;
	return sort.dir === "desc" ? `-${sort.field}` : sort.field;
};

const NUMERIC_SORT_FIELDS = new Set<SortField>(["duration_ms", "event_count", "agent_count", "file_size_bytes", "start_time"]);

const buildSortComparator = (sort: { readonly field: SortField; readonly dir: SortDir }) =>
	(a: SessionSummary, b: SessionSummary): number => {
		const multiplier = sort.dir === "asc" ? 1 : -1;

		if (NUMERIC_SORT_FIELDS.has(sort.field)) {
			const aVal = getNumericValue(a, sort.field);
			const bVal = getNumericValue(b, sort.field);
			return (aVal - bVal) * multiplier;
		}

		// String sort (session_name)
		const aName = a.session_name ?? a.session_id;
		const bName = b.session_name ?? b.session_id;
		return aName.localeCompare(bName) * multiplier;
	};

const getNumericValue = (s: SessionSummary, field: SortField): number => {
	switch (field) {
		case "duration_ms": return s.duration_ms;
		case "event_count": return s.event_count;
		case "agent_count": return s.agent_count ?? 0;
		case "file_size_bytes": return s.file_size_bytes;
		case "start_time": return s.start_time;
		default: return 0;
	}
};

// ── Sort cycle helper ───────────────────────────────────────────────

const cycleSortState = (current: SortState, field: SortField): SortState => {
	if (!current || current.field !== field) return { field, dir: "asc" };
	if (current.dir === "asc") return { field, dir: "desc" };
	return null;
};

// ── Sortable header component ───────────────────────────────────────

const SortableHeader: Component<{
	readonly label: string;
	readonly field: SortField;
	readonly sort: SortState;
	readonly onSort: (field: SortField) => void;
	readonly align?: "left" | "right";
}> = (props) => {
	const isActive = () => props.sort?.field === props.field;
	const isAsc = () => isActive() && props.sort?.dir === "asc";
	const isDesc = () => isActive() && props.sort?.dir === "desc";
	const alignClass = () => (props.align === "right" ? "text-right" : "");

	return (
		<th
			class={`px-4 py-3 font-medium cursor-pointer select-none transition hover:text-gray-700 dark:hover:text-gray-300 ${alignClass()} ${
				isActive() ? "text-gray-800 dark:text-gray-200" : ""
			}`}
			onClick={() => props.onSort(props.field)}
		>
			{props.label}
			<Show when={isAsc()}>
				<ArrowUp class="ml-0.5 inline h-3 w-3 text-blue-500 dark:text-blue-400" />
			</Show>
			<Show when={isDesc()}>
				<ArrowDown class="ml-0.5 inline h-3 w-3 text-blue-500 dark:text-blue-400" />
			</Show>
		</th>
	);
};

// ── Main component ──────────────────────────────────────────────────

export const SessionList: Component = () => {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams<{
		q?: string;
		status?: string;
		analyzed?: string;
		agents?: string;
		sort?: string;
		page?: string;
	}>();

	// Initialize from URL params
	const [search, setSearch] = createSignal(searchParams.q ?? "");
	const [statusFilter, setStatusFilter] = createSignal<StatusFilter>(
		isValidStatus(searchParams.status) ? searchParams.status : "all",
	);
	const [analyzedFilter, setAnalyzedFilter] = createSignal<AnalyzedFilter>(
		isValidAnalyzed(searchParams.analyzed) ? searchParams.analyzed : "all",
	);
	const [agentsFilter, setAgentsFilter] = createSignal<AgentsFilter>(
		isValidAgents(searchParams.agents) ? searchParams.agents : "all",
	);
	const [sortState, setSortState] = createSignal<SortState>(
		parseSortParam(searchParams.sort),
	);
	const [page, setPage] = createSignal(
		Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1),
	);
	const [selectedRow, setSelectedRow] = createSignal(-1);
	const PAGE_SIZE = 20;

	// Sync state -> URL params
	createEffect(() => {
		const params: Record<string, string | undefined> = {};
		const q = search();
		const status = statusFilter();
		const analyzed = analyzedFilter();
		const agents = agentsFilter();
		const sort = sortState();
		const p = page();
		params.q = q || undefined;
		params.status = status !== "all" ? status : undefined;
		params.analyzed = analyzed !== "all" ? analyzed : undefined;
		params.agents = agents !== "all" ? agents : undefined;
		params.sort = serializeSortParam(sort);
		params.page = p > 1 ? String(p) : undefined;
		setSearchParams(params);
	});

	// Filtered + searched sessions
	const filtered = createMemo(() => {
		const sessions = sessionList() ?? [];
		const q = search().toLowerCase();
		const status = statusFilter();
		const analyzed = analyzedFilter();
		const agents = agentsFilter();

		return sessions.filter((s) => {
			if (status !== "all" && s.status !== status) return false;
			if (analyzed === "analyzed" && !s.is_distilled) return false;
			if (analyzed === "not_analyzed" && s.is_distilled) return false;
			if (agents === "multi" && (s.agent_count ?? 0) <= 1) return false;
			if (agents === "solo" && (s.agent_count ?? 0) > 1) return false;
			if (q) {
				const name = (s.session_name ?? s.session_id).toLowerCase();
				const branch = (s.git_branch ?? "").toLowerCase();
				return name.includes(q) || branch.includes(q) || s.session_id.includes(q);
			}
			return true;
		});
	});

	// Sorted sessions
	const sorted = createMemo(() => {
		const items = filtered();
		const sort = sortState();
		if (!sort) return items;
		return [...items].sort(buildSortComparator(sort));
	});

	// Paginated slice
	const paginated = createMemo(() => {
		const all = sorted();
		const offset = (page() - 1) * PAGE_SIZE;
		return all.slice(offset, offset + PAGE_SIZE);
	});

	const totalPages = createMemo(() => Math.max(1, Math.ceil(sorted().length / PAGE_SIZE)));

	// ── Summary stats (derived from filtered sessions) ────────
	const todayCount = createMemo(() => filtered().filter((s) => isToday(s.start_time)).length);
	const totalEvents = createMemo(() => computeTotalEvents(filtered()));
	const avgDuration = createMemo(() => computeAvgDuration(filtered()));

	const handleRowClick = (session: SessionSummary) => {
		navigate(`/session/${session.session_id}`);
	};

	const handleSort = (field: SortField) => {
		setSortState((current) => cycleSortState(current, field));
		setPage(1);
		setSelectedRow(-1);
	};

	// ── Keyboard navigation ─────────────────────────────────────

	useKeyboard(() => [
		{
			key: "j",
			description: "Next row",
			handler: () => {
				setSelectedRow((r) => Math.min(r + 1, paginated().length - 1));
			},
		},
		{
			key: "k",
			description: "Previous row",
			handler: () => {
				setSelectedRow((r) => Math.max(r - 1, 0));
			},
		},
		{
			key: "Enter",
			description: "Open session",
			handler: () => {
				const idx = selectedRow();
				const sessions = paginated();
				if (idx >= 0 && idx < sessions.length) {
					handleRowClick(sessions[idx]);
				}
			},
		},
	]);

	return (
		<div class="p-4">
			{/* Header row: title + KPI stats + refresh */}
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-2">
					<h1 class="text-lg font-bold text-gray-800 dark:text-gray-100">Sessions</h1>
					<div class="flex items-center gap-1" title="Live updates via SSE">
						<LiveDot />
						<span class="text-[10px] text-gray-500">Live</span>
					</div>
				</div>

				{/* KPI stats — pushed right */}
				<Show when={sessionList.state !== "pending"}>
					<div class="ml-auto flex items-center gap-2">
						<SummaryStatPill icon={Database} label="Total" value={filtered().length} />
						<SummaryStatPill icon={Calendar} label="Today" value={todayCount()} />
						<SummaryStatPill icon={Activity} label="Events" value={totalEvents().toLocaleString()} />
						<SummaryStatPill icon={Clock} label="Avg" value={formatDuration(avgDuration())} />
						<button
							onClick={() => refetchSessions()}
							class="ml-1 flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
							title="Refresh sessions"
						>
							<RefreshCw class="h-3 w-3" />
						</button>
					</div>
				</Show>
			</div>

			{/* Error banner */}
			<Show when={globalError()}>
				{(err) => (
					<div class="mt-3 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
						<span>{err().message}</span>
						<button onClick={clearError} class="ml-4 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300">
							Dismiss
						</button>
					</div>
				)}
			</Show>

			{/* Filters */}
			<div class="mt-3 flex flex-wrap items-center gap-3">
				<div class="relative">
					<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-400" />
					<input
						type="text"
						placeholder="Search sessions..."
						value={search()}
						onInput={(e) => {
							setSearch(e.currentTarget.value);
							setPage(1);
							setSelectedRow(-1);
						}}
						class="w-64 rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:placeholder-gray-500 dark:focus:border-blue-600"
					/>
				</div>
				{/* Status filter */}
				<div class="flex rounded-md border border-gray-300 dark:border-gray-700">
					<For each={["all", "complete", "incomplete"] as const}>
						{(s) => (
							<button
								onClick={() => {
									setStatusFilter(s);
									setPage(1);
									setSelectedRow(-1);
								}}
								class={`px-3 py-1.5 text-xs font-medium transition ${
									statusFilter() === s
										? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white"
										: "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
								}`}
							>
								{s === "all" ? "All" : s === "complete" ? "Complete" : "Incomplete"}
							</button>
						)}
					</For>
				</div>
				{/* Analyzed filter */}
				<div class="flex rounded-md border border-gray-300 dark:border-gray-700">
					<For each={["all", "analyzed", "not_analyzed"] as const}>
						{(v) => (
							<button
								onClick={() => {
									setAnalyzedFilter(v);
									setPage(1);
									setSelectedRow(-1);
								}}
								class={`px-3 py-1.5 text-xs font-medium transition ${
									analyzedFilter() === v
										? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white"
										: "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
								}`}
							>
								{v === "all" ? "All" : v === "analyzed" ? "Analyzed" : "Not analyzed"}
							</button>
						)}
					</For>
				</div>
				{/* Agents filter */}
				<div class="flex rounded-md border border-gray-300 dark:border-gray-700">
					<For each={["all", "multi", "solo"] as const}>
						{(v) => (
							<button
								onClick={() => {
									setAgentsFilter(v);
									setPage(1);
									setSelectedRow(-1);
								}}
								class={`px-3 py-1.5 text-xs font-medium transition ${
									agentsFilter() === v
										? "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white"
										: "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
								}`}
							>
								{v === "all" ? "All" : v === "multi" ? "Multi-agent" : "Solo"}
							</button>
						)}
					</For>
				</div>
				<span class="text-sm text-gray-500">
					{filtered().length} session{filtered().length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Table */}
			<div class="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500 dark:border-gray-800 dark:bg-gray-900">
						<tr>
							<SortableHeader label="Name" field="session_name" sort={sortState()} onSort={handleSort} />
							<th class="px-4 py-3 font-medium">Status</th>
							<SortableHeader label="Duration" field="duration_ms" sort={sortState()} onSort={handleSort} align="right" />
							<SortableHeader label="Events" field="event_count" sort={sortState()} onSort={handleSort} align="right" />
							<SortableHeader label="Agents" field="agent_count" sort={sortState()} onSort={handleSort} align="right" />
							<SortableHeader label="Size" field="file_size_bytes" sort={sortState()} onSort={handleSort} align="right" />
							<th class="px-4 py-3 font-medium">Branch</th>
							<SortableHeader label="When" field="start_time" sort={sortState()} onSort={handleSort} />
							<th class="w-8 px-2 py-3"><span class="sr-only">Open</span></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100 dark:divide-gray-800/50">
						<Show when={sessionList.state !== "pending"} fallback={<LoadingSkeleton />}>
							<Show when={paginated().length > 0} fallback={<EmptyState />}>
								<For each={paginated()}>
									{(session, idx) => (
										<tr
											onClick={() => handleRowClick(session)}
											onKeyDown={(e: KeyboardEvent) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													handleRowClick(session);
												}
											}}
											role="link"
											tabIndex={0}
											class={`cursor-pointer transition ${
												selectedRow() === idx()
													? "bg-blue-50 dark:bg-blue-900/20"
													: "hover:bg-gray-50 dark:hover:bg-gray-800/50"
											}`}
										>
											<td class="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
												<div class="flex items-center gap-2">
													<A
														href={`/session/${session.session_id}`}
														class="hover:underline"
														onClick={(e: MouseEvent) => e.stopPropagation()}
													>
														{session.session_name ?? session.session_id.slice(0, 8)}
													</A>
													<Show when={session.is_distilled}>
														<span class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/40 dark:text-blue-400" title="Distilled">
															analyzed
														</span>
													</Show>
												</div>
											</td>
											<td class="px-4 py-3">
												<StatusBadge status={session.status} />
											</td>
											<td class="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
												{formatDuration(session.duration_ms)}
											</td>
											<td class="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{session.event_count}</td>
											<td class="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
												<div class="flex items-center justify-end gap-1.5">
													{session.agent_count ?? 1}
													<Show when={(session.agent_count ?? 0) > 1}>
														<A
															href={`/session/${session.session_id}?view=overview`}
															class="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
															onClick={(e: MouseEvent) => e.stopPropagation()}
															title="View multi-agent session"
														>
															<Users class="h-3 w-3" />
															team
														</A>
													</Show>
												</div>
											</td>
											<td class="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
												{formatSize(session.file_size_bytes)}
											</td>
											<td class="px-4 py-3">
												<Show when={session.git_branch} fallback={<span class="text-gray-400 dark:text-gray-400">-</span>}>
													<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
														{session.git_branch}
													</span>
												</Show>
											</td>
											<td class="px-4 py-3 text-gray-400 dark:text-gray-400">
												{formatDate(session.start_time)}
											</td>
											<td class="w-8 px-2 py-3 text-gray-300 dark:text-gray-400">
												<ChevronRight class="h-4 w-4" />
											</td>
										</tr>
									)}
								</For>
							</Show>
						</Show>
					</tbody>
				</table>
			</div>

			{/* Pagination */}
			<Show when={totalPages() > 1}>
				<div class="mt-4 flex items-center justify-between text-sm">
					<span class="text-gray-500">
						Page {page()} of {totalPages()}
					</span>
					<div class="flex gap-2">
						<button
							disabled={page() <= 1}
							onClick={() => {
								setPage((p) => p - 1);
								setSelectedRow(-1);
							}}
							class="rounded-md bg-gray-100 px-3 py-1 text-gray-700 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							Previous
						</button>
						<button
							disabled={page() >= totalPages()}
							onClick={() => {
								setPage((p) => p + 1);
								setSelectedRow(-1);
							}}
							class="rounded-md bg-gray-100 px-3 py-1 text-gray-700 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							Next
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
};

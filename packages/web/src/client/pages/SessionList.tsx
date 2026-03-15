import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { Search, ArrowUp, ArrowDown, RefreshCw, ChevronRight, Database, Calendar, Activity, Clock, Users, Layers } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js";
import { useKeyboard } from "../lib/keyboard";
import { sessionList, refetchSessions, globalError, clearError, workUnitList, refetchWorkUnits } from "../lib/stores";
import type { SessionSummary, WorkUnit } from "../../shared/types";
import { formatDuration, formatDate } from "../lib/format";
import { preferences } from "../lib/settings";
import { StatItem } from "../components/ui/StatItem";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { WorkUnitCard } from "../components/WorkUnitCard";
import { TelescopeIllustration } from "../components/ui/EmptyState";

// ── Live indicator ──────────────────────────────────────────────────

const LiveDot: Component = () => (
	<span class="relative flex h-2 w-2">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
		<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
	</span>
);


const formatSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(0)} KB`;
	return `${(kb / 1024).toFixed(1)} MB`;
};

// ── Loading skeleton ────────────────────────────────────────────────

const SkeletonRow: Component = () => (
	<tr class="animate-pulse">
		<td class="px-4 py-2"><div class="h-4 w-40 rounded bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-16 rounded bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-12 rounded bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-10 rounded bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-10 rounded bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-14 rounded bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-20 rounded bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-16 rounded bg-surface-muted" /></td>
		<td class="w-8 px-2 py-2" />
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
				<TelescopeIllustration class="h-12 w-12 text-muted" />
				<p class="text-lg font-medium">No sessions found</p>
				<p class="text-sm">
					Run a Claude Code session with cLens hooks to capture data.
				</p>
			</div>
		</td>
	</tr>
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

type ViewMode = "sessions" | "work_units";
type StatusFilter = "all" | "complete" | "incomplete";
type AnalyzedFilter = "all" | "analyzed" | "not_analyzed";
type AgentsFilter = "all" | "top_level" | "multi" | "solo";

const isValidViewMode = (s: string | undefined): s is ViewMode =>
	s === "sessions" || s === "work_units";

const isValidStatus = (s: string | undefined): s is StatusFilter =>
	s === "all" || s === "complete" || s === "incomplete";

const isValidAnalyzed = (s: string | undefined): s is AnalyzedFilter =>
	s === "all" || s === "analyzed" || s === "not_analyzed";

const isValidAgents = (s: string | undefined): s is AgentsFilter =>
	s === "all" || s === "top_level" || s === "multi" || s === "solo";

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
			class={`px-4 py-3 font-medium cursor-pointer select-none transition hover:text-secondary ${alignClass()} ${
				isActive() ? "text-primary" : ""
			}`}
			onClick={() => props.onSort(props.field)}
		>
			{props.label}
			<Show when={isAsc()}>
				<ArrowUp class="ml-0.5 inline h-3 w-3 text-brand-500 dark:text-brand-400" />
			</Show>
			<Show when={isDesc()}>
				<ArrowDown class="ml-0.5 inline h-3 w-3 text-brand-500 dark:text-brand-400" />
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
		view?: string;
	}>();

	// Initialize from URL params
	const [viewMode, setViewMode] = createSignal<ViewMode>(
		isValidViewMode(searchParams.view) ? searchParams.view : "sessions",
	);
	const [search, setSearch] = createSignal(searchParams.q ?? "");
	const [statusFilter, setStatusFilter] = createSignal<StatusFilter>(
		isValidStatus(searchParams.status) ? searchParams.status : "all",
	);
	const [analyzedFilter, setAnalyzedFilter] = createSignal<AnalyzedFilter>(
		isValidAnalyzed(searchParams.analyzed) ? searchParams.analyzed : "all",
	);
	const [agentsFilter, setAgentsFilter] = createSignal<AgentsFilter>(
		isValidAgents(searchParams.agents) ? searchParams.agents : "top_level",
	);
	const [sortState, setSortState] = createSignal<SortState>(
		parseSortParam(searchParams.sort),
	);
	const [page, setPage] = createSignal(
		Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1),
	);
	const [selectedRow, setSelectedRow] = createSignal(-1);
	const pageSize = () => preferences().sessionListLimit;

	// Sync state -> URL params
	createEffect(() => {
		const params: Record<string, string | undefined> = {};
		const q = search();
		const status = statusFilter();
		const analyzed = analyzedFilter();
		const agents = agentsFilter();
		const sort = sortState();
		const p = page();
		const v = viewMode();
		params.q = q || undefined;
		params.status = status !== "all" ? status : undefined;
		params.analyzed = analyzed !== "all" ? analyzed : undefined;
		params.agents = agents !== "top_level" ? agents : undefined;
		params.sort = serializeSortParam(sort);
		params.page = p > 1 ? String(p) : undefined;
		params.view = v !== "sessions" ? v : undefined;
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
			if (agents === "top_level" && s.is_subagent === true) return false;
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
		const ps = pageSize();
		const offset = (page() - 1) * ps;
		return all.slice(offset, offset + ps);
	});

	const totalPages = createMemo(() => Math.max(1, Math.ceil(sorted().length / pageSize())));

	// ── Work units filtered by search ────────────────────────
	const filteredWorkUnits = createMemo(() => {
		const units = workUnitList() ?? [];
		const q = search().toLowerCase();
		if (!q) return units;
		return units.filter((u) => {
			const spec = (u.spec_path ?? "").toLowerCase();
			const branch = (u.git_branch ?? "").toLowerCase();
			const sessionNames = u.sessions.map((s) => (s.session_name ?? s.session_id).toLowerCase());
			return spec.includes(q) || branch.includes(q) || sessionNames.some((n) => n.includes(q));
		});
	});

	const multiSessionUnits = createMemo(() =>
		filteredWorkUnits().filter(u => u.sessions.length > 1)
	);
	const standaloneUnits = createMemo(() =>
		filteredWorkUnits().filter(u => u.sessions.length <= 1)
	);

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

	let searchInputRef: HTMLInputElement | undefined;

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
		{
			key: "/",
			description: "Focus search",
			handler: () => {
				searchInputRef?.focus();
			},
		},
	], "Session List");

	return (
		<div class="mx-auto max-w-[1440px] p-4">
			{/* Header row: title + KPI stats + refresh */}
			<div class="flex items-center gap-4">
				<div class="flex items-center gap-3">
					{/* View toggle: Sessions / Work Units */}
					<SegmentedControl
						options={[
							{ label: "Sessions", value: "sessions" as ViewMode },
							{ label: "Work Units", value: "work_units" as ViewMode },
						]}
						value={viewMode()}
						onChange={(v) => {
							setViewMode(v);
							if (v === "sessions") { setPage(1); setSelectedRow(-1); }
							else { refetchWorkUnits(); }
						}}
					/>
					<div class="flex items-center gap-1" title="Live updates via SSE">
						<LiveDot />
						<span class="text-[10px] text-gray-500">Live</span>
					</div>
				</div>

				{/* KPI stats — pushed right */}
				<Show when={sessionList.state !== "pending"}>
					<div class="ml-auto flex items-center gap-2">
						<StatItem variant="pill" bordered icon={Database} label="Total" value={String(filtered().length)} />
						<StatItem variant="pill" bordered icon={Calendar} label="Today" value={String(todayCount())} />
						<StatItem variant="pill" bordered icon={Activity} label="Events" value={totalEvents().toLocaleString()} />
						<StatItem variant="pill" bordered icon={Clock} label="Avg" value={formatDuration(avgDuration())} />
						<button
							onClick={() => refetchSessions()}
							class="ml-1 flex items-center gap-1 rounded border border-clens px-2 py-1 text-xs text-muted transition hover:bg-surface-hover hover:text-secondary"
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
					<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
					<input
						ref={searchInputRef}
						type="text"
						placeholder="Search sessions (press /)"
						value={search()}
						onInput={(e) => {
							setSearch(e.currentTarget.value);
							setPage(1);
							setSelectedRow(-1);
						}}
						class="w-64 rounded-md border border-clens bg-surface-raised py-1.5 pl-8 pr-3 text-sm text-primary placeholder-gray-400 focus:border-brand-500 focus:outline-none"
					/>
				</div>
				{/* Status filter */}
				<SegmentedControl
					options={[
						{ label: "All", value: "all" as StatusFilter },
						{ label: "Complete", value: "complete" as StatusFilter },
						{ label: "Incomplete", value: "incomplete" as StatusFilter },
					]}
					value={statusFilter()}
					onChange={(v) => { setStatusFilter(v); setPage(1); setSelectedRow(-1); }}
				/>
				{/* Analyzed filter */}
				<SegmentedControl
					options={[
						{ label: "All", value: "all" as AnalyzedFilter },
						{ label: "Analyzed", value: "analyzed" as AnalyzedFilter },
						{ label: "Not analyzed", value: "not_analyzed" as AnalyzedFilter },
					]}
					value={analyzedFilter()}
					onChange={(v) => { setAnalyzedFilter(v); setPage(1); setSelectedRow(-1); }}
				/>
				{/* Agents filter */}
				<SegmentedControl
					options={[
						{ label: "All", value: "all" as AgentsFilter },
						{ label: "Top-level", value: "top_level" as AgentsFilter },
						{ label: "Multi-agent", value: "multi" as AgentsFilter },
						{ label: "Solo", value: "solo" as AgentsFilter },
					]}
					value={agentsFilter()}
					onChange={(v) => { setAgentsFilter(v); setPage(1); setSelectedRow(-1); }}
				/>
				<span class="text-sm text-gray-500">
					{filtered().length} session{filtered().length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Work Units View */}
			<Show when={viewMode() === "work_units"}>
				<div class="mt-3 space-y-3">
					<Show
						when={filteredWorkUnits().length > 0}
						fallback={
							<div class="flex flex-col items-center gap-2 py-12 text-gray-500">
								<Layers class="h-8 w-8 text-muted" />
								<p class="text-lg font-medium">No work units found</p>
								<p class="text-sm">Distill sessions with spec files to generate work units.</p>
							</div>
						}
					>
						<For each={multiSessionUnits()}>
							{(unit) => <WorkUnitCard unit={unit} />}
						</For>
						<Show when={standaloneUnits().length > 0}>
							<div class="flex items-center gap-2 pt-2">
								<div class="h-px flex-1 bg-surface-muted" />
								<span class="text-[10px] font-medium uppercase tracking-wide text-muted">Standalone</span>
								<div class="h-px flex-1 bg-surface-muted" />
							</div>
							<For each={standaloneUnits()}>
								{(unit) => <WorkUnitCard unit={unit} />}
							</For>
						</Show>
					</Show>
				</div>
			</Show>

			{/* Sessions Table */}
			<Show when={viewMode() === "sessions"}>
			<div class="mt-3 overflow-x-auto rounded-lg border border-clens">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-clens bg-surface-inset text-xs uppercase text-muted">
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
					<tbody class="divide-y divide-clens">
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
											tabIndex={0}
											class={`cursor-pointer transition even:bg-surface-muted/30 ${
												selectedRow() === idx()
													? "bg-brand-50 dark:bg-brand-900/20"
													: "hover:bg-surface-hover"
											}`}
										>
											<td class="px-4 py-2 font-medium text-primary">
												<div class="flex items-center gap-2">
													<A
														href={`/session/${session.session_id}`}
														class="font-mono hover:underline"
														onClick={(e: MouseEvent) => e.stopPropagation()}
													>
														{session.session_name ?? session.session_id.slice(0, 8)}
													</A>
													<Show when={session.is_distilled}>
														<span class="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-400" title="Distilled">
															analyzed
														</span>
													</Show>
												</div>
											</td>
											<td class="px-4 py-2">
												<StatusBadge status={session.status} compact />
											</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-muted">
												{formatDuration(session.duration_ms)}
											</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-muted">{session.event_count}</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-muted">
												<div class="flex items-center justify-end gap-1.5">
													{session.agent_count ?? 1}
													<Show when={(session.agent_count ?? 0) > 1}>
														<A
															href={`/session/${session.session_id}?view=overview`}
															class="inline-flex items-center gap-0.5 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted transition hover:bg-surface-hover"
															onClick={(e: MouseEvent) => e.stopPropagation()}
															title="View multi-agent session"
														>
															<Users class="h-3 w-3" />
															team
														</A>
													</Show>
												</div>
											</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-muted">
												{formatSize(session.file_size_bytes)}
											</td>
											<td class="px-4 py-2">
												<Show when={session.git_branch} fallback={<span class="text-muted">-</span>}>
													<span class="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-muted">
														{session.git_branch}
													</span>
												</Show>
											</td>
											<td class="px-4 py-2 font-mono text-muted">
												{formatDate(session.start_time, preferences().showTimestamps)}
											</td>
											<td class="w-8 px-2 py-2 text-muted">
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
			</Show>

			{/* Pagination */}
			<Show when={viewMode() === "sessions" && totalPages() > 1}>
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
							class="rounded-md bg-surface-muted px-3 py-1 text-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
						>
							Previous
						</button>
						<button
							disabled={page() >= totalPages()}
							onClick={() => {
								setPage((p) => p + 1);
								setSelectedRow(-1);
							}}
							class="rounded-md bg-surface-muted px-3 py-1 text-secondary transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
						>
							Next
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
};

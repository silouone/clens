import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { ArrowUp, ArrowDown, ChevronRight, Users, Layers, Pencil, Flag } from "lucide-solid";
import { FeatureBadges } from "../components/FeatureBadges";
import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js";
import { useKeyboard } from "../lib/keyboard";
import { sessionList, refetchSessions, setSessionMeta, globalError, clearError, workUnitList, refetchWorkUnits } from "../lib/stores";
import type { ColorName, SessionSummary, WorkUnit } from "../../shared/types";
import { formatDuration, formatDate } from "../lib/format";
import { preferences } from "../lib/settings";
import { SHOW_WORK_UNITS } from "../lib/feature-flags";

import { StatusBadge } from "../components/ui/StatusBadge";
import { ColorFlag } from "../components/ui/ColorFlag";
import { WorkUnitCard } from "../components/WorkUnitCard";
import { FilterBar } from "../components/FilterBar";
import { TelescopeIllustration } from "../components/ui/EmptyState";
import { ProjectBadge } from "../components/ProjectFilter";
import { isGlobalMode, selectedProjectId, setSelectedProjectId, projectList } from "../lib/project-store";


// ── Naming / color-flag accessors ───────────────────────────────────

/** Resolved display name for a row, falling back through the API precedence. */
const displayName = (s: SessionSummary): string =>
	s.display_name ?? s.session_name ?? s.session_id.slice(0, 8);

/** The row's color flag, normalized to a ColorName ("none" when unflagged). */
const flagColor = (s: SessionSummary): ColorName => s.color ?? "none";

/** A session is flagged when it carries a non-"none" color. */
const isFlagged = (s: SessionSummary): boolean => flagColor(s) !== "none";

const formatSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${kb.toFixed(0)} KB`;
	return `${(kb / 1024).toFixed(1)} MB`;
};

// ── Loading skeleton ────────────────────────────────────────────────

const SkeletonRow: Component = () => (
	<tr class="animate-pulse">
		<td class="px-4 py-2"><div class="h-4 w-40 rounded-none bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-16 rounded-none bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-12 rounded-none bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-10 rounded-none bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-10 rounded-none bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-14 rounded-none bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-20 rounded-none bg-surface-muted" /></td>
		<td class="px-4 py-2"><div class="h-4 w-16 rounded-none bg-surface-muted" /></td>
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
		<td colspan="9" class="px-4 py-14 text-center text-muted">
			<div class="flex flex-col items-center gap-3">
				<TelescopeIllustration class="h-12 w-12 text-muted" />
				<p class="instrument-microcaps text-sm tracking-[0.14em] text-secondary">No sessions found</p>
				<p class="max-w-xs text-xs leading-relaxed">
					Run a Claude Code session with cLens hooks to capture data.
				</p>
				<div class="mt-1 inline-flex items-center gap-2 border border-clens bg-surface-inset px-2 py-1">
					<span class="instrument-led bg-surface-muted" />
					<span class="instrument-microcaps text-[10px] text-muted">awaiting signal</span>
				</div>
			</div>
		</td>
	</tr>
);



// ── Filter types ────────────────────────────────────────────────────

type ViewMode = "sessions" | "work_units";
// "incomplete" is a legacy URL alias matching active+idle (status union changed
// from complete|incomplete to complete|active|idle — bug B6)
type StatusFilter = "all" | "complete" | "active" | "idle" | "incomplete";
type AnalyzedFilter = "all" | "analyzed" | "not_analyzed";
type AgentsFilter = "all" | "top_level" | "multi" | "solo";
type FeaturesFilter = "all" | "any" | "loop" | "goal" | "workflow";
type LifecycleFilter = "all" | "prime-plan-build" | "prime-build" | "plan-build" | "plan-build-review" | "multi-build" | "ad-hoc";
type LinkTypeFilter = "all" | "spec" | "branch_time";

const isValidViewMode = (s: string | undefined): s is ViewMode =>
	s === "sessions" || s === "work_units";

const isValidStatus = (s: string | undefined): s is StatusFilter =>
	s === "all" || s === "complete" || s === "active" || s === "idle" || s === "incomplete";

/** True when a session row matches the selected status filter. */
const matchesStatusFilter = (sessionStatus: string, filter: StatusFilter): boolean => {
	if (filter === "all") return true;
	if (filter === "incomplete") return sessionStatus !== "complete";
	return sessionStatus === filter;
};

const isValidDayKey = (s: string | undefined): s is string =>
	typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Local-calendar-day key for an epoch-ms timestamp (matches analytics bucketing). */
const localDayKey = (t: number): string => {
	const d = new Date(t);
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const isOnLocalDay = (t: number, dayKey: string): boolean => localDayKey(t) === dayKey;

const isValidAnalyzed = (s: string | undefined): s is AnalyzedFilter =>
	s === "all" || s === "analyzed" || s === "not_analyzed";

const isValidAgents = (s: string | undefined): s is AgentsFilter =>
	s === "all" || s === "top_level" || s === "multi" || s === "solo";

const isValidFeatures = (s: string | undefined): s is FeaturesFilter =>
	s === "all" || s === "any" || s === "loop" || s === "goal" || s === "workflow";

const isValidLifecycle = (s: string | undefined): s is LifecycleFilter =>
	s === "all" || s === "prime-plan-build" || s === "prime-build" || s === "plan-build" || s === "plan-build-review" || s === "multi-build" || s === "ad-hoc";

const isValidLinkType = (s: string | undefined): s is LinkTypeFilter =>
	s === "all" || s === "spec" || s === "branch_time";

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

		// String sort (display name)
		const aName = displayName(a);
		const bName = displayName(b);
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
			class={`instrument-microcaps px-4 py-2.5 cursor-pointer select-none transition hover:text-secondary ${alignClass()} ${
				isActive() ? "text-primary" : ""
			}`}
			onClick={() => props.onSort(props.field)}
		>
			{props.label}
			<Show when={isAsc()}>
				<ArrowUp class="ml-0.5 inline h-3 w-3 text-brand-500" />
			</Show>
			<Show when={isDesc()}>
				<ArrowDown class="ml-0.5 inline h-3 w-3 text-brand-500" />
			</Show>
		</th>
	);
};

// ── Global-mode field accessors ──────────────────────────────────────

const hasProjectId = (s: SessionSummary): s is SessionSummary & { readonly project_id: string } =>
	"project_id" in s;

const hasProjectName = (s: SessionSummary): s is SessionSummary & { readonly project_name: string } =>
	"project_name" in s;

const getProjectId = (s: SessionSummary): string | undefined =>
	hasProjectId(s) ? s.project_id : undefined;

const getProjectName = (s: SessionSummary): string | undefined =>
	hasProjectName(s) ? s.project_name : undefined;

const hasWorkUnitProjectId = (u: WorkUnit): u is WorkUnit & { readonly project_id: string } =>
	"project_id" in u;

const getWorkUnitProjectId = (u: WorkUnit): string | undefined =>
	hasWorkUnitProjectId(u) ? u.project_id : undefined;

// ── Honest count label (B25) ─────────────────────────────────────────

/**
 * Build the result-count label. When active filters hide sessions the API
 * returned (e.g. the default Top-level filter excluding subagents, or the
 * status/feature filters), surface both numbers as "X of Y sessions" so the
 * count is honest rather than silently showing the post-filter number as if it
 * were the total. When nothing is hidden, fall back to the plain "Y sessions".
 */
export const buildCountLabel = (shown: number, total: number): string => {
	const noun = `session${total !== 1 ? "s" : ""}`;
	return shown < total ? `of ${total} ${noun}` : noun;
};

// ── Inline rename + color controls (NAME cell) ──────────────────────

/**
 * NAME cell for a session row. Shows `display_name` as the primary line with the
 * short id as a secondary (R17). A pencil affordance (visible on row hover)
 * switches the name into an inline input: Enter saves, Esc cancels, and a blank /
 * whitespace-only value clears the custom label (R6/R7/R8 — the server reverts to
 * the next precedence source). A per-row color dot + swatch picker sets/clears the
 * flag (R10/R13). All controls stopPropagation so they never trigger row navigation.
 */
const SessionRowName: Component<{ readonly session: SessionSummary }> = (props) => {
	const [editing, setEditing] = createSignal(false);
	const [draft, setDraft] = createSignal("");
	let inputRef: HTMLInputElement | undefined;

	const beginEdit = () => {
		// Seed with the current custom label only (not the computed name) so saving
		// an untouched field is a no-op rather than freezing a computed name as a label.
		setDraft(props.session.label ?? "");
		setEditing(true);
		queueMicrotask(() => inputRef?.focus());
	};

	const commit = () => {
		if (!editing()) return;
		setEditing(false);
		const value = draft();
		const trimmed = value.trim();
		// Blank/whitespace clears the label (null); otherwise set the trimmed label.
		// Skip the call when nothing changed versus the stored label.
		const currentLabel = props.session.label ?? "";
		if (trimmed === currentLabel.trim()) return;
		void setSessionMeta(props.session.session_id, { label: trimmed.length > 0 ? trimmed : null });
	};

	const cancel = () => {
		setEditing(false);
		setDraft("");
	};

	const onColor = (color: ColorName) => {
		void setSessionMeta(props.session.session_id, { color });
	};

	return (
		<div class="flex items-center gap-2">
			{/* Color flag picker — dot + swatch popover */}
			<ColorFlag value={flagColor(props.session)} onChange={onColor} />

			<Show
				when={!editing()}
				fallback={
					<input
						ref={inputRef}
						type="text"
						value={draft()}
						placeholder="Name this session…"
						onClick={(e) => e.stopPropagation()}
						onInput={(e) => setDraft(e.currentTarget.value)}
						onKeyDown={(e: KeyboardEvent) => {
							e.stopPropagation();
							if (e.key === "Enter") { e.preventDefault(); commit(); }
							else if (e.key === "Escape") { e.preventDefault(); cancel(); }
						}}
						onBlur={commit}
						class="w-56 rounded-none border border-brand-500 bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-primary focus:outline-none"
					/>
				}
			>
				<div class="flex min-w-0 flex-col leading-tight">
					<div class="flex items-center gap-1.5">
						<A
							href={`/session/${props.session.session_id}`}
							class="truncate font-mono text-secondary hover:text-brand-500 hover:underline"
							onClick={(e: MouseEvent) => e.stopPropagation()}
							title={displayName(props.session)}
						>
							{displayName(props.session)}
						</A>
						<button
							type="button"
							onClick={(e) => { e.stopPropagation(); beginEdit(); }}
							class="rounded-none p-0.5 text-muted opacity-0 transition group-hover:opacity-100 hover:text-brand-500"
							title="Rename session"
							aria-label="Rename session"
						>
							<Pencil class="h-3 w-3" />
						</button>
					</div>
					{/* Secondary: short id (R17) */}
					<span class="font-mono text-[10px] tabular-nums text-muted">
						{props.session.session_id.slice(0, 8)}
					</span>
				</div>
			</Show>

			<Show when={props.session.is_distilled}>
				<span class="instrument-microcaps inline-flex items-center gap-1 rounded-none border border-clens px-1.5 py-0.5 text-[9px] text-brand-500" title="Distilled"><span class="instrument-led bg-brand-500" />
					analyzed
				</span>
			</Show>
			<FeatureBadges features={props.session.features} />
		</div>
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
		features?: string;
		sort?: string;
		page?: string;
		view?: string;
		lifecycle?: string;
		link_type?: string;
		date?: string;
		flagged?: string;
	}>();

	// viewMode is derived from URL params (header nav controls it).
	// Work Units is feature-flagged off: when hidden, force "sessions" so the
	// work-units view, its toggle, and its refetch are all unreachable even via a
	// direct ?view=work_units URL. The work-unit render blocks below stay intact.
	const viewMode = (): ViewMode =>
		SHOW_WORK_UNITS && isValidViewMode(searchParams.view) ? searchParams.view : "sessions";
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
	const [featuresFilter, setFeaturesFilter] = createSignal<FeaturesFilter>(
		isValidFeatures(searchParams.features) ? searchParams.features : "all",
	);
	// Flagged-only filter (R12): narrows the list to sessions with a non-"none" color.
	const [flaggedFilter, setFlaggedFilter] = createSignal<boolean>(
		searchParams.flagged === "1",
	);
	const [lifecycleFilter, setLifecycleFilter] = createSignal<LifecycleFilter>(
		isValidLifecycle(searchParams.lifecycle) ? searchParams.lifecycle : "all",
	);
	const [linkTypeFilter, setLinkTypeFilter] = createSignal<LinkTypeFilter>(
		isValidLinkType(searchParams.link_type) ? searchParams.link_type : "all",
	);
	const [sortState, setSortState] = createSignal<SortState>(
		parseSortParam(searchParams.sort),
	);
	// Local-day filter set by Usage/Insights chart date clicks (?date=YYYY-MM-DD, bug B22)
	const [dateFilter, setDateFilter] = createSignal<string | undefined>(
		isValidDayKey(searchParams.date) ? searchParams.date : undefined,
	);
	const [page, setPage] = createSignal(
		Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1),
	);
	const [selectedRow, setSelectedRow] = createSignal(-1);
	const pageSize = () => preferences().sessionListLimit;

	// Sync state -> URL params (viewMode is driven by URL, not synced back)
	createEffect(() => {
		const params: Record<string, string | undefined> = {};
		const q = search();
		const status = statusFilter();
		const analyzed = analyzedFilter();
		const agents = agentsFilter();
		const features = featuresFilter();
		const flagged = flaggedFilter();
		const lifecycle = lifecycleFilter();
		const linkType = linkTypeFilter();
		const sort = sortState();
		const p = page();
		params.q = q || undefined;
		params.status = status !== "all" ? status : undefined;
		params.date = dateFilter();
		params.analyzed = analyzed !== "all" ? analyzed : undefined;
		params.agents = agents !== "top_level" ? agents : undefined;
		params.features = features !== "all" ? features : undefined;
		params.flagged = flagged ? "1" : undefined;
		params.lifecycle = lifecycle !== "all" ? lifecycle : undefined;
		params.link_type = linkType !== "all" ? linkType : undefined;
		params.sort = serializeSortParam(sort);
		params.page = p > 1 ? String(p) : undefined;
		setSearchParams(params);
	});

	// Refetch work units when switching to work_units view
	createEffect(() => {
		if (viewMode() === "work_units") {
			refetchWorkUnits();
		}
	});

	// Filtered + searched sessions
	const filtered = createMemo(() => {
		const sessions = sessionList() ?? [];
		const q = search().toLowerCase();
		const status = statusFilter();
		const analyzed = analyzedFilter();
		const agents = agentsFilter();
		const features = featuresFilter();
		const flagged = flaggedFilter();
		const projectId = selectedProjectId();

		return sessions.filter((s) => {
			// B24: do NOT hide zero-duration sessions. Single-event sessions (e.g. a
			// lone SessionEnd) have duration_ms === 0 but are real sessions the API
			// returns — every one must be findable via search. They render with
			// 0 duration and an idle/complete status badge.
			// Project filter (global mode)
			if (projectId !== undefined && getProjectId(s) !== projectId) return false;
			if (!matchesStatusFilter(s.status, status)) return false;
			if (dateFilter() && !isOnLocalDay(s.start_time, dateFilter() ?? "")) return false;
			if (analyzed === "analyzed" && !s.is_distilled) return false;
			if (analyzed === "not_analyzed" && s.is_distilled) return false;
			if (agents === "top_level" && s.is_subagent === true) return false;
			if (agents === "multi" && (s.agent_count ?? 0) <= 1) return false;
			if (agents === "solo" && (s.agent_count ?? 0) > 1) return false;
			if (features === "any" && (s.features?.length ?? 0) === 0) return false;
			if ((features === "loop" || features === "goal" || features === "workflow") && !s.features?.includes(features)) return false;
			if (flagged && !isFlagged(s)) return false;
			if (q) {
				const name = displayName(s).toLowerCase();
				const branch = (s.git_branch ?? "").toLowerCase();
				return name.includes(q) || branch.includes(q) || s.session_id.includes(q);
			}
			return true;
		});
	});

	// B25: total sessions in the current project scope, BEFORE status/analyzed/
	// agents/features/search filters. Used as the honest denominator so the count
	// label can reveal how many sessions the default filters are hiding.
	const scopedTotal = createMemo(() => {
		const sessions = sessionList() ?? [];
		const projectId = selectedProjectId();
		if (projectId === undefined) return sessions.length;
		return sessions.filter((s) => getProjectId(s) === projectId).length;
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

	// ── Work units filtered by search + project + lifecycle + link_type ──
	const filteredWorkUnits = createMemo(() => {
		const units = workUnitList() ?? [];
		const q = search().toLowerCase();
		const projectId = selectedProjectId();
		const lifecycle = lifecycleFilter();
		const linkType = linkTypeFilter();

		return units.filter((u) => {
			if (u.total_duration_ms <= 0) return false;
			// Project filter (global mode)
			if (projectId !== undefined && getWorkUnitProjectId(u) !== projectId) return false;
			if (lifecycle !== "all" && u.lifecycle !== lifecycle) return false;
			if (linkType !== "all" && u.link_type !== linkType) return false;
			if (!q) return true;
			const spec = (u.spec_path ?? "").toLowerCase();
			const branch = (u.git_branch ?? "").toLowerCase();
			const sessionNames = u.sessions.map((s) => (s.session_name ?? s.session_id).toLowerCase());
			return spec.includes(q) || branch.includes(q) || sessionNames.some((n) => n.includes(q));
		});
	});

	// ── Header KPI readouts (derived from already-loaded session store; no fetch) ──
	const kpis = createMemo(() => {
		const sessions = sessionList() ?? [];
		const projectId = selectedProjectId();
		const scoped = projectId === undefined
			? sessions
			: sessions.filter((s) => getProjectId(s) === projectId);
		const active = scoped.filter((s) => s.status === "active").length;
		const analyzed = scoped.filter((s) => s.is_distilled).length;
		const events = scoped.reduce((sum, s) => sum + s.event_count, 0);
		const duration = scoped.reduce((sum, s) => sum + s.duration_ms, 0);
		return { total: scoped.length, active, analyzed, events, duration };
	});

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
			{/* Console header — title + KPI readout band */}
			<div class="border border-clens bg-surface-inset">
				<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-3 pb-2.5">
					<div class="flex items-baseline gap-2.5">
						<span class="instrument-led instrument-led--live bg-[var(--clens-live)]" />
						<h1 class="instrument-microcaps text-[13px] tracking-[0.14em] text-primary">
							{viewMode() === "work_units" ? "Work Units" : "Sessions"}
						</h1>
						<span class="instrument-microcaps text-[10px] text-muted">cLens console</span>
					</div>
					<dl class="flex items-stretch gap-px overflow-hidden border border-clens bg-surface-muted text-right">
						<div class="bg-surface px-3 py-1">
							<dt class="instrument-microcaps text-[9px] text-muted">Sessions</dt>
							<dd class="font-mono text-sm tabular-nums text-primary">{kpis().total}</dd>
						</div>
						<div class="bg-surface px-3 py-1">
							<dt class="instrument-microcaps text-[9px] text-muted">Active</dt>
							<dd class="font-mono text-sm tabular-nums text-brand-500">{kpis().active}</dd>
						</div>
						<div class="bg-surface px-3 py-1">
							<dt class="instrument-microcaps text-[9px] text-muted">Analyzed</dt>
							<dd class="font-mono text-sm tabular-nums text-secondary">{kpis().analyzed}</dd>
						</div>
						<div class="bg-surface px-3 py-1">
							<dt class="instrument-microcaps text-[9px] text-muted">Events</dt>
							<dd class="font-mono text-sm tabular-nums text-secondary">{kpis().events.toLocaleString()}</dd>
						</div>
						<div class="bg-surface px-3 py-1">
							<dt class="instrument-microcaps text-[9px] text-muted">Total time</dt>
							<dd class="font-mono text-sm tabular-nums text-secondary">{formatDuration(kpis().duration)}</dd>
						</div>
					</dl>
				</div>
				<div class="instrument-ruler" />
			</div>

			{/* Error banner */}
			<Show when={globalError()}>
				{(err) => (
					<div class="mt-3 flex items-center justify-between rounded-none border-l-2 border-[var(--clens-danger)] bg-surface-inset px-3 py-1.5 text-xs text-[var(--clens-danger)]">
						<span class="font-mono">{err().message}</span>
						<button onClick={clearError} class="instrument-microcaps ml-4 text-[10px] text-muted hover:text-[var(--clens-danger)]">
							Dismiss
						</button>
					</div>
				)}
			</Show>

			{/* Filters — view-aware */}
			<Show when={viewMode() === "sessions"}>
				<FilterBar
					searchPlaceholder="Search sessions (press /)"
					searchValue={search()}
					onSearch={(v) => { setSearch(v); setPage(1); setSelectedRow(-1); }}
					searchRef={(el) => { searchInputRef = el; }}
					filters={[
						...(isGlobalMode() ? [{
							key: "project",
							variant: "dropdown" as const,
							label: "All Projects",
							options: [
								{ label: "All Projects", value: "all" },
								...(projectList() ?? []).map((p) => ({ label: p.name, value: p.id })),
							],
							value: selectedProjectId() ?? "all",
							onChange: (v: string) => { setSelectedProjectId(v === "all" ? undefined : v); setPage(1); setSelectedRow(-1); },
						}] : []),
						{ key: "status", options: [{ label: "All", value: "all" }, { label: "Complete", value: "complete" }, { label: "Active", value: "active" }, { label: "Idle", value: "idle" }], value: statusFilter(), onChange: (v: string) => { setStatusFilter(v as StatusFilter); setPage(1); setSelectedRow(-1); } },
						{ key: "analyzed", options: [{ label: "All", value: "all" }, { label: "Analyzed", value: "analyzed" }, { label: "Not analyzed", value: "not_analyzed" }], value: analyzedFilter(), onChange: (v: string) => { setAnalyzedFilter(v as AnalyzedFilter); setPage(1); setSelectedRow(-1); } },
						{ key: "agents", options: [{ label: "All", value: "all" }, { label: "Top-level", value: "top_level" }, { label: "Multi-agent", value: "multi" }, { label: "Solo", value: "solo" }], value: agentsFilter(), onChange: (v: string) => { setAgentsFilter(v as AgentsFilter); setPage(1); setSelectedRow(-1); } },
						{ key: "features", options: [{ label: "All", value: "all" }, { label: "Any feature", value: "any" }, { label: "Loop", value: "loop" }, { label: "Goal", value: "goal" }, { label: "Workflow", value: "workflow" }], value: featuresFilter(), onChange: (v: string) => { setFeaturesFilter(v as FeaturesFilter); setPage(1); setSelectedRow(-1); } },
					]}
					resultCount={filtered().length}
					resultLabel={buildCountLabel(filtered().length, scopedTotal())}
					onRefresh={() => { refetchSessions(); refetchWorkUnits(); }}
				/>
				{/* Flagged-only toggle chip (R12) — narrows to color !== "none" */}
				<div class="mt-2 flex items-center">
					<button
						type="button"
						aria-pressed={flaggedFilter()}
						onClick={() => { setFlaggedFilter((v) => !v); setPage(1); setSelectedRow(-1); }}
						class={`instrument-microcaps inline-flex items-center gap-1.5 rounded-none border px-2 py-1 text-[10px] transition ${
							flaggedFilter()
								? "border-brand-500 bg-surface-selected text-primary"
								: "border-clens text-muted hover:border-brand-500 hover:text-secondary"
						}`}
						title="Show only flagged sessions"
					>
						<Flag class="h-3 w-3" classList={{ "fill-current": flaggedFilter() }} />
						Flagged
					</button>
				</div>
				<Show when={dateFilter()}>
					<div class="flex items-center gap-2 border-b border-clens bg-surface-inset px-4 py-1.5 text-xs text-secondary">
						<span class="instrument-microcaps text-[10px] text-muted">
							Showing sessions from <span class="font-mono text-xs tabular-nums normal-case text-secondary">{dateFilter()}</span>
						</span>
						<button
							type="button"
							class="instrument-microcaps rounded-none border border-clens px-1.5 py-0.5 text-[10px] text-muted transition hover:border-brand-500 hover:text-primary"
							onClick={() => { setDateFilter(undefined); setPage(1); setSelectedRow(-1); }}
						>
							Clear ✕
						</button>
					</div>
				</Show>
			</Show>
			<Show when={viewMode() === "work_units"}>
				<FilterBar
					searchPlaceholder="Search work units (press /)"
					searchValue={search()}
					onSearch={(v) => { setSearch(v); }}
					searchRef={(el) => { searchInputRef = el; }}
					filters={[
						{ key: "lifecycle", variant: "dropdown", label: "Lifecycle", options: [{ label: "All Lifecycles", value: "all" }, { label: "Prime > Build", value: "prime-build" }, { label: "Prime > Plan > Build", value: "prime-plan-build" }, { label: "Plan > Build", value: "plan-build" }, { label: "Plan > Build > Review", value: "plan-build-review" }, { label: "Multi-Build", value: "multi-build" }, { label: "Ad-hoc", value: "ad-hoc" }], value: lifecycleFilter(), onChange: (v: string) => { setLifecycleFilter(v as LifecycleFilter); } },
						{ key: "link_type", variant: "dropdown", label: "Link Type", options: [{ label: "All Types", value: "all" }, { label: "Spec-linked", value: "spec" }, { label: "Branch-linked", value: "branch_time" }], value: linkTypeFilter(), onChange: (v: string) => { setLinkTypeFilter(v as LinkTypeFilter); } },
					]}
					resultCount={filteredWorkUnits().length}
					resultLabel={`work unit${filteredWorkUnits().length !== 1 ? "s" : ""}`}
					onRefresh={() => { refetchWorkUnits(); }}
				/>
			</Show>

			{/* Work Units View */}
			<Show when={viewMode() === "work_units"}>
				<div class="mt-3">
					<Show
						when={filteredWorkUnits().length > 0}
						fallback={
							<div class="flex flex-col items-center gap-3 border border-clens bg-surface-inset py-14 text-muted">
								<Layers class="h-8 w-8 text-muted" />
								<p class="instrument-microcaps text-sm tracking-[0.14em] text-secondary">No work units found</p>
								<p class="max-w-xs text-center text-xs leading-relaxed">Distill sessions with spec files to generate work units.</p>
							</div>
						}
					>
						<div class="overflow-hidden rounded-none border border-clens">
							<For each={filteredWorkUnits()}>
								{(unit) => <WorkUnitCard unit={unit} />}
							</For>
						</div>
					</Show>
				</div>
			</Show>

			{/* Sessions Table */}
			<Show when={viewMode() === "sessions"}>
			<div class="mt-3 overflow-x-auto rounded-none border border-clens">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-clens bg-surface-inset text-[10px] text-muted">
						<tr>
							<SortableHeader label="Name" field="session_name" sort={sortState()} onSort={handleSort} />
							<Show when={isGlobalMode()}>
								<th class="instrument-microcaps px-4 py-2.5">Project</th>
							</Show>
							<th class="instrument-microcaps px-4 py-2.5">Status</th>
							<SortableHeader label="Duration" field="duration_ms" sort={sortState()} onSort={handleSort} align="right" />
							<SortableHeader label="Events" field="event_count" sort={sortState()} onSort={handleSort} align="right" />
							<SortableHeader label="Agents" field="agent_count" sort={sortState()} onSort={handleSort} align="right" />
							<SortableHeader label="Size" field="file_size_bytes" sort={sortState()} onSort={handleSort} align="right" />
							<th class="instrument-microcaps px-4 py-2.5">Branch</th>
							<SortableHeader label="When" field="start_time" sort={sortState()} onSort={handleSort} />
							<th class="w-8 px-2 py-2.5"><span class="sr-only">Open</span></th>
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
											// Flagged rows get a colored left-rule so they pop out (R11). Use a
											// left BORDER (not box-shadow) for the flag so it coexists with the
											// selected/hover brand inset-shadow rule instead of overriding it.
											style={isFlagged(session)
												? { "border-left": `2px solid var(--clens-flag-${flagColor(session)})` }
												: undefined}
											class={`group cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:bg-surface-hover ${
												selectedRow() === idx()
													? "bg-surface-selected shadow-[inset_2px_0_0_0_var(--clens-brand)]"
													: "hover:bg-surface-hover hover:shadow-[inset_2px_0_0_0_var(--clens-border)]"
											}`}
										>
											<td class="px-4 py-2 font-medium text-primary">
												<SessionRowName session={session} />
											</td>
											<Show when={isGlobalMode()}>
											<td class="px-4 py-2">
												{(() => {
													const pid = getProjectId(session);
													const pname = getProjectName(session);
													return pid && pname
														? <ProjectBadge projectId={pid} projectName={pname} />
														: null;
												})()}
											</td>
										</Show>
										<td class="px-4 py-2">
												<StatusBadge status={session.status} compact />
											</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-secondary">
												{formatDuration(session.duration_ms)}
											</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-secondary">{session.event_count}</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-secondary">
												<div class="flex items-center justify-end gap-1.5">
													{session.agent_count ?? 1}
													<Show when={(session.agent_count ?? 0) > 1}>
														<A
															href={`/session/${session.session_id}?view=overview`}
															class="instrument-microcaps inline-flex items-center gap-0.5 rounded-none border border-clens px-1.5 py-0.5 text-[9px] text-muted transition hover:border-brand-500 hover:text-brand-500"
															onClick={(e: MouseEvent) => e.stopPropagation()}
															title="View multi-agent session"
														>
															<Users class="h-3 w-3" />
															team
														</A>
													</Show>
												</div>
											</td>
											<td class="px-4 py-2 text-right font-mono tabular-nums text-secondary">
												{formatSize(session.file_size_bytes)}
											</td>
											<td class="px-4 py-2">
												<Show when={session.git_branch} fallback={<span class="text-muted">—</span>}>
													<span class="rounded-none border border-clens bg-surface-inset px-1.5 py-0.5 font-mono text-xs text-secondary">
														{session.git_branch}
													</span>
												</Show>
											</td>
											<td class="px-4 py-2 font-mono tabular-nums text-muted">
												{formatDate(session.start_time, preferences().showTimestamps)}
											</td>
											<td class="w-8 px-2 py-2 text-muted">
												<ChevronRight class="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-brand-500" />
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
					<span class="instrument-microcaps flex items-baseline gap-1 text-[10px] text-muted">
						Page <span class="font-mono text-xs tabular-nums text-secondary">{page()}</span> of <span class="font-mono text-xs tabular-nums text-secondary">{totalPages()}</span>
					</span>
					<div class="flex gap-2">
						<button
							disabled={page() <= 1}
							onClick={() => {
								setPage((p) => p - 1);
								setSelectedRow(-1);
							}}
							class="instrument-microcaps rounded-none border border-clens px-3 py-1 text-[10px] text-secondary transition hover:bg-surface-hover hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-clens"
						>
							Previous
						</button>
						<button
							disabled={page() >= totalPages()}
							onClick={() => {
								setPage((p) => p + 1);
								setSelectedRow(-1);
							}}
							class="instrument-microcaps rounded-none border border-clens px-3 py-1 text-[10px] text-secondary transition hover:bg-surface-hover hover:border-brand-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-clens"
						>
							Next
						</button>
					</div>
				</div>
			</Show>
		</div>
	);
};

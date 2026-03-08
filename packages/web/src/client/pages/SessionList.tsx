import { useNavigate, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, For, Show, type Component } from "solid-js";
import { useKeyboard } from "../lib/keyboard";
import { sessionList, refetchSessions, globalError, clearError } from "../lib/stores";
import type { SessionSummary } from "../../shared/types";

// ── Live indicator ──────────────────────────────────────────────────

const LiveDot: Component = () => (
	<span class="relative flex h-2 w-2">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
		<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
	</span>
);

// ── Formatting helpers ──────────────────────────────────────────────

const formatDuration = (ms: number): string => {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

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

// ── Status badge ────────────────────────────────────────────────────

const StatusBadge: Component<{ readonly status: string }> = (props) => {
	const cls = () =>
		props.status === "complete"
			? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-400 dark:border-emerald-700/50"
			: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50";

	return (
		<span
			class={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls()}`}
		>
			{props.status}
		</span>
	);
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
		<td colspan="8" class="px-4 py-12 text-center text-gray-500">
			<p class="text-lg font-medium">No sessions found</p>
			<p class="mt-1 text-sm">
				Run a Claude Code session with cLens hooks to capture data.
			</p>
		</td>
	</tr>
);

// ── Filter types ────────────────────────────────────────────────────

type StatusFilter = "all" | "complete" | "incomplete";

const isValidStatus = (s: string | undefined): s is StatusFilter =>
	s === "all" || s === "complete" || s === "incomplete";

// ── Main component ──────────────────────────────────────────────────

export const SessionList: Component = () => {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams<{
		q?: string;
		status?: string;
		page?: string;
	}>();

	// Initialize from URL params
	const [search, setSearch] = createSignal(searchParams.q ?? "");
	const [statusFilter, setStatusFilter] = createSignal<StatusFilter>(
		isValidStatus(searchParams.status) ? searchParams.status : "all",
	);
	const [page, setPage] = createSignal(
		Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1),
	);
	const [selectedRow, setSelectedRow] = createSignal(-1);
	const PAGE_SIZE = 20;

	// Sync state → URL params
	createEffect(() => {
		const params: Record<string, string | undefined> = {};
		const q = search();
		const s = statusFilter();
		const p = page();
		params.q = q || undefined;
		params.status = s !== "all" ? s : undefined;
		params.page = p > 1 ? String(p) : undefined;
		setSearchParams(params);
	});

	// Filtered + searched sessions
	const filtered = createMemo(() => {
		const sessions = sessionList() ?? [];
		const q = search().toLowerCase();
		const status = statusFilter();

		return sessions.filter((s) => {
			if (status !== "all" && s.status !== status) return false;
			if (q) {
				const name = (s.session_name ?? s.session_id).toLowerCase();
				const branch = (s.git_branch ?? "").toLowerCase();
				return name.includes(q) || branch.includes(q) || s.session_id.includes(q);
			}
			return true;
		});
	});

	// Paginated slice
	const paginated = createMemo(() => {
		const all = filtered();
		const offset = (page() - 1) * PAGE_SIZE;
		return all.slice(offset, offset + PAGE_SIZE);
	});

	const totalPages = createMemo(() => Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)));

	const handleRowClick = (session: SessionSummary) => {
		navigate(`/session/${session.session_id}`);
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
		<div class="p-6">
			{/* Header */}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<h1 class="text-2xl font-bold">Sessions</h1>
					<div class="flex items-center gap-1.5" title="Live updates via SSE">
						<LiveDot />
						<span class="text-xs text-gray-500">Live</span>
					</div>
				</div>
				<button
					onClick={() => refetchSessions()}
					class="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Refresh
				</button>
			</div>

			{/* Error banner */}
			<Show when={globalError()}>
				{(err) => (
					<div class="mt-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
						<span>{err().message}</span>
						<button onClick={clearError} class="ml-4 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300">
							Dismiss
						</button>
					</div>
				)}
			</Show>

			{/* Filters */}
			<div class="mt-4 flex items-center gap-4">
				<input
					type="text"
					placeholder="Search sessions..."
					value={search()}
					onInput={(e) => {
						setSearch(e.currentTarget.value);
						setPage(1);
						setSelectedRow(-1);
					}}
					class="w-64 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:placeholder-gray-500 dark:focus:border-blue-600"
				/>
				<div class="flex rounded-md border border-gray-300 dark:border-gray-700">
					{(["all", "complete", "incomplete"] as const).map((s) => (
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
					))}
				</div>
				<span class="text-sm text-gray-500">
					{filtered().length} session{filtered().length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Table */}
			<div class="mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500 dark:border-gray-800 dark:bg-gray-900/50">
						<tr>
							<th class="px-4 py-3 font-medium">Name</th>
							<th class="px-4 py-3 font-medium">Status</th>
							<th class="px-4 py-3 font-medium">Duration</th>
							<th class="px-4 py-3 font-medium">Events</th>
							<th class="px-4 py-3 font-medium">Agents</th>
							<th class="px-4 py-3 font-medium">Size</th>
							<th class="px-4 py-3 font-medium">Branch</th>
							<th class="px-4 py-3 font-medium">When</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100 dark:divide-gray-800/50">
						<Show when={!sessionList.loading} fallback={<LoadingSkeleton />}>
							<Show when={paginated().length > 0} fallback={<EmptyState />}>
								<For each={paginated()}>
									{(session, idx) => (
										<tr
											onClick={() => handleRowClick(session)}
											class={`cursor-pointer transition ${
												selectedRow() === idx()
													? "bg-blue-50 dark:bg-blue-900/20"
													: "hover:bg-gray-50 dark:hover:bg-gray-800/50"
											}`}
										>
											<td class="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
												{session.session_name ?? session.session_id.slice(0, 8)}
											</td>
											<td class="px-4 py-3">
												<StatusBadge status={session.status} />
											</td>
											<td class="px-4 py-3 text-gray-500 dark:text-gray-400">
												{formatDuration(session.duration_ms)}
											</td>
											<td class="px-4 py-3 text-gray-500 dark:text-gray-400">{session.event_count}</td>
											<td class="px-4 py-3 text-gray-500 dark:text-gray-400">
												{session.agent_count ?? 1}
											</td>
											<td class="px-4 py-3 text-gray-500 dark:text-gray-400">
												{formatSize(session.file_size_bytes)}
											</td>
											<td class="px-4 py-3">
												<Show when={session.git_branch} fallback={<span class="text-gray-400 dark:text-gray-600">-</span>}>
													<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
														{session.git_branch}
													</span>
												</Show>
											</td>
											<td class="px-4 py-3 text-gray-400 dark:text-gray-500">
												{formatDate(session.start_time)}
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

import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { ArrowLeft, Menu, Search as SearchIcon, X } from "lucide-solid";
import {
	createEffect,
	createMemo,
	createSignal,
	Match,
	onCleanup,
	Show,
	Switch,
	type Component,
} from "solid-js";
import {
	createSessionDetail,
	sessionList,
	globalError,
	clearError,
} from "../lib/stores";
import { api } from "../lib/api";
import { lastDistilledSessionId } from "../lib/events";
import { useKeyboard } from "../lib/keyboard";
import { formatDuration } from "../lib/format";
import { findAgentInTree, flattenAgents } from "../lib/agent-utils";
import { PageShell, LoadingSkeleton } from "../components/PageShell";
import { SessionHeader } from "../components/SessionHeader";
import { SessionDetailNav } from "../components/SessionDetailNav";
import { OverviewPanel, AgentPanel } from "../components/panels";

// ── Not distilled state ─────────────────────────────────────────────

const NotDistilledState: Component<{
	readonly sessionId: string;
	readonly onDistill: () => void;
}> = (props) => {
	const [distilling, setDistilling] = createSignal(false);
	const [error, setError] = createSignal<string | undefined>();
	const [refetchTriggered, setRefetchTriggered] = createSignal(false);
	// Pragmatic exception: let required for timer IDs that must be reassigned
	// by setInterval/clearInterval and setTimeout/clearTimeout lifecycle.
	let pollTimer: ReturnType<typeof setInterval> | undefined; // eslint-disable-line prefer-const
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined; // eslint-disable-line prefer-const

	const stopPolling = () => {
		if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
		if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = undefined; }
		setDistilling(false);
	};

	// Clean up timers on unmount
	onCleanup(stopPolling);

	// SSE-driven: when distill_complete fires for this session, refetch immediately
	createEffect(() => {
		if (lastDistilledSessionId() === props.sessionId && distilling() && !refetchTriggered()) {
			setRefetchTriggered(true);
			props.onDistill();
			stopPolling();
		}
	});

	const summary = createMemo(() => {
		const sessions = sessionList() ?? [];
		return sessions.find((s) => s.session_id === props.sessionId);
	});

	const handleDistill = async () => {
		setDistilling(true);
		setError(undefined);
		setRefetchTriggered(false);
		try {
			const res = await api.api.commands.sessions[":sessionId"].distill.$post({
				param: { sessionId: props.sessionId },
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({ error: "Unknown error" }));
				setError("error" in body ? String(body.error) : `HTTP ${res.status}`);
				setDistilling(false);
				return;
			}
			// Poll for completion as fallback (SSE is primary signal)
			pollTimer = setInterval(() => { if (!refetchTriggered()) props.onDistill(); }, 3000);
			// Stop polling after 2 minutes max
			timeoutTimer = setTimeout(stopPolling, 120_000);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setDistilling(false);
		}
	};

	return (
		<div class="flex h-full items-center justify-center">
			<div class="max-w-md rounded-lg border border-gray-200 bg-gray-50 p-8 text-center dark:border-gray-700 dark:bg-gray-900">
				<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
					<SearchIcon class="h-6 w-6 text-amber-600 dark:text-amber-400" />
				</div>
				<h2 class="text-sm font-semibold text-gray-800 dark:text-gray-200">Session not yet analyzed</h2>
				<p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
					Run distillation to unlock conversation view, diffs, backtracks, and more.
				</p>
				<div class="mt-4 flex items-center justify-center gap-3">
					<div class="rounded-md bg-gray-100 px-4 py-3 dark:bg-gray-800">
						<code class="font-mono text-xs text-emerald-600 dark:text-emerald-400">
							clens distill {props.sessionId.slice(0, 8)}
						</code>
					</div>
					<span class="text-xs text-gray-400">or</span>
					<button
						onClick={handleDistill}
						disabled={distilling()}
						class="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-emerald-500 dark:hover:bg-emerald-600"
					>
						{distilling() ? "Distilling..." : "Distill now"}
					</button>
				</div>
				<Show when={distilling()}>
					<div class="mt-3 flex items-center justify-center gap-2 text-xs text-gray-500">
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-emerald-500" />
						<span>Analyzing session...</span>
					</div>
				</Show>
				<Show when={error()}>
					{(e) => (
						<p class="mt-3 text-xs text-red-500">{e()}</p>
					)}
				</Show>
				<Show when={summary()}>
					{(s) => (
						<div class="mt-5 flex justify-center gap-6 text-xs text-gray-500">
							<span>{s().event_count} events</span>
							<span>{formatDuration(s().duration_ms)}</span>
							<Show when={s().git_branch}>
								<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-800">{s().git_branch}</span>
							</Show>
						</div>
					)}
				</Show>
			</div>
		</div>
	);
};

// ── Back nav bar ─────────────────────────────────────────────────────

const BackNavBar: Component<{
	readonly sessionId: string;
	readonly sidebarOpen?: boolean;
	readonly onToggleSidebar?: () => void;
}> = (props) => {
	const navigate = useNavigate();

	return (
		<div class="flex items-center gap-2 border-b border-gray-200 px-3 py-1 dark:border-gray-800">
			{/* Mobile sidebar toggle */}
			<Show when={props.onToggleSidebar}>
				{(toggle) => (
					<button
						onClick={toggle()}
						class="rounded p-1 text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 md:hidden"
						aria-label="Toggle sidebar"
					>
						<Show when={props.sidebarOpen} fallback={<Menu class="h-4 w-4" />}>
							<X class="h-4 w-4" />
						</Show>
					</button>
				)}
			</Show>
			<button
				onClick={() => navigate("/")}
				class="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
				aria-label="Back to session list"
			>
				<ArrowLeft class="h-3 w-3" />
				Sessions
			</button>
			<span class="text-xs text-gray-400 dark:text-gray-400">{props.sessionId.slice(0, 12)}</span>
		</div>
	);
};

// ── Agent not found fallback ─────────────────────────────────────────

const AgentNotFound: Component<{
	readonly agentId: string;
	readonly onGoOverview: () => void;
}> = (props) => (
	<div class="flex h-full items-center justify-center">
		<div class="text-center">
			<p class="text-xs text-gray-500 dark:text-gray-400">
				Agent <code class="font-mono text-xs">{props.agentId.slice(0, 12)}</code> not found in this session.
			</p>
			<button
				onClick={props.onGoOverview}
				class="mt-3 rounded-md bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				Go to Overview
			</button>
		</div>
	</div>
);

// ── Main component ──────────────────────────────────────────────────

export const SessionDetail: Component = () => {
	const params = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams<{
		view?: string;
		agent?: string;
	}>();

	// ── Data resources ──────────────────────────────────────────

	const sessionId = () => params.id;
	const [sessionDetail, { refetch: refetchDetail }] = createSessionDetail(sessionId);

	// ── Derived state ───────────────────────────────────────────

	const session = createMemo(() => {
		const detail = sessionDetail();
		if (detail?.status === "ready") return detail.data;
		return undefined;
	});

	const isNotDistilled = createMemo(() => sessionDetail()?.status === "not_distilled");

	const isMultiAgent = createMemo(() => {
		const agents = session()?.agents;
		return agents !== undefined && agents.length > 1;
	});

	const currentView = createMemo(() => searchParams.view ?? "overview");
	const selectedAgentId = createMemo(() => searchParams.agent);

	const selectedAgent = createMemo(() => {
		const agentId = selectedAgentId();
		const agents = session()?.agents;
		if (!agentId || !agents) return undefined;
		return findAgentInTree(agents, agentId);
	});

	// ── Sidebar state (responsive) ──────────────────────────────
	const [sidebarOpen, setSidebarOpen] = createSignal(false);
	const toggleSidebar = () => setSidebarOpen((prev) => !prev);

	// ── Navigation handler ──────────────────────────────────────

	const handleSelectView = (view: string, agentId?: string) => {
		setSearchParams({ view, agent: agentId ?? undefined });
		setSidebarOpen(false); // close mobile sidebar on navigation
	};

	// ── Re-distill handler ──────────────────────────────────────

	const handleRedistill = async () => {
		const res = await api.api.commands.sessions[":sessionId"].distill.$post({
			param: { sessionId: params.id },
		});
		if (!res.ok) return;
		// Poll for completion (SSE will also trigger refetch via lastDistilledSessionId)
		await new Promise((resolve) => setTimeout(resolve, 2000));
		refetchDetail();
	};

	// Watch for SSE distill_complete for this session
	createEffect(() => {
		if (lastDistilledSessionId() === params.id) {
			refetchDetail();
		}
	});

	// ── Keyboard navigation ─────────────────────────────────────

	const flatAgents = createMemo(() => flattenAgents(session()?.agents ?? []));

	const selectAgentByIndex = (index: number) => {
		const agents = flatAgents();
		if (index >= 0 && index < agents.length) {
			const agent = agents[index];
			if (agent.session_id) handleSelectView("agent", agent.session_id);
		}
	};

	const navigateAgent = (direction: 1 | -1) => {
		const agents = flatAgents();
		if (agents.length === 0) return;
		const currentId = selectedAgentId();
		const currentIdx = currentId
			? agents.findIndex((a) => a.session_id === currentId)
			: -1;
		const nextIdx = currentIdx < 0
			? (direction === 1 ? 0 : agents.length - 1)
			: Math.max(0, Math.min(agents.length - 1, currentIdx + direction));
		const next = agents[nextIdx];
		if (next?.session_id) handleSelectView("agent", next.session_id);
	};

	// ── Panel transition key ────────────────────────────────────
	// Changes whenever the active panel changes, triggering a CSS fade animation
	const panelKey = createMemo(() => `${currentView()}:${selectedAgentId() ?? ""}`);

	useKeyboard(() => [
		{
			key: "Escape",
			description: "Go back to session list",
			handler: () => navigate("/"),
		},
		{
			key: "1",
			description: "Overview panel",
			handler: () => handleSelectView("overview"),
		},
		...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
			key: String(n),
			description: `Select agent ${n - 1}`,
			handler: () => selectAgentByIndex(n - 2),
		})),
		{
			key: "j",
			description: "Next agent",
			handler: () => navigateAgent(1),
		},
		{
			key: "k",
			description: "Previous agent",
			handler: () => navigateAgent(-1),
		},
	]);

	return (
		<PageShell>
			{/* Back nav bar */}
			<BackNavBar
				sessionId={params.id}
				sidebarOpen={sidebarOpen()}
				onToggleSidebar={toggleSidebar}
			/>

			{/* Main content */}
			<Show when={!sessionDetail.loading} fallback={<LoadingSkeleton label="Loading session..." />}>
				<Show when={!isNotDistilled()} fallback={<NotDistilledState sessionId={params.id} onDistill={refetchDetail} />}>
					<Show when={session()}>
						{(s) => (
							<>
								{/* Session header with timeline + re-distill */}
								<SessionHeader session={s()} onRedistill={handleRedistill} />

								{/* Body: sidebar nav + content panel */}
								<div class="relative flex flex-1 overflow-hidden">
									{/* Mobile backdrop */}
									<Show when={sidebarOpen()}>
										<div
											class="fixed inset-0 z-20 bg-black/30 md:hidden"
											onClick={() => setSidebarOpen(false)}
										/>
									</Show>

									{/* Left sidebar nav -- wider, hidden on mobile unless toggled */}
									<div
										class="absolute inset-y-0 left-0 z-30 w-72 shrink-0 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0"
										classList={{ "-translate-x-full": !sidebarOpen(), "translate-x-0": sidebarOpen() }}
									>
										<SessionDetailNav
											session={s()}
											sessionId={params.id}
											currentView={currentView()}
											selectedAgentId={selectedAgentId()}
											onSelectView={handleSelectView}
										/>
									</div>

									{/* Right content panel -- keyed wrapper triggers fade on panel switch */}
									<Show when={panelKey()} keyed>
										{(_panelKey) => (
										<div class="flex-1 overflow-hidden animate-page-fade">
											<Switch fallback={
												<OverviewPanel
													session={s()}
													sessionId={params.id}
													isMultiAgent={isMultiAgent()}
												/>
											}>
												<Match when={currentView() === "overview"}>
													<OverviewPanel
														session={s()}
														sessionId={params.id}
														isMultiAgent={isMultiAgent()}
													/>
												</Match>
												<Match when={currentView() === "agent" && selectedAgentId()}>
													<Show
														when={selectedAgent()}
														fallback={
															<AgentNotFound
																agentId={selectedAgentId() ?? ""}
																onGoOverview={() => handleSelectView("overview")}
															/>
														}
													>
														{(agent) => (
															<AgentPanel
																agent={agent()}
																session={s()}
																sessionId={params.id}
															/>
														)}
													</Show>
												</Match>
											</Switch>
										</div>
										)}
									</Show>
								</div>
							</>
						)}
					</Show>
				</Show>
			</Show>
		</PageShell>
	);
};

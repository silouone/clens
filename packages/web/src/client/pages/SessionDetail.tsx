import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import {
	type Component,
	createEffect,
	createMemo,
	createSignal,
	Match,
	onCleanup,
	Show,
	Switch,
} from "solid-js";
import type { SessionStatus, SessionSummary } from "../../shared/types";
import { ConversationPanel } from "../components/ConversationPanel";
import { LiveSessionView } from "../components/LiveSessionView";
import { DetailPageLayout } from "../components/layouts/DetailPageLayout";
import { LoadingSkeleton, PageShell } from "../components/PageShell";
import { ProjectBadge } from "../components/ProjectFilter";
import { AgentPanel, OverviewPanel } from "../components/panels";
import { SessionDetailNav } from "../components/SessionDetailNav";
import { SessionHeader } from "../components/SessionHeader";
import { FlaskIllustration } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { findAgentInTree, flattenAgents } from "../lib/agent-utils";
import { api } from "../lib/api";
import { shouldAutoDistill } from "../lib/auto-distill";
import { lastDistilledSessionId } from "../lib/events";
import { formatDate, formatDuration } from "../lib/format";
import { useKeyboard } from "../lib/keyboard";
import { createLiveSessionStore } from "../lib/live-store";
import { isGlobalMode } from "../lib/project-store";
import { preferences } from "../lib/settings";
import { createSessionDetail, sessionList } from "../lib/stores";

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
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = undefined;
		}
		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			timeoutTimer = undefined;
		}
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
			pollTimer = setInterval(() => {
				if (!refetchTriggered()) props.onDistill();
			}, 3000);
			// Stop polling after 2 minutes max
			timeoutTimer = setTimeout(stopPolling, 120_000);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setDistilling(false);
		}
	};

	return (
		<div class="flex h-full items-center justify-center">
			<div class="max-w-md rounded-none border border-clens bg-surface-inset p-8 text-center">
				<div class="mx-auto mb-4">
					<FlaskIllustration class="h-14 w-14 text-warning" />
				</div>
				<h2 class="instrument-microcaps text-sm text-secondary">Session not yet analyzed</h2>
				<p class="mt-2 text-xs text-muted">
					Run distillation to unlock conversation view, diffs, backtracks, and more.
				</p>
				<div class="mt-4 flex items-center justify-center gap-3">
					<div class="rounded-none border border-clens bg-surface-inset px-4 py-3">
						<code class="font-mono text-xs text-brand-500">
							clens distill {props.sessionId.slice(0, 8)}
						</code>
					</div>
					<span class="instrument-microcaps text-[10px] text-muted">or</span>
					<button
						type="button"
						onClick={handleDistill}
						disabled={distilling()}
						class="instrument-microcaps rounded-none border border-brand-500 bg-brand-500 px-4 py-2 text-[10px] text-surface transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{distilling() ? "Distilling..." : "Distill now"}
					</button>
				</div>
				<Show when={distilling()}>
					<div class="mt-3 flex items-center justify-center gap-2 text-xs text-muted">
						<Spinner size="sm" />
						<span>Analyzing session...</span>
					</div>
				</Show>
				<Show when={error()}>
					{(e) => <p class="mt-3 font-mono text-xs text-[var(--clens-danger)]">{e()}</p>}
				</Show>
				<Show when={summary()}>
					{(s) => (
						<div class="mt-5 flex justify-center gap-6 text-xs text-muted">
							<span>{s().event_count} events</span>
							<span>{formatDuration(s().duration_ms)}</span>
							<Show when={s().git_branch}>
								<span class="rounded-none border border-clens bg-surface-inset px-1.5 py-0.5 font-mono">
									{s().git_branch}
								</span>
							</Show>
						</div>
					)}
				</Show>
			</div>
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
			<p class="text-xs text-muted">
				Agent <code class="font-mono text-xs">{props.agentId.slice(0, 12)}</code> not found in this
				session.
			</p>
			<button
				type="button"
				onClick={props.onGoOverview}
				class="instrument-microcaps mt-3 rounded-none border border-clens px-3 py-1 text-[10px] text-secondary transition hover:bg-surface-hover hover:border-strong"
			>
				Go to Overview
			</button>
		</div>
	</div>
);

// ── Stale-distill banner (bug B5) ────────────────────────────────────

/**
 * Shown when the distilled analysis covers fewer events than the live raw
 * session file — i.e. the session kept running (or was resumed) after it was
 * analyzed. Makes the staleness explicit instead of presenting an old snapshot
 * as current truth, and points at the existing Re-analyze button to refresh.
 */
const StaleDistillBanner: Component<{
	readonly analyzedEvents: number;
	readonly rawEvents: number;
	readonly distilledAt: number;
	readonly tierStale?: boolean;
	readonly onRedistill: () => Promise<void>;
}> = (props) => {
	const [refreshing, setRefreshing] = createSignal(false);
	const message = () =>
		props.rawEvents > props.analyzedEvents
			? `Analysis covers ${props.analyzedEvents} of ${props.rawEvents} events (analyzed ${formatDate(props.distilledAt, "relative")}).`
			: `Costs were computed under a different pricing tier than the current setting.`;
	return (
		<div class="mx-4 mt-3 flex items-center justify-between gap-3 rounded-none border-l-2 border-[var(--clens-warning)] bg-surface-inset px-3 py-2 text-xs text-[var(--clens-warning)]">
			<span>
				{message()}
				{props.tierStale && props.rawEvents > props.analyzedEvents
					? " Costs also reflect an outdated pricing tier."
					: ""}{" "}
				Re-analyze to refresh.
			</span>
			<button
				type="button"
				onClick={async () => {
					setRefreshing(true);
					try {
						await props.onRedistill();
					} finally {
						setRefreshing(false);
					}
				}}
				disabled={refreshing()}
				class="instrument-microcaps shrink-0 rounded-none border border-[var(--clens-warning)] px-2 py-1 text-[10px] text-[var(--clens-warning)] transition hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{refreshing() ? "Re-analyzing..." : "Re-analyze"}
			</button>
		</div>
	);
};

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

	// Staleness metadata from the detail route (bug B5). Present only when the
	// session is distilled and the route could compare against the raw file.
	const staleness = createMemo(() => {
		const detail = sessionDetail();
		return detail?.status === "ready" ? detail.staleness : undefined;
	});

	// Raw-derived live status from the session list (bug B5/B6). This reflects the
	// CURRENT session state, unlike the distilled `complete` flag which freezes at
	// distill time. Used for the header badge so a running session never shows
	// "complete" just because an early distill said so.
	const rawStatus = createMemo<SessionStatus | undefined>(() => {
		const sessions = sessionList();
		const match = sessions?.find((s) => s.session_id === params.id);
		return match?.status;
	});

	const isNotDistilled = createMemo(() => sessionDetail()?.status === "not_distilled");

	// FE-32: a re-analyze (~3-5s) calls refetchDetail(), which puts the resource
	// into a "refreshing" state (loading=true) but RETAINS the prior value. Keep
	// rendering that populated snapshot through the reload instead of swapping the
	// whole panel — KPI strip included — to a full-page skeleton, which blanked the
	// readouts and read as the KPI strip "flashing 0". Gate on the retained data
	// being THIS session so navigating to a different id still shows the skeleton
	// rather than the previous session's numbers.
	const hasCurrentDetail = createMemo(() => {
		const detail = sessionDetail();
		return detail?.status === "ready" && detail.data.session_id === params.id;
	});

	// Matching lightweight list row — carries the resolved display_name/label/color
	// (sidecar-backed naming) that the distilled snapshot lacks, so the header can
	// render rename + color controls (R18).
	const summaryRow = createMemo(() => {
		const sessions = sessionList() ?? [];
		return sessions.find((s) => s.session_id === params.id);
	});

	/** Project info derived from session list (available in global mode). */
	const projectInfo = createMemo(() => {
		const sessions = sessionList();
		if (!sessions || !isGlobalMode()) return undefined;
		const match = sessions.find((s) => s.session_id === params.id);
		if (!match || !("project_id" in match) || !("project_name" in match)) return undefined;
		const m = match as SessionSummary & {
			readonly project_id: string;
			readonly project_name: string;
		};
		return { project_id: m.project_id, project_name: m.project_name };
	});

	/** Summary data for sessions that haven't been distilled yet. */
	const notDistilledSummary = createMemo(() => {
		const sessions = sessionList() ?? [];
		return sessions.find((s) => s.session_id === params.id);
	});

	// ── Auto-distill when preference is enabled ──────────────
	// Track the session id we last auto-distilled, NOT a bare boolean. A single
	// SessionDetail instance is reused across navigations (params.id changes
	// without remount), so a boolean flag set once would suppress auto-distill
	// for every subsequent session forever. Deriving `alreadyTriggered` from
	// whether the triggered id still matches the current params.id resets the
	// guard automatically on navigation.
	const [autoDistilledId, setAutoDistilledId] = createSignal<string | undefined>(undefined);

	// B17/D13: skip auto-distill for LIVE (active/idle) sessions — auto-distilling
	// a running session freezes a stale "complete" snapshot. Only complete-but-
	// unanalyzed sessions auto-distill; the live timeline is shown otherwise, and
	// manual Re-analyze stays available regardless.
	createEffect(() => {
		const guard = shouldAutoDistill({
			autoDistillEnabled: preferences().autoDistill,
			isNotDistilled: isNotDistilled(),
			alreadyTriggered: autoDistilledId() === params.id,
			detailLoading: sessionDetail.loading,
			summaryStatus: notDistilledSummary()?.status,
		});
		if (guard) {
			setAutoDistilledId(params.id);
			api.api.commands.sessions[":sessionId"].distill
				.$post({
					param: { sessionId: params.id },
				})
				.catch(() => {
					/* distill error handled by SSE / polling */
				});
		}
	});

	const liveStore = createLiveSessionStore(() => {
		const detail = sessionDetail();
		return detail?.status === "not_distilled" ? params.id : undefined;
	});

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

	// ── Navigation handler ──────────────────────────────────────

	const handleSelectView = (view: string, agentId?: string) => {
		setSearchParams({ view, agent: agentId ?? undefined });
	};

	// ── Re-distill handler ──────────────────────────────────────

	// Tracks an in-flight (re-)analyze so the action buttons can show a busy
	// state, and so the SSE effect below knows a refetch is genuinely wanted.
	const [isRedistilling, setIsRedistilling] = createSignal(false);
	// Set true when WE initiate a (re-)analyze; the SSE distill_complete effect
	// consumes it to perform exactly one refetch. Without this gate, the effect
	// refetches on every distill_complete signal — and since that signal is
	// `equals: false` (so re-analyzing the same id re-fires) the SSE ring buffer
	// replays it on each reconnect (reconnects happen on every route change),
	// refetching an already-ready session in a tight loop. That loop is what made
	// the analyzed session page appear to "reload all the time".
	const [redistillPending, setRedistillPending] = createSignal(false);

	const handleRedistill = async () => {
		if (isRedistilling()) return;
		setIsRedistilling(true);
		setRedistillPending(true);
		try {
			const res = await api.api.commands.sessions[":sessionId"].distill.$post({
				param: { sessionId: params.id },
			});
			if (!res.ok) {
				setRedistillPending(false);
				return;
			}
			// SSE distill_complete is the primary completion signal; this delayed
			// refetch is a fallback in case the event is missed.
			await new Promise((resolve) => setTimeout(resolve, 2000));
			if (redistillPending()) {
				setRedistillPending(false);
				refetchDetail();
			}
		} finally {
			setIsRedistilling(false);
		}
	};

	// Watch for SSE distill_complete for this session. Only refetch when a refetch
	// is actually warranted — either the view is still showing the not-distilled
	// state (first analysis just finished) or we initiated a re-analyze. This
	// stops replayed/duplicate distill_complete signals from looping refetches on
	// an already-current page (see redistillPending rationale above).
	createEffect(() => {
		if (lastDistilledSessionId() !== params.id) return;
		if (isNotDistilled() || redistillPending()) {
			setRedistillPending(false);
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
		const currentIdx = currentId ? agents.findIndex((a) => a.session_id === currentId) : -1;
		const nextIdx =
			currentIdx < 0
				? direction === 1
					? 0
					: agents.length - 1
				: Math.max(0, Math.min(agents.length - 1, currentIdx + direction));
		const next = agents[nextIdx];
		if (next?.session_id) handleSelectView("agent", next.session_id);
	};

	// ── Panel transition key ────────────────────────────────────
	const panelKey = createMemo(() => `${currentView()}:${selectedAgentId() ?? ""}`);

	useKeyboard(
		() => [
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
			{
				key: "c",
				description: "Conversation view",
				handler: () => handleSelectView("conversation"),
			},
		],
		"Session Detail",
	);

	return (
		<PageShell>
			<Show
				when={!sessionDetail.loading || hasCurrentDetail()}
				fallback={<LoadingSkeleton label="Loading session..." />}
			>
				<Show
					when={!isNotDistilled()}
					fallback={
						<Show
							when={(() => {
								const s = liveStore.state();
								return s && s.event_count > 0 ? s : undefined;
							})()}
							fallback={<NotDistilledState sessionId={params.id} onDistill={refetchDetail} />}
						>
							{(liveState) => (
								<div class="flex flex-col h-full">
									<div class="min-h-0 flex-1 overflow-hidden">
										<LiveSessionView state={liveState()} elapsed={liveStore.elapsed()} />
									</div>
									<Show when={liveState().status === "complete"}>
										{/* Pinned action bar — a footer separated from the timeline,
									    not a pill floating over the log content (prior design).
									    Carries a busy state so the click gives immediate feedback. */}
										<div class="shrink-0 flex items-center justify-between gap-4 border-t border-clens bg-surface-inset px-4 py-3">
											<div class="flex flex-col">
												<span class="instrument-microcaps text-[10px] text-secondary">
													Session complete
												</span>
												<span class="text-[11px] text-muted">
													Analyze to unlock conversation, diffs, backtracks &amp; cost.
												</span>
											</div>
											<button
												type="button"
												onClick={handleRedistill}
												disabled={isRedistilling()}
												class="instrument-microcaps inline-flex shrink-0 items-center gap-2 rounded-none border border-brand-500 bg-brand-500 px-4 py-2 text-[10px] text-surface transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
											>
												<Show when={isRedistilling()}>
													<Spinner size="sm" />
												</Show>
												{isRedistilling() ? "Analyzing…" : "Analyze Session"}
											</button>
										</div>
									</Show>
								</div>
							)}
						</Show>
					}
				>
					<Show when={session()}>
						{(s) => (
							<DetailPageLayout
								backLabel="Sessions"
								backHref="/"
								id={params.id.slice(0, 12)}
								header={
									<SessionHeader
										session={s()}
										status={rawStatus()}
										summary={summaryRow()}
										onRedistill={handleRedistill}
									/>
								}
								badge={
									<Show when={projectInfo()}>
										{(info) => (
											<ProjectBadge
												projectId={info().project_id}
												projectName={info().project_name}
											/>
										)}
									</Show>
								}
								nav={
									<SessionDetailNav
										session={s()}
										sessionId={params.id}
										currentView={currentView()}
										selectedAgentId={selectedAgentId()}
										onSelectView={handleSelectView}
									/>
								}
							>
								{/* Banner + content stack in one column — DetailPageLayout's children
								    container is a flex ROW, so without this wrapper the banner becomes
								    a ghost sibling column beside the content panel */}
								<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
									{/* Stale-distill banner (bug B5 + stale-tier mixing): raw file grew past
								    the analyzed snapshot, or costs were priced under an outdated tier */}
									<Show
										when={(() => {
											const st = staleness();
											return st && (st.distill_stale || st.tier_stale) ? st : undefined;
										})()}
									>
										{(st) => (
											<StaleDistillBanner
												analyzedEvents={s().stats.total_events}
												rawEvents={st().raw_event_count}
												distilledAt={st().distilled_at}
												tierStale={st().tier_stale}
												onRedistill={handleRedistill}
											/>
										)}
									</Show>
									{/* Right content panel -- keyed wrapper triggers fade on panel switch */}
									<Show when={panelKey()} keyed>
										{(_panelKey) => (
											<div class="flex-1 overflow-hidden animate-page-fade">
												<Switch
													fallback={
														<OverviewPanel
															session={s()}
															sessionId={params.id}
															isMultiAgent={isMultiAgent()}
															onRedistill={handleRedistill}
														/>
													}
												>
													<Match when={currentView() === "overview"}>
														<OverviewPanel
															session={s()}
															sessionId={params.id}
															isMultiAgent={isMultiAgent()}
															onRedistill={handleRedistill}
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
																<AgentPanel agent={agent()} session={s()} sessionId={params.id} />
															)}
														</Show>
													</Match>
													<Match when={currentView() === "conversation"}>
														<ConversationPanel sessionId={params.id} />
													</Match>
												</Switch>
											</div>
										)}
									</Show>
								</div>
							</DetailPageLayout>
						)}
					</Show>
				</Show>
			</Show>
		</PageShell>
	);
};

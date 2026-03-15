import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
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
import { Spinner } from "../components/ui/Spinner";
import { FlaskIllustration } from "../components/ui/EmptyState";
import { PageShell, LoadingSkeleton } from "../components/PageShell";
import { SessionHeader } from "../components/SessionHeader";
import { SessionDetailNav } from "../components/SessionDetailNav";
import { OverviewPanel, AgentPanel } from "../components/panels";
import { ConversationPanel } from "../components/ConversationPanel";
import { DetailPageLayout } from "../components/layouts/DetailPageLayout";
import { DetailHeader } from "../components/DetailHeader";
import { DetailNav } from "../components/DetailNav";
import { StatItem } from "../components/ui/StatItem";
import { LiveSessionView } from "../components/LiveSessionView";
import { createLiveSessionStore } from "../lib/live-store";
import { preferences } from "../lib/settings";
import type { SessionSummary } from "../../shared/types";
import { isGlobalMode } from "../lib/project-store";
import { ProjectBadge } from "../components/ProjectFilter";

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
			<div class="max-w-md rounded-lg border border-clens bg-surface-inset p-8 text-center">
				<div class="mx-auto mb-4">
					<FlaskIllustration class="h-14 w-14 text-amber-500 dark:text-amber-400" />
				</div>
				<h2 class="text-sm font-semibold text-primary">Session not yet analyzed</h2>
				<p class="mt-2 text-xs text-muted">
					Run distillation to unlock conversation view, diffs, backtracks, and more.
				</p>
				<div class="mt-4 flex items-center justify-center gap-3">
					<div class="rounded-md bg-surface-muted px-4 py-3">
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
						<Spinner size="sm" />
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
								<span class="rounded bg-surface-muted px-1.5 py-0.5 font-mono">{s().git_branch}</span>
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
				Agent <code class="font-mono text-xs">{props.agentId.slice(0, 12)}</code> not found in this session.
			</p>
			<button
				onClick={props.onGoOverview}
				class="mt-3 rounded-md bg-surface-muted px-3 py-1 text-xs font-medium text-secondary transition hover:bg-surface-hover"
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

	const relatedSessions = createMemo(() => {
		const detail = sessionDetail();
		if (detail?.status === "ready") return detail.relatedSessions;
		return undefined;
	});

	const isNotDistilled = createMemo(() => sessionDetail()?.status === "not_distilled");

	/** Project info derived from session list (available in global mode). */
	const projectInfo = createMemo(() => {
		const sessions = sessionList();
		if (!sessions || !isGlobalMode()) return undefined;
		const match = sessions.find((s) => s.session_id === params.id);
		if (!match || !("project_id" in match) || !("project_name" in match)) return undefined;
		const m = match as SessionSummary & { readonly project_id: string; readonly project_name: string };
		return { project_id: m.project_id, project_name: m.project_name };
	});

	// ── Auto-distill when preference is enabled ──────────────
	const [autoDistillTriggered, setAutoDistillTriggered] = createSignal(false);

	createEffect(() => {
		if (
			preferences().autoDistill &&
			isNotDistilled() &&
			!autoDistillTriggered() &&
			!sessionDetail.loading
		) {
			setAutoDistillTriggered(true);
			api.api.commands.sessions[":sessionId"].distill.$post({
				param: { sessionId: params.id },
			}).catch(() => { /* distill error handled by SSE / polling */ });
		}
	});

	/** Summary data for sessions that haven't been distilled yet. */
	const notDistilledSummary = createMemo(() => {
		const sessions = sessionList() ?? [];
		return sessions.find((s) => s.session_id === params.id);
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
		{
			key: "c",
			description: "Conversation view",
			handler: () => handleSelectView("conversation"),
		},
	], "Session Detail");

	return (
		<PageShell>
			<Show when={!sessionDetail.loading} fallback={<LoadingSkeleton label="Loading session..." />}>
				<Show when={!isNotDistilled()} fallback={
					<Show
						when={(() => { const s = liveStore.state(); return s && s.event_count > 0 ? s : undefined })()}
						fallback={<NotDistilledState sessionId={params.id} onDistill={refetchDetail} />}
					>
						{(liveState) => (
							<div class="flex flex-col h-full">
								<LiveSessionView state={liveState()} elapsed={liveStore.elapsed()} />
								<Show when={liveState().status === "complete"}>
									<div class="flex justify-center py-3">
										<button
											class="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
											onClick={handleRedistill}
										>
											Analyze Session
										</button>
									</div>
								</Show>
							</div>
						)}
					</Show>
				}>
					<Show when={session()}>
						{(s) => (
							<DetailPageLayout
								backLabel="Sessions"
								backHref="/"
								id={params.id.slice(0, 12)}
								header={<SessionHeader session={s()} onRedistill={handleRedistill} />}
								badge={
									<Show when={projectInfo()}>
										{(info) => (
											<ProjectBadge projectId={info().project_id} projectName={info().project_name} />
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
								{/* Right content panel -- keyed wrapper triggers fade on panel switch */}
								<Show when={panelKey()} keyed>
									{(_panelKey) => (
									<div class="flex-1 overflow-hidden animate-page-fade">
										<Switch fallback={
											<OverviewPanel
												session={s()}
												sessionId={params.id}
												isMultiAgent={isMultiAgent()}
												relatedSessions={relatedSessions()}
											/>
										}>
											<Match when={currentView() === "overview"}>
												<OverviewPanel
													session={s()}
													sessionId={params.id}
													isMultiAgent={isMultiAgent()}
													relatedSessions={relatedSessions()}
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
											<Match when={currentView() === "conversation"}>
												<ConversationPanel sessionId={params.id} />
											</Match>
										</Switch>
									</div>
									)}
								</Show>
							</DetailPageLayout>
						)}
					</Show>
				</Show>
			</Show>
		</PageShell>
	);
};

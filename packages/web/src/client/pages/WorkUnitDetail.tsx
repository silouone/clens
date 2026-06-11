import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { LayoutDashboard } from "lucide-solid";
import {
	createEffect,
	createMemo,
	For,
	Match,
	Show,
	Switch,
	type Component,
} from "solid-js";
import {
	createWorkUnitDetail,
	workUnitList,
	type WorkUnitDetailSession,
} from "../lib/stores";
import { isGlobalMode } from "../lib/project-store";
import { ProjectBadge } from "../components/ProjectFilter";
import { useKeyboard } from "../lib/keyboard";
import { findAgentInTree, flattenAgents } from "../lib/agent-utils";
import { formatDuration, formatCost } from "../lib/format";
import { getTypeBadgeClass } from "../lib/agent-colors";
import { distilledSessions, aggregateCosts, aggregateFileMap } from "../lib/work-unit-utils";
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS, PHASE_COLORS } from "../lib/work-unit-constants";
import { PageShell, LoadingSkeleton } from "../components/PageShell";
import { DetailPageLayout } from "../components/layouts/DetailPageLayout";
import { DetailHeader } from "../components/DetailHeader";
import { DetailNav } from "../components/DetailNav";
import { NavButton } from "../components/ui/NavButton";
import { NavSection } from "../components/NavSection";
import { TreeNavItem } from "../components/TreeNavItem";
import { StatItem } from "../components/ui/StatItem";
import { WorkUnitSnapshot } from "../components/WorkUnitSnapshot";
import { OverviewPanel, AgentPanel } from "../components/panels";
import { ConversationPanel } from "../components/ConversationPanel";
import type { AgentNode, WorkUnit } from "../../shared/types";

// ── Agent nav row (recursive, reused from SessionDetailNav pattern) ──

const AgentTreeItem: Component<{
	readonly agent: AgentNode;
	readonly depth: number;
	readonly selectedAgentId?: string;
	readonly onSelect: (sessionId: string, agentId: string) => void;
	readonly parentSessionId: string;
}> = (props) => {
	const hasChildren = () => props.agent.children.length > 0;
	const isSelected = () => props.selectedAgentId === props.agent.session_id;

	return (
		<>
			<TreeNavItem
				depth={props.depth}
				selected={isSelected()}
				onClick={() => {
					if (props.agent.session_id) {
						props.onSelect(props.parentSessionId, props.agent.session_id);
					}
				}}
				hasChildren={hasChildren()}
				ariaLabel={`Agent: ${props.agent.agent_name ?? props.agent.agent_type}`}
				topRow={
					<>
						<span class={`shrink-0 rounded-none px-1.5 py-0.5 text-[10px] font-medium leading-none ${getTypeBadgeClass(props.agent.agent_type)}`}>
							{props.agent.agent_type}
						</span>
						<span class="flex-1 truncate font-medium text-secondary">
							{props.agent.agent_name ?? props.agent.agent_type}
						</span>
					</>
				}
				bottomRow={
					<>
						<Show when={props.agent.cost_estimate}>
							{(cost) => (
								<span title={cost().is_estimated ? "Estimated" : undefined}>
									{formatCost(cost().estimated_cost_usd, cost().is_estimated)}
								</span>
							)}
						</Show>
						<span class="ml-auto">{formatDuration(props.agent.duration_ms)}</span>
					</>
				}
			>
				<For each={props.agent.children}>
					{(child) => (
						<AgentTreeItem
							agent={child}
							depth={props.depth + 1}
							selectedAgentId={props.selectedAgentId}
							onSelect={props.onSelect}
							parentSessionId={props.parentSessionId}
						/>
					)}
				</For>
			</TreeNavItem>
		</>
	);
};

// ── Session tree item in sidebar ─────────────────────────────────────

const SessionTreeItem: Component<{
	readonly session: WorkUnitDetailSession;
	readonly selectedSessionId?: string;
	readonly selectedAgentId?: string;
	readonly onSelectSession: (sessionId: string) => void;
	readonly onSelectAgent: (sessionId: string, agentId: string) => void;
}> = (props) => {
	const agents = createMemo(() => props.session.distilled?.agents ?? []);
	const hasAgents = () => agents().length > 0;
	const isSelected = () => props.selectedSessionId === props.session.session_id;

	return (
		<TreeNavItem
			depth={0}
			selected={isSelected()}
			onClick={() => props.onSelectSession(props.session.session_id)}
			hasChildren={hasAgents()}
			defaultExpanded={false}
			ariaLabel={`Session: ${props.session.session_name ?? props.session.session_id.slice(0, 8)}`}
			topRow={
				<>
					<span class="instrument-microcaps w-14 shrink-0 text-[10px] text-muted">
						{props.session.phase}
					</span>
					<span class="flex-1 truncate font-medium text-secondary">
						{props.session.session_name ?? props.session.session_id.slice(0, 8)}
					</span>
				</>
			}
			bottomRow={
				<>
					<span class="instrument-microcaps text-[10px] text-muted">{props.session.role}</span>
					<Show when={props.session.distilled}>
						<span class="ml-auto">{formatDuration(props.session.distilled?.stats.duration_ms ?? 0)}</span>
					</Show>
					<Show when={!props.session.distilled}>
						<span class="instrument-microcaps ml-auto text-[10px] text-warning">not analyzed</span>
					</Show>
				</>
			}
		>
			<For each={agents()}>
				{(agent) => (
					<AgentTreeItem
						agent={agent}
						depth={1}
						selectedAgentId={props.selectedAgentId}
						onSelect={props.onSelectAgent}
						parentSessionId={props.session.session_id}
					/>
				)}
			</For>
		</TreeNavItem>
	);
};

// ── Work Unit Header ─────────────────────────────────────────────────

const WorkUnitHeader: Component<{
	readonly unit: WorkUnit;
	readonly sessions: readonly WorkUnitDetailSession[];
}> = (props) => {
	const cost = createMemo(() => aggregateCosts(distilledSessions(props.sessions)));

	return (
		<DetailHeader title={props.unit.spec_path ?? props.unit.git_branch ?? "Unknown"}>
			<span class={`instrument-microcaps inline-flex items-center rounded-none px-2 py-0.5 text-[10px] ${LIFECYCLE_COLORS[props.unit.lifecycle]}`}>
				{LIFECYCLE_LABELS[props.unit.lifecycle]}
			</span>
			<div class="flex flex-wrap items-center gap-1.5">
				<StatItem variant="pill" label="Duration" value={formatDuration(props.unit.total_duration_ms)} />
				<StatItem variant="pill" label="Sessions" value={String(props.unit.sessions.length)} />
				<Show when={cost()}>
					{(c) => (
						<StatItem
							variant="pill"
							label="Cost"
							value={formatCost(c().estimated_cost_usd, c().is_estimated)}
							muted={c().is_estimated}
						/>
					)}
				</Show>
			</div>
		</DetailHeader>
	);
};

// ── Work Unit Overview ───────────────────────────────────────────────

const WorkUnitOverview: Component<{
	readonly unit: WorkUnit;
	readonly sessions: readonly WorkUnitDetailSession[];
}> = (props) => {
	const distilled = createMemo(() => distilledSessions(props.sessions));
	const allAgents = createMemo(() => distilled().flatMap((s) => flattenAgents(s.agents ?? [])));
	const fileList = createMemo(() => aggregateFileMap(distilled()).filter((f) => f.edits > 0 || f.writes > 0));

	return (
		<div class="flex-1 overflow-y-auto p-3 space-y-3">
			<WorkUnitSnapshot unit={props.unit} sessions={props.sessions} />

			{/* Responsive grid: timeline + agents side by side on wider screens */}
			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				{/* Session phase timeline visualization */}
				<div class="rounded-none border border-clens bg-surface-raised p-3">
					<h3 class="instrument-microcaps mb-2 text-[11px] text-muted">
						Session Timeline
					</h3>
					<div class="space-y-1.5">
						<For each={props.sessions}>
							{(session) => {
								const startOffset = () => {
									const range = props.unit.date_range;
									const total = range.end - range.start;
									return total > 0 ? ((session.start_time - range.start) / total) * 100 : 0;
								};
								const widthPct = () => {
									const dur = session.distilled?.stats.duration_ms ?? session.summary.duration_ms;
									const total = props.unit.date_range.end - props.unit.date_range.start;
									return total > 0 ? Math.max(2, (dur / total) * 100) : 100;
								};

								return (
									<div class="flex items-center gap-2">
										<span class="w-20 shrink-0 truncate text-[10px] text-muted">
											{session.session_name ?? session.session_id.slice(0, 8)}
										</span>
										<div class="relative flex-1 h-4 rounded-none border border-clens bg-surface-inset">
											<div
												class={`absolute top-0.5 bottom-0.5 rounded-none ${PHASE_COLORS[session.phase] ?? PHASE_COLORS.other}`}
												style={{ left: `${startOffset()}%`, width: `${widthPct()}%` }}
												title={`${session.phase} - ${formatDuration(session.distilled?.stats.duration_ms ?? 0)}`}
											/>
										</div>
										<span class="instrument-microcaps w-10 shrink-0 text-right text-[10px] text-muted">
											{session.phase}
										</span>
									</div>
								);
							}}
						</For>
					</div>
				</div>

				{/* Agent breakdown */}
				<Show when={allAgents().length > 0}>
					<div class="rounded-none border border-clens bg-surface-raised p-3">
						<h3 class="instrument-microcaps mb-2 text-[11px] text-muted">
							Agents ({allAgents().length})
						</h3>
						<div class="space-y-1">
							<For each={allAgents()}>
								{(agent) => (
									<div class="flex items-center gap-2 rounded-none px-2 py-1.5 hover:bg-surface-hover transition-colors">
										<span class={`shrink-0 rounded-none px-1.5 py-0.5 text-[10px] font-medium leading-none ${getTypeBadgeClass(agent.agent_type)}`}>
											{agent.agent_type}
										</span>
										<span class="flex-1 truncate text-xs text-secondary">
											{agent.agent_name ?? agent.session_id?.slice(0, 8) ?? "unknown"}
										</span>
										<Show when={agent.cost_estimate}>
											{(cost) => (
												<span class="text-[10px] tabular-nums text-muted" title={cost().is_estimated ? "Estimated" : undefined}>
													{formatCost(cost().estimated_cost_usd, cost().is_estimated)}
												</span>
											)}
										</Show>
										<span class="text-[10px] tabular-nums text-muted">
											{formatDuration(agent.duration_ms)}
										</span>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>
			</div>

			{/* File list */}
			<Show when={fileList().length > 0}>
				<div class="rounded-none border border-clens bg-surface-raised p-3">
					<h3 class="instrument-microcaps mb-2 text-[11px] text-muted">
						Files Modified ({fileList().length})
					</h3>
					<div class="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
						<For each={fileList()}>
							{(file) => (
								<div class="flex items-center gap-2 rounded-none px-2 py-1 hover:bg-surface-hover transition-colors">
									{/* Full repo-relative path, truncated from the LEFT so the filename
									    stays visible — basenames alone made distinct files with the same
									    name (root vs packages/web package.json) look like duplicates */}
									<span
										class="flex-1 truncate font-mono text-[11px] text-secondary"
										style={{ direction: "rtl", "text-align": "left" }}
										title={file.file_path}
									>
										{file.file_path}
									</span>
									<span class="shrink-0 text-[10px] tabular-nums text-muted">
										{file.edits > 0 ? `${file.edits}e` : ""}{file.writes > 0 ? ` ${file.writes}w` : ""}
									</span>
								</div>
							)}
						</For>
					</div>
				</div>
			</Show>
		</div>
	);
};

// ── Main component ───────────────────────────────────────────────────

export const WorkUnitDetail: Component = () => {
	const params = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams<{
		view?: string;
		session?: string;
		agent?: string;
	}>();

	// ── Data ────────────────────────────────────────────────────
	const unitId = () => params.id;
	const [detail, { refetch }] = createWorkUnitDetail(unitId);

	const unit = createMemo(() => detail()?.unit);
	const sessions = createMemo(() =>
		[...(detail()?.sessions ?? [])].sort((a, b) => a.start_time - b.start_time),
	);

	/** Project info derived from work unit list (available in global mode). */
	const projectInfo = createMemo(() => {
		const units = workUnitList();
		if (!units || !isGlobalMode()) return undefined;
		const match = units.find((u) => u.id === params.id);
		if (!match || !("project_id" in match) || !("project_name" in match)) return undefined;
		const m = match as WorkUnit & { readonly project_id: string; readonly project_name: string };
		return { project_id: m.project_id, project_name: m.project_name };
	});

	// ── View state ──────────────────────────────────────────────
	const currentView = createMemo(() => searchParams.view ?? "overview");
	const selectedSessionId = createMemo(() => searchParams.session);
	const selectedAgentId = createMemo(() => searchParams.agent);

	const selectedSession = createMemo((): WorkUnitDetailSession | undefined => {
		const sid = selectedSessionId();
		return sid ? sessions().find((s) => s.session_id === sid) : undefined;
	});

	const selectedAgent = createMemo((): AgentNode | undefined => {
		const agentId = selectedAgentId();
		const session = selectedSession();
		if (!agentId || !session?.distilled) return undefined;
		return findAgentInTree(session.distilled.agents ?? [], agentId);
	});

	// ── Navigation ──────────────────────────────────────────────

	const handleSelectView = (view: string, sessionId?: string, agentId?: string) => {
		setSearchParams({
			view,
			session: sessionId ?? undefined,
			agent: agentId ?? undefined,
		});
	};

	const handleSelectSession = (sessionId: string) => {
		handleSelectView("session", sessionId);
	};

	const handleSelectAgent = (sessionId: string, agentId: string) => {
		handleSelectView("agent", sessionId, agentId);
	};

	// ── Panel key for transitions ───────────────────────────────
	const panelKey = createMemo(() =>
		`${currentView()}:${selectedSessionId() ?? ""}:${selectedAgentId() ?? ""}`,
	);

	// ── Keyboard navigation ─────────────────────────────────────

	const navigateSession = (direction: 1 | -1) => {
		const all = sessions();
		if (all.length === 0) return;
		const currentSid = selectedSessionId();
		const currentIdx = currentSid ? all.findIndex((s) => s.session_id === currentSid) : -1;
		const nextIdx = currentIdx < 0
			? (direction === 1 ? 0 : all.length - 1)
			: Math.max(0, Math.min(all.length - 1, currentIdx + direction));
		const next = all[nextIdx];
		if (next) handleSelectSession(next.session_id);
	};

	useKeyboard(() => [
		{
			key: "Escape",
			description: "Go back to list",
			handler: () => navigate("/"),
		},
		{
			key: "1",
			description: "Overview",
			handler: () => handleSelectView("overview"),
		},
		{
			key: "j",
			description: "Next session",
			handler: () => navigateSession(1),
		},
		{
			key: "k",
			description: "Previous session",
			handler: () => navigateSession(-1),
		},
	], "Work Unit Detail");

	return (
		<PageShell>
			<Show when={!detail.loading} fallback={<LoadingSkeleton label="Loading work unit..." />}>
				<Show when={unit()} fallback={
					<div class="flex h-full items-center justify-center">
						<p class="text-xs text-muted">Work unit not found.</p>
					</div>
				}>
					{(u) => (
						<DetailPageLayout
							backLabel="Work Units"
							backHref="/"
							id={params.id.slice(0, 12)}
							badge={
								<Show when={projectInfo()}>
									{(info) => (
										<ProjectBadge projectId={info().project_id} projectName={info().project_name} />
									)}
								</Show>
							}
							header={<WorkUnitHeader unit={u()} sessions={sessions()} />}
							nav={
								<DetailNav
									ariaLabel="Work unit navigation"
									topItems={
										<NavButton
											label="Overview"
											icon={LayoutDashboard}
											active={currentView() === "overview"}
											onClick={() => handleSelectView("overview")}
											shortcut="1"
										/>
									}
									sections={
										<Show when={sessions().length > 0}>
											<NavSection
												title="Sessions"
												count={sessions().length}
												ariaLabel="Session tree"
											>
												<For each={sessions()}>
													{(session) => (
														<SessionTreeItem
															session={session}
															selectedSessionId={selectedSessionId()}
															selectedAgentId={selectedAgentId()}
															onSelectSession={handleSelectSession}
															onSelectAgent={handleSelectAgent}
														/>
													)}
												</For>
											</NavSection>
										</Show>
									}
								/>
							}
						>
							<Show when={panelKey()} keyed>
								{(_key) => (
									<div class="flex-1 overflow-hidden animate-page-fade">
										<Switch fallback={
											<WorkUnitOverview unit={u()} sessions={sessions()} />
										}>
											<Match when={currentView() === "overview"}>
												<WorkUnitOverview unit={u()} sessions={sessions()} />
											</Match>
											<Match when={currentView() === "session" && selectedSession()}>
												{/* Session-level view: reuse OverviewPanel or show "not analyzed" */}
												<Show when={selectedSession()?.distilled} fallback={
													<div class="flex h-full items-center justify-center">
														<p class="text-xs text-muted">
															Session not yet analyzed. Run <code class="font-mono">clens distill</code> first.
														</p>
													</div>
												}>
													{(distilled) => (
														<OverviewPanel
															session={distilled()}
															sessionId={selectedSessionId() ?? ""}
															isMultiAgent={(distilled().agents?.length ?? 0) > 1}
														/>
													)}
												</Show>
											</Match>
											<Match when={currentView() === "agent" && selectedAgent()}>
												{(agent) => (
													<Show when={selectedSession()?.distilled}>
														{(distilled) => (
															<AgentPanel
																agent={agent()}
																session={distilled()}
																sessionId={selectedSessionId() ?? ""}
															/>
														)}
													</Show>
												)}
											</Match>
											<Match when={currentView() === "conversation" && selectedSessionId()}>
												<ConversationPanel sessionId={selectedSessionId() ?? ""} />
											</Match>
										</Switch>
									</div>
								)}
							</Show>
						</DetailPageLayout>
					)}
				</Show>
			</Show>
		</PageShell>
	);
};

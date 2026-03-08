import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, For, Show, type Component } from "solid-js";
import type { AgentNode } from "../../shared/types";
import {
	createSessionDetail,
	createAgentConversationResource,
	globalError,
	clearError,
} from "../lib/stores";
import { createBidirectionalLink } from "../lib/linking";
import { SplitPane } from "../components/SplitPane";
import { ConversationPanel } from "../components/ConversationPanel";
import { DiffPanel } from "../components/DiffPanel";
import { CommunicationTimeline } from "../components/CommunicationTimeline";

// ── Formatting helpers ──────────────────────────────────────────────

const formatDuration = (ms: number): string => {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

const formatCost = (usd: number): string =>
	usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;

// ── Agent stats sidebar ─────────────────────────────────────────────

const StatRow: Component<{
	readonly label: string;
	readonly value: string;
}> = (props) => (
	<div class="flex items-center justify-between py-1">
		<span class="text-xs text-gray-500">{props.label}</span>
		<span class="text-xs font-medium text-gray-300">{props.value}</span>
	</div>
);

const AgentStatsSidebar: Component<{
	readonly agent: AgentNode;
}> = (props) => {
	const agent = () => props.agent;

	return (
		<div class="border-r border-gray-800 bg-gray-900/30 w-56 flex-shrink-0 overflow-y-auto">
			{/* Agent identity */}
			<div class="border-b border-gray-800 px-3 py-3">
				<h3 class="text-sm font-semibold text-gray-200 truncate">
					{agent().agent_name ?? agent().agent_type}
				</h3>
				<span class="text-[10px] text-gray-500 font-mono">
					{agent().session_id.slice(0, 12)}
				</span>
			</div>

			{/* Stats */}
			<div class="border-b border-gray-800 px-3 py-2">
				<h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">
					Stats
				</h4>
				<StatRow label="Duration" value={formatDuration(agent().duration_ms)} />
				<StatRow label="Tool calls" value={String(agent().tool_call_count)} />
				<Show when={agent().model}>
					{(m) => <StatRow label="Model" value={m()} />}
				</Show>
				<Show when={agent().cost_estimate}>
					{(c) => <StatRow label="Cost" value={formatCost(c().estimated_cost_usd)} />}
				</Show>
				<Show when={agent().tasks_completed !== undefined}>
					<StatRow label="Tasks done" value={String(agent().tasks_completed)} />
				</Show>
			</div>

			{/* Top tools */}
			<Show when={agent().stats?.tools_by_name}>
				{(tools) => {
					const sorted = createMemo(() =>
						Object.entries(tools())
							.sort(([, a], [, b]) => b - a)
							.slice(0, 8),
					);
					return (
						<div class="border-b border-gray-800 px-3 py-2">
							<h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">
								Tools
							</h4>
							<For each={sorted()}>
								{([name, count]) => (
									<div class="flex items-center justify-between py-0.5">
										<span class="text-[10px] font-mono text-gray-400 truncate">{name}</span>
										<span class="text-[10px] text-gray-600">{count}</span>
									</div>
								)}
							</For>
						</div>
					);
				}}
			</Show>

			{/* Files touched */}
			<Show when={agent().stats?.unique_files}>
				{(files) => (
					<div class="px-3 py-2">
						<h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">
							Files ({files().length})
						</h4>
						<For each={files().slice(0, 10)}>
							{(f) => (
								<div class="truncate text-[10px] font-mono text-gray-500 py-0.5">
									{f}
								</div>
							)}
						</For>
						<Show when={files().length > 10}>
							<div class="text-[10px] text-gray-600 mt-0.5">
								+{files().length - 10} more
							</div>
						</Show>
					</div>
				)}
			</Show>

			{/* Task prompt */}
			<Show when={agent().task_prompt}>
				{(prompt) => (
					<div class="border-t border-gray-800 px-3 py-2">
						<h4 class="text-[10px] font-semibold uppercase tracking-wider text-gray-600 mb-1">
							Task
						</h4>
						<p class="text-[10px] text-gray-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
							{prompt().slice(0, 500)}
							{prompt().length > 500 ? "..." : ""}
						</p>
					</div>
				)}
			</Show>
		</div>
	);
};

// ── Loading / error states ──────────────────────────────────────────

const LoadingSkeleton: Component = () => (
	<div class="flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-700 border-t-blue-500" />
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

// ── Main component ──────────────────────────────────────────────────

export const AgentView: Component = () => {
	const params = useParams<{ id: string; agentId: string }>();
	const navigate = useNavigate();

	// ── Data resources ──────────────────────────────────────────

	const sessionId = () => params.id;
	const agentId = () => params.agentId;
	const [sessionDetail] = createSessionDetail(sessionId);
	const [agentConversation] = createAgentConversationResource(sessionId, agentId);

	// ── Derived state ───────────────────────────────────────────

	const session = createMemo(() => {
		const detail = sessionDetail();
		if (detail?.status === "ready") return detail.data;
		return undefined;
	});

	const agent = createMemo((): AgentNode | undefined => {
		const s = session();
		if (!s?.agents) return undefined;
		return findAgentInTree(s.agents, params.agentId);
	});

	const entries = createMemo(() => agentConversation() ?? []);

	const commSequence = createMemo(() => session()?.comm_sequence ?? []);
	const agentLifetimes = createMemo(() => session()?.agent_lifetimes ?? []);

	// ── Bidirectional linking ────────────────────────────────────

	const link = createBidirectionalLink(entries);

	return (
		<div class="flex h-[calc(100vh-49px)] flex-col">
			{/* Error banner */}
			<Show when={globalError()}>
				{(err) => (
					<div class="flex items-center justify-between border-b border-red-800/50 bg-red-900/20 px-4 py-2 text-sm text-red-400">
						<span>{err().message}</span>
						<button onClick={clearError} class="ml-4 text-red-500 hover:text-red-300">
							Dismiss
						</button>
					</div>
				)}
			</Show>

			{/* Nav bar */}
			<div class="flex items-center gap-2 border-b border-gray-800 px-4 py-1.5">
				<button
					onClick={() => navigate(`/session/${params.id}`)}
					class="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
				>
					&larr; Session
				</button>
				<span class="text-xs text-gray-600">/</span>
				<span class="text-xs text-gray-400">
					{agent()?.agent_name ?? agent()?.agent_type ?? params.agentId.slice(0, 12)}
				</span>
			</div>

			{/* Main content */}
			<Show
				when={!sessionDetail.loading && !agentConversation.loading}
				fallback={<LoadingSkeleton />}
			>
				<Show when={agent()} fallback={<AgentNotFound />}>
					{(a) => (
						<div class="flex flex-1 overflow-hidden">
							{/* Agent stats sidebar */}
							<AgentStatsSidebar agent={a()} />

							{/* Main area */}
							<div class="flex flex-1 flex-col overflow-hidden">
								{/* Communication timeline (if multi-agent) */}
								<Show when={commSequence().length > 0}>
									<div class="h-48 border-b border-gray-800 flex-shrink-0">
										<CommunicationTimeline
											sequence={commSequence()}
											lifetimes={agentLifetimes()}
											sessionStartTime={session()?.start_time}
										/>
									</div>
								</Show>

								{/* Split pane: conversation | diff */}
								<div class="flex-1 overflow-hidden">
									<SplitPane
										left={
											<ConversationPanel
												entries={entries()}
												onToolClick={link.handleToolClick}
												scrollToFile={link.scrollToFileInConversation}
												flashSelector={link.flashSelector}
											/>
										}
										right={
											<Show
												when={a().file_map}
												fallback={
													<div class="flex h-full items-center justify-center text-sm text-gray-500">
														No file data for this agent
													</div>
												}
											>
												{(fm) => (
													<DiffPanel
														fileMap={fm()}
														gitDiff={session()?.git_diff ?? { commits: [], hunks: [] }}
														editChains={a().edit_chains}
														highlightedFile={link.highlightedFile()}
														onFileClick={link.handleFileClick}
														scrollToFile={link.highlightedFile}
														flashSelector={link.flashSelector}
													/>
												)}
											</Show>
										}
									/>
								</div>
							</div>
						</div>
					)}
				</Show>
			</Show>
		</div>
	);
};

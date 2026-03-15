import { Wrench, MessageSquare, FileCode, ArrowUp, ArrowDown } from "lucide-solid";
import { createMemo, For, Show, type Component } from "solid-js";
import type { AgentNode, DistilledSession } from "../../../shared/types";
import { getTypeBadgeClass } from "../../lib/agent-colors";
import { formatDuration, formatCost } from "../../lib/format";
import { Card } from "../ui/Card";
import { StatItem } from "../ui/StatItem";
import { FileList, buildAgentFileRows } from "../FileList";
import { SplitPane } from "../SplitPane";
import { SystemPromptPanel } from "../SystemPromptPanel";

// ── Tool color palette ────────────────────────────────────────────────

const getToolColor = (toolName: string): string => {
	const name = toolName.toLowerCase();
	if (name.includes('read') || name.includes('file') || name.includes('glob')) return 'bg-sky-500/15 dark:bg-sky-400/15';
	if (name.includes('write') || name.includes('edit') || name.includes('notebook')) return 'bg-emerald-500/15 dark:bg-emerald-400/15';
	if (name.includes('bash') || name.includes('terminal')) return 'bg-amber-500/15 dark:bg-amber-400/15';
	if (name.includes('search') || name.includes('grep')) return 'bg-violet-500/15 dark:bg-violet-400/15';
	if (name.includes('agent') || name.includes('task') || name.includes('send')) return 'bg-brand-500/15 dark:bg-brand-400/15';
	return 'bg-gray-500/10 dark:bg-gray-400/10';
};

const getToolBarColor = (toolName: string): string => {
	const name = toolName.toLowerCase();
	if (name.includes('read') || name.includes('file') || name.includes('glob')) return 'bg-sky-500 dark:bg-sky-400';
	if (name.includes('write') || name.includes('edit') || name.includes('notebook')) return 'bg-emerald-500 dark:bg-emerald-400';
	if (name.includes('bash') || name.includes('terminal')) return 'bg-amber-500 dark:bg-amber-400';
	if (name.includes('search') || name.includes('grep')) return 'bg-violet-500 dark:bg-violet-400';
	if (name.includes('agent') || name.includes('task') || name.includes('send')) return 'bg-brand-500 dark:bg-brand-400';
	return 'bg-gray-400 dark:bg-gray-500';
};

// ── Types ────────────────────────────────────────────────────────────

type AgentPanelProps = {
	readonly agent: AgentNode;
	readonly session: DistilledSession;
	readonly sessionId: string;
};

// ── Center content (agent header + tools + comms + files) ────────────

const isGhostAgent = (agent: AgentNode): boolean =>
	agent.duration_ms === 0 && agent.tool_call_count === 0;

const AgentCenterContent: Component<{ readonly agent: AgentNode }> = (props) => {
	const fileRows = createMemo(() => buildAgentFileRows(props.agent));
	const ghost = createMemo(() => isGhostAgent(props.agent));

	return (
		<div class="flex-1 overflow-y-auto p-4 space-y-4">
			{/* Agent header card */}
			<Card class="p-4">
				<div class="flex items-center gap-3 mb-3">
					<span class={`rounded px-1.5 py-0.5 text-xs font-medium leading-none ${getTypeBadgeClass(props.agent.agent_type)}`}>
						{props.agent.agent_type}
					</span>
					<h2 class="text-sm font-semibold text-primary">
						{props.agent.agent_name ?? props.agent.agent_type}
					</h2>
					<span class="text-xs font-mono text-muted">
						{props.agent.session_id.slice(0, 12)}
					</span>
					<Show when={ghost()}>
						<span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
							orchestrator
						</span>
					</Show>
				</div>
				<div class="grid grid-cols-2 gap-x-6 gap-y-0.5 max-w-md overflow-hidden">
					<StatItem label="Duration" value={formatDuration(props.agent.duration_ms)} />
					<StatItem label="Tool calls" value={String(props.agent.tool_call_count)} />
					<Show when={props.agent.model}>
						{(m) => <StatItem label="Model" value={m()} />}
					</Show>
					<Show when={props.agent.cost_estimate}>
						{(c) => (
							<StatItem
								label="Cost"
								value={formatCost(c().estimated_cost_usd, c().is_estimated)}
								muted={c().is_estimated}
								title={c().is_estimated ? "Estimated cost (real token data unavailable)" : undefined}
							/>
						)}
					</Show>
					<Show when={props.agent.tasks_completed !== undefined}>
						<StatItem label="Tasks done" value={String(props.agent.tasks_completed)} />
					</Show>
				</div>
			</Card>

			{/* Task events — shows what this agent spawned/delegated */}
			<Show when={(props.agent.task_events?.length ?? 0) > 0}>
				<Card>
					<div class="px-4 py-2.5 border-b border-clens">
						<h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
							Spawned Tasks
						</h3>
					</div>
					<div class="px-4 py-2 space-y-1">
						<For each={props.agent.task_events ?? []}>
							{(te) => (
								<div class="flex items-center gap-2 py-0.5 text-xs">
									<span class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
										te.action === "create" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
										: te.action === "complete" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
										: "bg-surface-muted text-muted"
									}`}>
										{te.action}
									</span>
									<Show when={te.owner}>
										<span class="font-mono text-secondary">{te.owner}</span>
									</Show>
									<Show when={te.subject}>
										<span class="truncate text-muted">{te.subject}</span>
									</Show>
								</div>
							)}
						</For>
					</div>
				</Card>
			</Show>

			{/* Tools by name -- proportional bars */}
			<Show when={props.agent.stats?.tools_by_name}>
				{(tools) => {
					const sorted = createMemo(() =>
						Object.entries(tools())
							.sort(([, x], [, y]) => y - x)
							.slice(0, 10),
					);
					const maxCount = createMemo(() =>
						sorted().reduce((max, [, count]) => Math.max(max, count), 0),
					);
					return (
						<Card>
							<div class="px-4 py-2.5 border-b border-clens">
								<h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
									<Wrench class="h-3.5 w-3.5" />
									Top Tools
								</h3>
							</div>
							<div class="px-4 py-2 space-y-0.5">
								<For each={sorted()}>
									{([name, count]) => {
										const totalCalls = sorted().reduce((sum, [, c]) => sum + c, 0);
										const pct = totalCalls > 0 ? Math.round((count / totalCalls) * 100) : 0;
										return (
											<div class="relative flex items-center justify-between rounded py-1 px-2">
												{/* Proportional background bar */}
												<div
													class={`absolute inset-y-0 left-0 rounded ${getToolColor(name)}`}
													style={{ width: `${maxCount() > 0 ? (count / maxCount()) * 100 : 0}%` }}
													role="img"
													aria-label={`${name}: ${count} uses (${pct}%)`}
												/>
												<span class="relative flex items-center gap-1.5 text-xs font-mono truncate text-muted">
													<span class={`inline-block h-2 w-2 rounded-sm shrink-0 ${getToolBarColor(name)}`} />
													{name}
												</span>
												<span class="relative flex items-center gap-1 text-xs tabular-nums text-muted">
													<span>{count}</span>
													<span class="text-[10px] text-gray-400">({pct}%)</span>
												</span>
											</div>
										);
									}}
								</For>
							</div>
						</Card>
					);
				}}
			</Show>

			{/* Communication partners */}
			<Show when={(props.agent.communication_partners?.length ?? 0) > 0}>
				<Card>
					<div class="px-4 py-2.5 border-b border-clens">
						<h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
							<MessageSquare class="h-3.5 w-3.5" />
							Communication
						</h3>
					</div>
					<div class="px-4 py-2">
						<For each={props.agent.communication_partners ?? []}>
							{(cp) => (
								<div class="flex items-center justify-between py-0.5">
									<span class="text-xs font-mono text-gray-500 truncate text-muted">{cp.name}</span>
									<span class="text-xs text-gray-400 tabular-nums text-muted">
										{cp.sent_count}<ArrowUp class="inline h-2.5 w-2.5" /> {cp.received_count}<ArrowDown class="inline h-2.5 w-2.5" />
									</span>
								</div>
							)}
						</For>
					</div>
				</Card>
			</Show>

			{/* Per-agent files */}
			<Card>
				<div class="flex items-center gap-1.5 px-4 py-2.5 border-b border-clens">
					<h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
						<FileCode class="h-3.5 w-3.5" />
						Files
					</h3>
				</div>
				<FileList rows={fileRows()} emptyMessage="No file data for this agent" />
			</Card>
		</div>
	);
};

// ── Main component ──────────────────────────────────────────────────

export const AgentPanel: Component<AgentPanelProps> = (props) => (
	<Show
		when={props.agent.task_prompt}
		fallback={<AgentCenterContent agent={props.agent} />}
	>
		<SplitPane
			id="agent-sysprompt"
			direction="horizontal"
			defaultRatio={0.65}
			left={<AgentCenterContent agent={props.agent} />}
			right={<SystemPromptPanel prompt={props.agent.task_prompt} />}
		/>
	</Show>
);

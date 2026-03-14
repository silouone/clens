import { Wrench, MessageSquare, FileCode, ArrowUp, ArrowDown } from "lucide-solid";
import { createMemo, For, Show, type Component } from "solid-js";
import type { AgentNode, DistilledSession } from "../../../shared/types";
import { getTypeBadgeClass } from "../../lib/agent-colors";
import { formatDuration, formatCost } from "../../lib/format";
import { StatItem } from "../ui/StatItem";
import { FileList, buildAgentFileRows } from "../FileList";
import { SplitPane } from "../SplitPane";
import { SystemPromptPanel } from "../SystemPromptPanel";

// ── Types ────────────────────────────────────────────────────────────

type AgentPanelProps = {
	readonly agent: AgentNode;
	readonly session: DistilledSession;
	readonly sessionId: string;
};

// ── Center content (agent header + tools + comms + files) ────────────

const AgentCenterContent: Component<{ readonly agent: AgentNode }> = (props) => {
	const fileRows = createMemo(() => buildAgentFileRows(props.agent));

	return (
		<div class="flex-1 overflow-y-auto p-4 space-y-4">
			{/* Agent header card */}
			<div class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
				<div class="flex items-center gap-3 mb-3">
					<span class={`rounded px-1.5 py-0.5 text-xs font-medium leading-none ${getTypeBadgeClass(props.agent.agent_type)}`}>
						{props.agent.agent_type}
					</span>
					<h2 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
						{props.agent.agent_name ?? props.agent.agent_type}
					</h2>
					<span class="text-xs text-gray-400 font-mono dark:text-gray-400">
						{props.agent.session_id.slice(0, 12)}
					</span>
				</div>
				<div class="grid grid-cols-2 gap-x-6 gap-y-0.5 max-w-sm">
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
			</div>

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
						<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
							<div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
								<h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
									<Wrench class="h-3.5 w-3.5" />
									Top Tools
								</h3>
							</div>
							<div class="px-4 py-2 space-y-0.5">
								<For each={sorted()}>
									{([name, count]) => (
										<div class="relative flex items-center justify-between rounded py-1 px-2">
											{/* Proportional background bar */}
											<div
												class="absolute inset-y-0 left-0 rounded bg-blue-500/10 dark:bg-blue-400/10"
												style={{ width: `${maxCount() > 0 ? (count / maxCount()) * 100 : 0}%` }}
											/>
											<span class="relative text-xs font-mono text-gray-500 truncate dark:text-gray-400">{name}</span>
											<span class="relative text-xs text-gray-400 tabular-nums dark:text-gray-400">{count}</span>
										</div>
									)}
								</For>
							</div>
						</div>
					);
				}}
			</Show>

			{/* Communication partners */}
			<Show when={(props.agent.communication_partners?.length ?? 0) > 0}>
				<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
					<div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
						<h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
							<MessageSquare class="h-3.5 w-3.5" />
							Communication
						</h3>
					</div>
					<div class="px-4 py-2">
						<For each={props.agent.communication_partners ?? []}>
							{(cp) => (
								<div class="flex items-center justify-between py-0.5">
									<span class="text-xs font-mono text-gray-500 truncate dark:text-gray-400">{cp.name}</span>
									<span class="text-xs text-gray-400 tabular-nums dark:text-gray-400">
										{cp.sent_count}<ArrowUp class="inline h-2.5 w-2.5" /> {cp.received_count}<ArrowDown class="inline h-2.5 w-2.5" />
									</span>
								</div>
							)}
						</For>
					</div>
				</div>
			</Show>

			{/* Per-agent files */}
			<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
				<div class="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800">
					<h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
						<FileCode class="h-3.5 w-3.5" />
						Files
					</h3>
				</div>
				<FileList rows={fileRows()} emptyMessage="No file data for this agent" />
			</div>
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

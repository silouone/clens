import { createSignal, For, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { AgentNode } from "../../shared/types";
import { formatDuration, formatCost } from "../lib/format";
import { getTypeBadgeClass } from "../lib/agent-colors";

// ── Types ────────────────────────────────────────────────────────────

type AgentTreeProps = {
	readonly agents: readonly AgentNode[];
	readonly sessionId: string;
	readonly selectedAgentId?: string;
	readonly compact?: boolean;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const sumDiffStats = (
	agent: AgentNode,
): { readonly additions: number; readonly deletions: number } | undefined => {
	const attrs = agent.edit_chains?.diff_attribution;
	if (!attrs || attrs.length === 0) return undefined;
	return attrs.reduce(
		(acc, f) => ({
			additions: acc.additions + f.total_additions,
			deletions: acc.deletions + f.total_deletions,
		}),
		{ additions: 0, deletions: 0 } as { readonly additions: number; readonly deletions: number },
	);
};

// ── Collapsible agent row ───────────────────────────────────────────

const AgentRow: Component<{
	readonly agent: AgentNode;
	readonly depth: number;
	readonly sessionId: string;
	readonly selectedAgentId?: string;
}> = (props) => {
	const navigate = useNavigate();
	const hasChildren = () => props.agent.children.length > 0;
	const [expanded, setExpanded] = createSignal(true);
	const isSelected = () => props.selectedAgentId === props.agent.session_id;

	const handleClick = () => {
		if (!props.agent.session_id) return;
		navigate(`/session/${props.sessionId}/agent/${props.agent.session_id}`);
	};

	const handleToggle = (e: MouseEvent) => {
		e.stopPropagation();
		setExpanded((prev) => !prev);
	};

	return (
		<div>
			<button
				onClick={handleClick}
				class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition hover:bg-gray-100 dark:hover:bg-gray-800/50"
				classList={{
					"bg-blue-50 border-l-2 border-blue-500 dark:bg-blue-900/20": isSelected(),
				}}
				style={{ "padding-left": `${8 + props.depth * 14}px` }}
			>
				{/* Expand/collapse toggle */}
				<Show
					when={hasChildren()}
					fallback={<span class="w-3" />}
				>
					<span
						class="w-3 cursor-pointer text-gray-400 hover:text-gray-700 transition-transform dark:text-gray-500 dark:hover:text-gray-300"
						classList={{ "rotate-90": expanded() }}
						onClick={handleToggle}
					>
						&#9654;
					</span>
				</Show>

				{/* Type badge */}
				<span
					class={`rounded px-1 py-0.5 text-[9px] font-medium ${getTypeBadgeClass(props.agent.agent_type)}`}
				>
					{props.agent.agent_type.slice(0, 8)}
				</span>

				{/* Name */}
				<span class="truncate font-medium text-gray-700 flex-1 dark:text-gray-300">
					{props.agent.agent_name || props.agent.agent_type}
				</span>

				{/* Stats: diff +/-, cost, tools, duration */}
				<span class="text-[10px] text-gray-400 tabular-nums flex-shrink-0 flex items-center gap-1 dark:text-gray-600">
					{(() => {
						const diff = sumDiffStats(props.agent);
						return diff ? (
							<span>
								<span class="text-emerald-400">+{diff.additions}</span>
								<span class="mx-px">/</span>
								<span class="text-red-400">-{diff.deletions}</span>
							</span>
						) : null;
					})()}
					<Show when={props.agent.cost_estimate}>
						{(cost) => (
							<span class="text-gray-500 dark:text-gray-500">
								{formatCost(cost().estimated_cost_usd)}
							</span>
						)}
					</Show>
					<span>
						{props.agent.tool_call_count > 0
							? `${props.agent.tool_call_count}t · ${formatDuration(props.agent.duration_ms)}`
							: formatDuration(props.agent.duration_ms)}
					</span>
				</span>
			</button>

			{/* Children */}
			<Show when={expanded() && hasChildren()}>
				<For each={props.agent.children}>
					{(child) => (
						<AgentRow
							agent={child}
							depth={props.depth + 1}
							sessionId={props.sessionId}
							selectedAgentId={props.selectedAgentId}
						/>
					)}
				</For>
			</Show>
		</div>
	);
};

// ── Main component ──────────────────────────────────────────────────

const countAllAgents = (agents: readonly AgentNode[]): number =>
	agents.reduce((sum, a) => sum + 1 + countAllAgents(a.children), 0);

export const AgentTree: Component<AgentTreeProps> = (props) => (
	<div class="border-r border-gray-200 bg-gray-50 w-56 flex-shrink-0 overflow-y-auto dark:border-gray-800 dark:bg-gray-900/30">
		<Show when={!props.compact}>
			<div class="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
					Agents ({countAllAgents(props.agents)})
				</h3>
			</div>
		</Show>
		<div class="py-1">
			<For each={props.agents}>
				{(agent) => (
					<AgentRow
						agent={agent}
						depth={0}
						sessionId={props.sessionId}
						selectedAgentId={props.selectedAgentId}
					/>
				)}
			</For>
		</div>
	</div>
);

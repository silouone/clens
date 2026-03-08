import { createSignal, For, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { AgentNode, FileDiffAttribution } from "../../shared/types";
import { formatDuration, formatCost } from "../lib/format";

// ── Types ────────────────────────────────────────────────────────────

type AgentListPanelProps = {
	readonly agents: readonly AgentNode[];
	readonly sessionId: string;
	readonly selectedAgentId?: string;
	readonly mode: "full" | "compact";
};

// ── Agent type badge colors (shared with AgentTree) ─────────────────

const TYPE_COLORS: Readonly<Record<string, string>> = {
	"general-purpose": "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-400",
	builder: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-400",
	validator: "bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-400",
	Explore: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-400",
	Plan: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-400",
	leader: "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-400",
};

const getTypeBadgeClass = (agentType: string): string =>
	TYPE_COLORS[agentType] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400";

// ── Helpers ──────────────────────────────────────────────────────────

type DiffStats = { readonly additions: number; readonly deletions: number };

const computeDiffStats = (agent: AgentNode): DiffStats | undefined => {
	const attrs = agent.edit_chains?.diff_attribution;
	if (!attrs || attrs.length === 0) return undefined;
	return attrs.reduce<DiffStats>(
		(acc, f: FileDiffAttribution) => ({
			additions: acc.additions + f.total_additions,
			deletions: acc.deletions + f.total_deletions,
		}),
		{ additions: 0, deletions: 0 },
	);
};

const isLeadAgent = (agent: AgentNode, index: number): boolean =>
	index === 0 || agent.children.length > 0;

// ── Compact agent row (sidebar) ─────────────────────────────────────

const CompactRow: Component<{
	readonly agent: AgentNode;
	readonly depth: number;
	readonly sessionId: string;
	readonly selectedAgentId?: string;
	readonly isLead: boolean;
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
				class="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-xs transition hover:bg-gray-100 dark:hover:bg-gray-800/50"
				classList={{
					"bg-blue-50 border-l-2 border-blue-500 dark:bg-blue-900/20": isSelected(),
				}}
				style={{ "padding-left": `${8 + props.depth * 12}px` }}
			>
				<Show when={hasChildren()} fallback={<span class="w-3" />}>
					<span
						class="w-3 cursor-pointer text-gray-400 hover:text-gray-700 transition-transform dark:text-gray-500 dark:hover:text-gray-300"
						classList={{ "rotate-90": expanded() }}
						onClick={handleToggle}
					>
						&#9654;
					</span>
				</Show>

				<span class={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${getTypeBadgeClass(props.agent.agent_type)}`}>
					{props.agent.agent_type.slice(0, 6)}
				</span>

				<Show when={props.isLead}>
					<span class="shrink-0 rounded bg-yellow-100 px-1 py-0.5 text-[9px] font-medium text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400">
						Lead
					</span>
				</Show>

				<span class="truncate font-medium text-gray-700 flex-1 dark:text-gray-300">
					{props.agent.agent_name || props.agent.agent_type}
				</span>

				<span class="text-[10px] text-gray-400 tabular-nums shrink-0 dark:text-gray-600">
					{formatDuration(props.agent.duration_ms)}
				</span>
			</button>

			<Show when={expanded() && hasChildren()}>
				<For each={props.agent.children}>
					{(child) => (
						<CompactRow
							agent={child}
							depth={props.depth + 1}
							sessionId={props.sessionId}
							selectedAgentId={props.selectedAgentId}
							isLead={false}
						/>
					)}
				</For>
			</Show>
		</div>
	);
};

// ── Full agent row (TeamDashboard) ──────────────────────────────────

const FullRow: Component<{
	readonly agent: AgentNode;
	readonly depth: number;
	readonly sessionId: string;
	readonly isLead: boolean;
}> = (props) => {
	const navigate = useNavigate();
	const hasChildren = () => props.agent.children.length > 0;
	const [expanded, setExpanded] = createSignal(true);
	const diffStats = () => computeDiffStats(props.agent);

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
				class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition hover:bg-gray-100 dark:hover:bg-gray-800/50"
				style={{ "padding-left": `${12 + props.depth * 16}px` }}
			>
				<Show when={hasChildren()} fallback={<span class="w-4" />}>
					<span
						class="w-4 cursor-pointer text-gray-400 hover:text-gray-700 transition-transform dark:text-gray-500 dark:hover:text-gray-300"
						classList={{ "rotate-90": expanded() }}
						onClick={handleToggle}
					>
						&#9654;
					</span>
				</Show>

				<span class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getTypeBadgeClass(props.agent.agent_type)}`}>
					{props.agent.agent_type}
				</span>

				<Show when={props.isLead}>
					<span class="shrink-0 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400">
						Lead
					</span>
				</Show>

				<span class="truncate font-medium text-gray-700 flex-1 dark:text-gray-300">
					{props.agent.agent_name || props.agent.agent_type}
				</span>

				{/* Stats cluster */}
				<span class="flex items-center gap-3 text-xs text-gray-500 tabular-nums shrink-0 dark:text-gray-400">
					<Show when={props.agent.tool_call_count > 0}>
						<span>{props.agent.tool_call_count} tools</span>
					</Show>
					<span>{formatDuration(props.agent.duration_ms)}</span>
					<Show when={diffStats()}>
						{(ds) => (
							<span>
								<span class="text-emerald-600 dark:text-emerald-400">+{ds().additions}</span>
								<span class="mx-0.5">/</span>
								<span class="text-red-500 dark:text-red-400">-{ds().deletions}</span>
							</span>
						)}
					</Show>
					<Show when={props.agent.cost_estimate}>
						{(cost) => (
							<span class="text-gray-400 dark:text-gray-500">
								{formatCost(cost().estimated_cost_usd)}
							</span>
						)}
					</Show>
				</span>
			</button>

			<Show when={expanded() && hasChildren()}>
				<For each={props.agent.children}>
					{(child) => (
						<FullRow
							agent={child}
							depth={props.depth + 1}
							sessionId={props.sessionId}
							isLead={false}
						/>
					)}
				</For>
			</Show>
		</div>
	);
};

// ── Counting helper ─────────────────────────────────────────────────

const countAllAgents = (agents: readonly AgentNode[]): number =>
	agents.reduce((sum, a) => sum + 1 + countAllAgents(a.children), 0);

// ── Main component ──────────────────────────────────────────────────

export const AgentListPanel: Component<AgentListPanelProps> = (props) => {
	const isCompact = () => props.mode === "compact";

	return (
		<div
			class="border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-y-auto dark:border-gray-800 dark:bg-gray-900/30"
			classList={{ "w-48": isCompact(), "w-full": !isCompact() }}
		>
			<div class="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
					Agents ({countAllAgents(props.agents)})
				</h3>
			</div>
			<div class="py-1">
				<Show when={isCompact()}>
					<For each={props.agents}>
						{(agent, i) => (
							<CompactRow
								agent={agent}
								depth={0}
								sessionId={props.sessionId}
								selectedAgentId={props.selectedAgentId}
								isLead={isLeadAgent(agent, i())}
							/>
						)}
					</For>
				</Show>
				<Show when={!isCompact()}>
					<For each={props.agents}>
						{(agent, i) => (
							<FullRow
								agent={agent}
								depth={0}
								sessionId={props.sessionId}
								isLead={isLeadAgent(agent, i())}
							/>
						)}
					</For>
				</Show>
			</div>
		</div>
	);
};

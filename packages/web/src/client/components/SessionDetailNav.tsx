import { createSignal, For, Show, type Component } from "solid-js";
import { LayoutDashboard, MessageSquare } from "lucide-solid";
import type { AgentNode, DistilledSession } from "../../shared/types";
import { getTypeBadgeClass } from "../lib/agent-colors";
import { countAllAgents, sumDiffStats } from "../lib/agent-utils";
import { formatCost, formatDuration } from "../lib/format";
import { NavButton } from "./ui/NavButton";
import { TreeToggle } from "./ui/TreeToggle";
import { DetailNav } from "./DetailNav";
import { NavSection } from "./NavSection";

// ── Types ────────────────────────────────────────────────────────────

type SessionDetailNavProps = {
	readonly session: DistilledSession;
	readonly sessionId: string;
	readonly currentView: string;
	readonly selectedAgentId?: string;
	readonly onSelectView: (view: string, agentId?: string) => void;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const isLeadAgent = (agent: AgentNode, index: number): boolean =>
	index === 0 || agent.agent_type === "leader" || agent.children.length > 0;

// ── Collapsible agent row ────────────────────────────────────────────

const AgentNavRow: Component<{
	readonly agent: AgentNode;
	readonly depth: number;
	readonly selectedAgentId?: string;
	readonly isLead: boolean;
	readonly onSelect: (agentId: string) => void;
}> = (props) => {
	const hasChildren = () => props.agent.children.length > 0;
	const [expanded, setExpanded] = createSignal(true);
	const isSelected = () => props.selectedAgentId === props.agent.session_id;

	const handleClick = () => {
		if (!props.agent.session_id) return;
		props.onSelect(props.agent.session_id);
	};

	const handleToggle = (e: MouseEvent) => {
		e.stopPropagation();
		setExpanded((prev) => !prev);
	};

	return (
		<div role="treeitem" aria-selected={isSelected()} aria-expanded={hasChildren() ? expanded() : undefined}>
			<button
				onClick={handleClick}
				class="group flex w-full flex-col rounded-md mx-1.5 mb-0.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:hover:bg-gray-800/50 dark:focus:ring-offset-gray-900"
				classList={{
					"bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800/40": isSelected(),
				}}
				style={{ "margin-left": `${6 + props.depth * 12}px` }}
				aria-label={`Agent: ${props.agent.agent_name || props.agent.agent_type}${props.isLead ? " (Lead)" : ""}`}
			>
				{/* Row 1: chevron + badges + name */}
				<div class="flex w-full items-center gap-1.5 px-2 pt-1.5 pb-0.5">
					<TreeToggle expanded={expanded()} onToggle={handleToggle} hasChildren={hasChildren()} />

					{/* Type badge */}
					<span
						class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${getTypeBadgeClass(props.agent.agent_type)}`}
					>
						{props.agent.agent_type}
					</span>

					{/* Lead badge */}
					<Show when={props.isLead}>
						<span class="shrink-0 rounded bg-yellow-100 px-1 py-0.5 text-[10px] font-medium leading-none text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400">
							Lead
						</span>
					</Show>

					{/* Name */}
					<span class="flex-1 truncate font-medium text-gray-700 dark:text-gray-300">
						{props.agent.agent_name || props.agent.agent_type}
					</span>
				</div>

				{/* Row 2: stats (cost, duration, diff) — right-aligned under name */}
				<div class="flex w-full items-center gap-2 px-2 pb-1.5 pl-[26px] text-[10px] tabular-nums text-gray-400 dark:text-gray-400">
					{(() => {
						const diff = sumDiffStats(props.agent);
						return diff ? (
							<span>
								<span class="text-emerald-500 dark:text-emerald-400">+{diff.additions}</span>
								<span class="mx-0.5 text-gray-300 dark:text-gray-600">/</span>
								<span class="text-red-500 dark:text-red-400">-{diff.deletions}</span>
							</span>
						) : null;
					})()}
					<Show when={props.agent.cost_estimate}>
						{(cost) => (
							<span title={cost().is_estimated ? "Estimated" : undefined}>
								{formatCost(cost().estimated_cost_usd, cost().is_estimated)}
							</span>
						)}
					</Show>
					<span class="ml-auto">{formatDuration(props.agent.duration_ms)}</span>
				</div>
			</button>

			{/* Children */}
			<Show when={expanded() && hasChildren()}>
				<For each={props.agent.children}>
					{(child) => (
						<AgentNavRow
							agent={child}
							depth={props.depth + 1}
							selectedAgentId={props.selectedAgentId}
							isLead={false}
							onSelect={props.onSelect}
						/>
					)}
				</For>
			</Show>
		</div>
	);
};

// ── Main component ───────────────────────────────────────────────────

export const SessionDetailNav: Component<SessionDetailNavProps> = (props) => {
	const agents = () => props.session.agents ?? [];
	const agentCount = () => countAllAgents(agents());

	const handleAgentSelect = (agentId: string) => {
		props.onSelectView("agent", agentId);
	};

	return (
		<DetailNav
			ariaLabel="Session navigation"
			topItems={
				<>
					<NavButton
						label="Overview"
						icon={LayoutDashboard}
						active={props.currentView === "overview"}
						onClick={() => props.onSelectView("overview")}
						shortcut="1"
					/>
					<NavButton
						label="Conversation"
						icon={MessageSquare}
						active={props.currentView === "conversation"}
						onClick={() => props.onSelectView("conversation")}
						shortcut="c"
					/>
				</>
			}
			sections={
				<Show when={agents().length > 0}>
					<NavSection title="Agents" count={agentCount()} ariaLabel="Agent tree">
						<For each={agents()}>
							{(agent, i) => (
								<AgentNavRow
									agent={agent}
									depth={0}
									selectedAgentId={props.selectedAgentId}
									isLead={isLeadAgent(agent, i())}
									onSelect={handleAgentSelect}
								/>
							)}
						</For>
					</NavSection>
				</Show>
			}
		/>
	);
};

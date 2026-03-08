import { createSignal, For, Show, type Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { AgentNode } from "../../shared/types";

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

// ── Types ────────────────────────────────────────────────────────────

type AgentTreeProps = {
	readonly agents: readonly AgentNode[];
	readonly sessionId: string;
	readonly selectedAgentId?: string;
};

// ── Agent type badge colors ─────────────────────────────────────────

const TYPE_COLORS: Readonly<Record<string, string>> = {
	"general-purpose": "bg-blue-900/60 text-blue-400",
	builder: "bg-emerald-900/60 text-emerald-400",
	validator: "bg-violet-900/60 text-violet-400",
	Explore: "bg-sky-900/60 text-sky-400",
	Plan: "bg-amber-900/60 text-amber-400",
	leader: "bg-red-900/60 text-red-400",
};

const getTypeBadgeClass = (agentType: string): string =>
	TYPE_COLORS[agentType] ?? "bg-gray-800/60 text-gray-400";

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
				class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition hover:bg-gray-800/50"
				classList={{
					"bg-blue-900/20 border-l-2 border-blue-500": isSelected(),
				}}
				style={{ "padding-left": `${8 + props.depth * 14}px` }}
			>
				{/* Expand/collapse toggle */}
				<Show
					when={hasChildren()}
					fallback={<span class="w-3" />}
				>
					<span
						class="w-3 cursor-pointer text-gray-500 hover:text-gray-300 transition-transform"
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
				<span class="truncate font-medium text-gray-300 flex-1">
					{props.agent.agent_name ?? props.agent.session_id.slice(0, 8)}
				</span>

				{/* Stats */}
				<span class="text-[10px] text-gray-600 tabular-nums flex-shrink-0">
					{props.agent.tool_call_count}t
				</span>
				<span class="text-[10px] text-gray-600 tabular-nums flex-shrink-0">
					{formatDuration(props.agent.duration_ms)}
				</span>
			</button>

			{/* Cost line (compact) */}
			<Show when={isSelected() && props.agent.cost_estimate}>
				{(cost) => (
					<div
						class="text-[9px] text-gray-500 pb-1"
						style={{ "padding-left": `${22 + props.depth * 14}px` }}
					>
						{formatCost(cost().estimated_cost_usd)} &middot; {props.agent.model ?? "unknown"}
					</div>
				)}
			</Show>

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

export const AgentTree: Component<AgentTreeProps> = (props) => (
	<div class="border-r border-gray-800 bg-gray-900/30 w-56 flex-shrink-0 overflow-y-auto">
		<div class="px-3 py-2 border-b border-gray-800">
			<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500">
				Agents ({props.agents.length})
			</h3>
		</div>
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

import { createMemo, For, Show, type Component } from "solid-js";
import { Users } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";
import { formatDuration, formatCost, formatPercentage } from "../lib/format";
import { getTypeBadgeClass } from "../lib/agent-colors";
import { flattenAgents } from "../lib/agent-utils";

// ── Types ────────────────────────────────────────────────────────────

type AgentWorkloadTableProps = {
	readonly session: DistilledSession;
	readonly sessionId: string;
};

type FlatAgent = {
	readonly name: string;
	readonly agentType: string;
	readonly toolCalls: number;
	readonly durationMs: number;
	readonly filesModified: number;
	readonly costUsd: number;
	readonly isEstimated: boolean;
};

// ── Pure helpers ─────────────────────────────────────────────────────

/** Convert an AgentNode to a flat row for the table. */
const toFlatAgent = (agent: { readonly agent_name?: string; readonly agent_type: string; readonly tool_call_count: number; readonly duration_ms: number; readonly file_map?: { readonly files: readonly { readonly edits: number }[] }; readonly cost_estimate?: { readonly estimated_cost_usd: number; readonly is_estimated: boolean } }): FlatAgent => ({
	name: agent.agent_name ?? agent.agent_type,
	agentType: agent.agent_type,
	toolCalls: agent.tool_call_count,
	durationMs: agent.duration_ms,
	filesModified: agent.file_map?.files.filter((f) => f.edits > 0).length ?? 0,
	costUsd: agent.cost_estimate?.estimated_cost_usd ?? 0,
	isEstimated: agent.cost_estimate?.is_estimated ?? true,
});

/** Sort agents by cost descending, falling back to tool call count. */
const sortAgentRows = (rows: readonly FlatAgent[]): readonly FlatAgent[] => {
	const hasCost = rows.some((r) => r.costUsd > 0);
	return [...rows].sort((a, b) =>
		hasCost ? b.costUsd - a.costUsd : b.toolCalls - a.toolCalls,
	);
};

// ── Component ────────────────────────────────────────────────────────

export const AgentWorkloadTable: Component<AgentWorkloadTableProps> = (props) => {
	const rows = createMemo(() => {
		const allAgents = flattenAgents(props.session.agents ?? []);
		return sortAgentRows(allAgents.map(toFlatAgent));
	});

	const totalCost = createMemo(() =>
		rows().reduce((sum, r) => sum + r.costUsd, 0),
	);

	return (
		<div class="animate-fade-in rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
			{/* Header */}
			<div class="flex items-center gap-3 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
				<Users class="h-4 w-4 text-gray-400" />
				<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
					Agent Workload
				</h3>
				<span class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
					{rows().length} agents
				</span>
			</div>

			{/* Table */}
			<div class="overflow-x-auto">
				<table class="w-full text-xs">
					<thead>
						<tr class="border-b border-gray-200 text-left text-gray-500 dark:border-gray-800 dark:text-gray-400">
							<th class="px-3 py-1.5 font-medium">Agent</th>
							<th class="px-2 py-1.5 font-medium text-right">Tool Calls</th>
							<th class="px-2 py-1.5 font-medium text-right">Duration</th>
							<th class="px-2 py-1.5 font-medium text-right">Files</th>
							<th class="px-2 py-1.5 font-medium text-right">Cost</th>
						</tr>
					</thead>
					<tbody>
						<For each={rows()}>
							{(row) => (
								<tr class="border-b border-gray-100 dark:border-gray-800/50">
									<td class="px-3 py-1.5">
										<div class="flex items-center gap-2">
											<span
												class={`rounded px-1 py-0.5 text-[9px] font-medium ${getTypeBadgeClass(row.agentType)}`}
											>
												{row.agentType}
											</span>
											<span class="truncate font-medium text-gray-700 dark:text-gray-300">
												{row.name}
											</span>
										</div>
									</td>
									<td class="px-2 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
										{row.toolCalls}
									</td>
									<td class="px-2 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
										{formatDuration(row.durationMs)}
									</td>
									<td class="px-2 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
										{row.filesModified}
									</td>
									<td class="px-2 py-1.5 text-right tabular-nums">
										<Show
											when={row.costUsd > 0}
											fallback={
												<span class="text-gray-400 dark:text-gray-400">--</span>
											}
										>
											<span
												classList={{
													"text-gray-400 dark:text-gray-400": row.isEstimated,
													"text-gray-700 dark:text-gray-300": !row.isEstimated,
												}}
												title={row.isEstimated ? "Estimated" : undefined}
											>
												{formatCost(row.costUsd, row.isEstimated)}
											</span>
											<Show when={totalCost() > 0}>
												<span class="ml-1 text-gray-400 dark:text-gray-400">
													({formatPercentage(row.costUsd, totalCost())})
												</span>
											</Show>
										</Show>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
		</div>
	);
};

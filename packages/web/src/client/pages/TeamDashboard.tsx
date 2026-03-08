import { useParams, useNavigate } from "@solidjs/router";
import { createMemo, For, Show, type Component } from "solid-js";
import { createSessionDetail, globalError, clearError } from "../lib/stores";
import { formatDuration, formatCost, formatRelTime } from "../lib/format";
import { SessionHeader } from "../components/SessionHeader";
import { AgentListPanel } from "../components/AgentListPanel";
import { TimelineBar } from "../components/TimelineBar";
import { CommunicationTimeline } from "../components/CommunicationTimeline";
import { CollapsibleCard } from "../components/CollapsibleCard";
import type { FileDiffAttribution } from "../../shared/types";
import { flattenAgents } from "../lib/agent-utils";

// ── Loading skeleton ────────────────────────────────────────────────

const LoadingSkeleton: Component = () => (
	<div class="flex h-full items-center justify-center">
		<div class="flex flex-col items-center gap-3">
			<div class="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-700" />
			<span class="text-sm text-gray-500">Loading team dashboard...</span>
		</div>
	</div>
);

// ── Error banner ────────────────────────────────────────────────────

const ErrorBanner: Component<{
	readonly message: string;
	readonly onDismiss: () => void;
}> = (props) => (
	<div class="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-400">
		<span>{props.message}</span>
		<button onClick={props.onDismiss} class="ml-4 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300">
			Dismiss
		</button>
	</div>
);

// ── Helpers ──────────────────────────────────────────────────────────

const sumDiffAttribution = (attrs: readonly FileDiffAttribution[]): { readonly additions: number; readonly deletions: number; readonly fileCount: number } => ({
	additions: attrs.reduce((sum, a) => sum + a.total_additions, 0),
	deletions: attrs.reduce((sum, a) => sum + a.total_deletions, 0),
	fileCount: attrs.length,
});

// ── Main component ──────────────────────────────────────────────────

export const TeamDashboard: Component = () => {
	const params = useParams<{ id: string }>();
	const navigate = useNavigate();

	const sessionId = () => params.id;
	const [sessionDetail] = createSessionDetail(sessionId);

	const session = createMemo(() => {
		const detail = sessionDetail();
		if (detail?.status === "ready") return detail.data;
		return undefined;
	});

	const agents = createMemo(() => session()?.agents ?? []);
	const startTime = () => session()?.start_time ?? 0;

	const diffTotals = createMemo(() =>
		sumDiffAttribution(session()?.edit_chains?.diff_attribution ?? []),
	);

	const allAgents = createMemo(() => flattenAgents(agents()));

	const totalCost = createMemo(() =>
		allAgents().reduce(
			(sum, a) => sum + (a.cost_estimate?.estimated_cost_usd ?? 0),
			0,
		),
	);

	return (
		<div class="flex h-[calc(100vh-49px)] flex-col">
			{/* Error banner */}
			<Show when={globalError()}>
				{(err) => (
					<ErrorBanner message={err().message} onDismiss={clearError} />
				)}
			</Show>

			{/* Back button */}
			<div class="flex items-center gap-2 border-b border-gray-200 px-4 py-1.5 dark:border-gray-800">
				<button
					onClick={() => navigate(`/session/${params.id}`)}
					class="rounded px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
				>
					&larr; Session
				</button>
				<span class="text-xs text-gray-400 dark:text-gray-600">
					{params.id.slice(0, 12)} / Team
				</span>
			</div>

			{/* Main content */}
			<Show when={!sessionDetail.loading} fallback={<LoadingSkeleton />}>
				<Show when={session()}>
					{(s) => (
						<div class="flex flex-1 overflow-hidden">
							{/* Left panel (40%) — Agent list */}
							<div class="w-2/5 flex-shrink-0 overflow-y-auto border-r border-gray-200 dark:border-gray-800">
								<AgentListPanel
									agents={agents()}
									sessionId={params.id}
									mode="full"
								/>
							</div>

							{/* Right panel (60%) — Collapsible sections */}
							<div class="flex-1 overflow-y-auto p-4 space-y-3">
								{/* Session Header */}
								<SessionHeader session={s()} />

								{/* Tasks */}
								<Show when={(s().team_metrics?.tasks.length ?? 0) > 0}>
									<CollapsibleCard title="Tasks">
										<div class="divide-y divide-gray-100 dark:divide-gray-800/50">
											<For each={[...(s().team_metrics?.tasks ?? [])].sort((a, b) => Number(a.task_id) - Number(b.task_id))}>
												{(task) => (
													<div class="flex items-center gap-3 px-4 py-2 text-xs">
														<span class="text-[10px] text-gray-400 tabular-nums w-14 shrink-0 dark:text-gray-600">
															{formatRelTime(task.t, startTime())}
														</span>
														<span class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 shrink-0 dark:bg-gray-800 dark:text-gray-400">
															{task.task_id}
														</span>
														<span class="truncate font-medium text-gray-700 flex-1 dark:text-gray-300">
															{task.subject ?? task.task_id}
														</span>
														<Show when={task.status === "completed"}>
															<span class="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 shrink-0 dark:bg-emerald-900/50 dark:text-emerald-400">
																done
															</span>
														</Show>
														<Show when={task.agent && task.agent.length < 30}>
															<span class="truncate text-gray-500 max-w-32 dark:text-gray-500">
																{task.agent}
															</span>
														</Show>
													</div>
												)}
											</For>
										</div>
									</CollapsibleCard>
								</Show>

								{/* Phases */}
								<Show when={(s().summary?.phases.length ?? 0) > 0}>
									<CollapsibleCard title="Phases">
										<div class="p-4">
											<TimelineBar
												phases={s().summary?.phases ?? []}
												totalDuration={s().stats.duration_ms}
											/>
											<div class="mt-3 divide-y divide-gray-100 dark:divide-gray-800/50">
												<For each={s().summary?.phases ?? []}>
													{(phase) => (
														<div class="py-2 text-xs">
															<div class="flex items-center gap-2">
																<span class="font-medium text-gray-700 dark:text-gray-300">
																	{phase.name}
																</span>
																<span class="text-gray-400 dark:text-gray-600">
																	{formatDuration(phase.end_t - phase.start_t)}
																</span>
															</div>
															<Show when={phase.description}>
																{(desc) => (
																	<p class="mt-0.5 text-gray-500 dark:text-gray-400">{desc()}</p>
																)}
															</Show>
														</div>
													)}
												</For>
											</div>
										</div>
									</CollapsibleCard>
								</Show>

								{/* Communication */}
								<Show when={(s().comm_sequence?.length ?? 0) > 0}>
									<CollapsibleCard title="Communication">
										<div class="p-2">
											<CommunicationTimeline
												sequence={s().comm_sequence ?? []}
												lifetimes={s().agent_lifetimes ?? []}
												sessionStartTime={startTime()}
											/>
										</div>
									</CollapsibleCard>
								</Show>

								{/* Overall Diff Stats */}
								<Show when={diffTotals().fileCount > 0}>
									<CollapsibleCard title="Diff Stats">
										<div class="flex items-center gap-6 px-4 py-3 text-sm">
											<span class="text-gray-500 dark:text-gray-400">
												<span class="font-medium text-gray-700 dark:text-gray-300">{diffTotals().fileCount}</span> files
											</span>
											<span class="text-emerald-600 dark:text-emerald-400">
												+{diffTotals().additions}
											</span>
											<span class="text-red-500 dark:text-red-400">
												-{diffTotals().deletions}
											</span>
										</div>
									</CollapsibleCard>
								</Show>

								{/* Time breakdown */}
								<CollapsibleCard title="Time" defaultOpen={false}>
									<div class="px-4 py-3 space-y-2">
										<div class="flex items-center justify-between text-xs">
											<span class="text-gray-500 dark:text-gray-400">Total duration</span>
											<span class="font-medium text-gray-700 dark:text-gray-300">
												{formatDuration(s().stats.duration_ms)}
											</span>
										</div>
										<Show when={s().summary?.key_metrics.active_duration_ms}>
											{(activeMs) => (
												<div class="flex items-center justify-between text-xs">
													<span class="text-gray-500 dark:text-gray-400">Active duration</span>
													<span class="font-medium text-gray-700 dark:text-gray-300">
														{formatDuration(activeMs())}
													</span>
												</div>
											)}
										</Show>
										<Show when={(s().summary?.agent_workload?.length ?? 0) > 0}>
											<div class="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800/50">
												<div class="text-[10px] font-semibold uppercase text-gray-400 mb-1">Per agent</div>
												<For each={s().summary?.agent_workload ?? []}>
													{(aw) => (
														<div class="flex items-center justify-between text-xs py-0.5">
															<span class="truncate text-gray-600 dark:text-gray-400">{aw.name}</span>
															<span class="text-gray-700 tabular-nums dark:text-gray-300">
																{formatDuration(aw.duration_ms)}
															</span>
														</div>
													)}
												</For>
											</div>
										</Show>
									</div>
								</CollapsibleCard>

								{/* Cost breakdown */}
								<CollapsibleCard title="Cost" defaultOpen={false}>
									<div class="px-4 py-3 space-y-2">
										<div class="flex items-center justify-between text-xs">
											<span class="text-gray-500 dark:text-gray-400">Total cost</span>
											<span class="font-medium text-gray-700 dark:text-gray-300">
												{formatCost(s().cost_estimate?.estimated_cost_usd ?? totalCost())}
											</span>
										</div>
										<Show when={allAgents().length > 0}>
											<div class="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800/50">
												<div class="text-[10px] font-semibold uppercase text-gray-400 mb-1">Per agent</div>
												<For each={allAgents().filter((a) => a.cost_estimate)}>
													{(agent) => (
														<div class="flex items-center justify-between text-xs py-0.5">
															<span class="truncate text-gray-600 dark:text-gray-400">
																{agent.agent_name || agent.agent_type}
															</span>
															<span class="text-gray-700 tabular-nums dark:text-gray-300">
																{formatCost(agent.cost_estimate?.estimated_cost_usd ?? 0)}
															</span>
														</div>
													)}
												</For>
											</div>
										</Show>
									</div>
								</CollapsibleCard>
							</div>
						</div>
					)}
				</Show>
			</Show>
		</div>
	);
};

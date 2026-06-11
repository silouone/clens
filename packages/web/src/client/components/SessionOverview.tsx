import { createMemo, createSignal, Show, type Component } from "solid-js";
import { A } from "@solidjs/router";
import { ExternalLink } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";
import { formatDuration, formatPercentage, formatCost, truncateMultiline } from "../lib/format";
import { renderMarkdown } from "../lib/markdown";
import { Card } from "./ui/Card";
import { MetaRow } from "./ui/MetaRow";
import { CostDrilldown } from "./CostDrilldown";
import { TimelineBar } from "./TimelineBar";
import { RelatedSessionBadges } from "./RelatedSessionBadges";

// -- Types ----------------------------------------------------------------

export type RelatedSessionsData = {
	readonly work_unit_id: string;
	readonly spec_path?: string;
	readonly sessions: readonly {
		readonly session_id: string;
		readonly session_name?: string;
		readonly phase: string;
		readonly role: string;
		readonly start_time: number;
	}[];
};

type SessionOverviewProps = {
	readonly session: DistilledSession;
	readonly relatedSessions?: RelatedSessionsData;
	readonly onRedistill?: () => Promise<void>;
};

// -- Pure helpers ---------------------------------------------------------

const stripHtml = (text: string): string => text.replace(/<[^>]+>/g, "");

const findFirstPrompt = (
	messages: DistilledSession["user_messages"],
): string | undefined => {
	const msg = messages.find(
		(m) => !m.message_type || m.message_type === "prompt",
	);
	if (!msg) return undefined;
	const clean = stripHtml(msg.content).trim();
	return clean.length > 0 ? clean : undefined;
};

const formatTokenCount = (tokens: number): string => {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000)}K`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
};

const SECTION_HEADING = "text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5";

// -- Component ------------------------------------------------------------

export const SessionOverview: Component<SessionOverviewProps> = (props) => {
	const session = () => props.session;
	const [expanded, setExpanded] = createSignal(false);
	const [costOpen, setCostOpen] = createSignal(false);

	// -- Request ----------------------------------------------------------
	const rawPrompt = createMemo(() => findFirstPrompt(session().user_messages));
	const truncated = createMemo(() => {
		const text = rawPrompt();
		if (!text) return { text: "", truncated: false };
		return truncateMultiline(text, 3);
	});
	const displayText = () => (expanded() ? rawPrompt() ?? "" : truncated().text);

	// -- Duration ---------------------------------------------------------
	const totalMs = createMemo(() => session().stats.duration_ms);
	const activeMs = createMemo(
		() => session().summary?.key_metrics.active_duration_ms,
	);

	// -- Cost -------------------------------------------------------------
	const cost = createMemo(() => session().cost_estimate?.estimated_cost_usd);
	const costIsEstimated = createMemo(() => session().cost_estimate?.is_estimated);
	const pricingTier = createMemo(() => session().cost_estimate?.pricing_tier);

	// -- Quality ----------------------------------------------------------
	const toolCallCount = createMemo(
		() => session().summary?.key_metrics.tool_calls ?? session().stats.tool_call_count,
	);
	const backtrackCount = createMemo(() => session().backtracks.length);
	const failureRatePct = createMemo(
		() => `${Math.round(session().stats.failure_rate * 100)}%`,
	);

	// -- Context ----------------------------------------------------------
	const ctx = createMemo(() => session().context_consumption);
	const hasContext = createMemo(() => ctx() !== undefined);

	// -- Outcome ----------------------------------------------------------
	const commitCount = createMemo(() => session().git_diff.commits.length);
	const filesModified = createMemo(
		() => session().file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length,
	);
	const workingTreeChanges = createMemo(
		() => session().git_diff.working_tree_changes?.length ?? 0,
	);

	// -- Spec / Related ---------------------------------------------------
	const specPath = createMemo(() => session().plan_drift?.spec_path);
	const phases = createMemo(() => session().summary?.phases ?? []);

	return (
		<Card class="p-4">
			{/* Spec/WorkUnit bar */}
			<Show when={specPath() || props.relatedSessions}>
				<div class="mb-3 flex flex-wrap items-center justify-end gap-2">
					<Show when={specPath()}>
						{(path) => (
							<div class="inline-flex items-center gap-2 rounded-md bg-violet-50 px-3 py-1.5 dark:bg-violet-900/20">
								<span class="text-xs font-medium text-violet-600 dark:text-violet-400">Spec</span>
								<span class="truncate font-mono text-xs text-violet-700 dark:text-violet-300" title={path()}>
									{path()}
								</span>
							</div>
						)}
					</Show>
					<Show when={props.relatedSessions?.work_unit_id}>
						{(wuId) => (
							<A
								href={`/work-unit/${wuId()}`}
								class="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-600 transition hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-400 dark:hover:bg-violet-900/30"
							>
								View Work Unit
								<ExternalLink class="h-2.5 w-2.5" />
							</A>
						)}
					</Show>
					<Show when={props.relatedSessions}>
						{(related) => (
							<RelatedSessionBadges
								currentSessionId={session().session_id}
								relatedSessions={related().sessions}
								specPath={related().spec_path}
							/>
						)}
					</Show>
				</div>
			</Show>

			{/* Request section */}
			<div class="mb-3">
				<h4 class={SECTION_HEADING}>Request</h4>
				<Show
					when={rawPrompt()}
					fallback={
						<p class="text-sm text-gray-400 italic text-muted">
							No prompt captured
						</p>
					}
				>
					<div
						class="prose-sm-dark text-sm text-secondary"
						innerHTML={renderMarkdown(displayText())}
					/>
					<Show when={truncated().truncated}>
						<button
							onClick={() => setExpanded((prev) => !prev)}
							class="text-xs font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
						>
							{expanded() ? "Show less" : "Show more"}
						</button>
					</Show>
				</Show>
			</div>

			{/* KPI Grid - Row 1 */}
			<div class="grid grid-cols-1 md:grid-cols-3">
				{/* Duration */}
				<div class="px-3 py-2 md:border-r border-clens">
					<h4 class={SECTION_HEADING}>Duration</h4>
					<div class="space-y-1">
						<MetaRow label="Duration" value={formatDuration(totalMs())} />
						<Show when={activeMs() !== undefined}>
							<MetaRow
								label="Active"
								value={`${formatDuration(activeMs() ?? 0)} (${formatPercentage(activeMs() ?? 0, totalMs())})`}
							/>
						</Show>
					</div>
				</div>

				{/* Cost */}
				<div class="px-3 py-2 md:border-r border-clens">
					<h4 class={SECTION_HEADING}>Cost</h4>
					<div class="space-y-1">
						<Show when={cost() !== undefined}>
							<div class="relative">
								<button onClick={() => setCostOpen((prev) => !prev)} class="cursor-pointer text-left w-full">
									<MetaRow label="Cost" value={formatCost(cost() ?? 0, costIsEstimated())} />
								</button>
								<CostDrilldown session={props.session} open={costOpen()} onClose={() => setCostOpen(false)} />
							</div>
						</Show>
						<MetaRow label="Model" value={session().stats.model ?? "unknown"} />
						<Show when={pricingTier()}>
							{(tier) => <MetaRow label="Tier" value={tier()} />}
						</Show>
					</div>
				</div>

				{/* Quality */}
				<div class="px-3 py-2">
					<h4 class={SECTION_HEADING}>Quality</h4>
					<div class="space-y-1">
						<MetaRow label="Tool calls" value={toolCallCount()} />
						<MetaRow label="Backtracks" value={backtrackCount()} />
						<MetaRow label="Failure rate" value={failureRatePct()} />
						<Show when={Object.keys(session().stats.failures_by_tool ?? {}).length > 0}>
							<MetaRow
								label="Failing tools"
								value={Object.entries(session().stats.failures_by_tool ?? {})
									.sort(([, a], [, b]) => (b as number) - (a as number))
									.map(([tool, count]) => `${tool} (${count})`)
									.join(", ")}
							/>
						</Show>
					</div>
				</div>
			</div>

			{/* KPI Grid - Row 2 */}
			<div class={`grid grid-cols-1 border-t border-clens ${hasContext() ? "md:grid-cols-2" : ""}`}>
				{/* Context (conditional) */}
				<Show when={ctx()}>
					{(consumption) => (
						<div class="px-3 py-2 md:border-r border-clens">
							<h4 class={SECTION_HEADING}>Context</h4>
							<div class="space-y-1">
								<MetaRow label="Peak" value={`${Math.round(consumption().peak_context_pct)}%`} />
								<Show when={consumption().compaction_count > 0}>
									<MetaRow label="Compactions" value={consumption().compaction_count} />
								</Show>
								<Show when={consumption().context_velocity_per_min > 0}>
									<MetaRow label="Velocity" value={`${consumption().context_velocity_per_min.toFixed(1)}%/min`} />
								</Show>
								<MetaRow label="Window" value={formatTokenCount(consumption().model_context_window)} />
							</div>
						</div>
					)}
				</Show>

				{/* Outcome */}
				<div class="px-3 py-2">
					<h4 class={SECTION_HEADING}>Outcome</h4>
					<div class="space-y-1">
						<MetaRow label="Commits" value={commitCount()} />
						<MetaRow label="Files modified" value={filesModified()} />
						<MetaRow label="Working tree" value={workingTreeChanges()} />
					</div>
				</div>
			</div>

			{/* Phase timeline */}
			<Show when={phases().length > 0}>
				<div class="border-t border-clens mt-3 pt-3">
					<TimelineBar
						phases={phases()}
						totalDuration={totalMs()}
					/>
				</div>
			</Show>
		</Card>
	);
};

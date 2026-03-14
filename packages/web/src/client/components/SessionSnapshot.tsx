import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { A } from "@solidjs/router";
import { ExternalLink } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";
import { formatDuration, formatPercentage, truncateMultiline } from "../lib/format";
import { StatusBadge } from "./ui/StatusBadge";
import { MetaRow } from "./ui/MetaRow";
import { RelatedSessionBadges } from "./RelatedSessionBadges";

// ── Types ────────────────────────────────────────────────────────────

type RelatedSessionsData = {
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

type SessionSnapshotProps = {
	readonly session: DistilledSession;
	readonly relatedSessions?: RelatedSessionsData;
};

// ── Pure helpers ─────────────────────────────────────────────────────

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

// ── Component ────────────────────────────────────────────────────────

export const SessionSnapshot: Component<SessionSnapshotProps> = (props) => {
	const session = () => props.session;
	const [expanded, setExpanded] = createSignal(false);

	// ── Request column ───────────────────────────────────────────────
	const rawPrompt = createMemo(() => findFirstPrompt(session().user_messages));
	const truncated = createMemo(() => {
		const text = rawPrompt();
		if (!text) return { text: "", truncated: false };
		return truncateMultiline(text, 3);
	});
	const displayText = () => (expanded() ? rawPrompt() ?? "" : truncated().text);

	// ── Outcome column ───────────────────────────────────────────────
	const commitCount = createMemo(() => session().git_diff.commits.length);
	const filesModified = createMemo(
		() => session().file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length,
	);
	const workingTreeChanges = createMemo(
		() => session().git_diff.working_tree_changes?.length ?? 0,
	);

	// ── Facts column ────────────────────────────────────────────────
	const backtrackCount = createMemo(() => session().backtracks.length);
	const failureRatePct = createMemo(
		() => `${Math.round(session().stats.failure_rate * 100)}%`,
	);
	const toolCallCount = createMemo(
		() => session().summary?.key_metrics.tool_calls ?? session().stats.tool_call_count,
	);

	// ── Active time (bottom row) ─────────────────────────────────────
	const activeMs = createMemo(
		() => session().summary?.key_metrics.active_duration_ms,
	);
	const totalMs = createMemo(() => session().stats.duration_ms);

	// ── Spec path ────────────────────────────────────────────────────
	const specPath = createMemo(() => session().plan_drift?.spec_path);

	return (
		<div class="animate-fade-in rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
			{/* Spec path banner (if plan_drift exists) */}
			<Show when={specPath()}>
				{(path) => (
					<div class="mb-3">
						<div class="flex items-center gap-2 rounded-md bg-violet-50 px-3 py-1.5 dark:bg-violet-900/20">
							<span class="text-xs font-medium text-violet-600 dark:text-violet-400">Spec</span>
							<span class="flex-1 truncate font-mono text-xs text-violet-700 dark:text-violet-300" title={path()}>
								{path()}
							</span>
							<Show when={props.relatedSessions?.work_unit_id}>
								{(wuId) => (
									<A
										href={`/work-unit/${wuId()}`}
										class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-600 transition hover:bg-violet-100 dark:text-violet-400 dark:hover:bg-violet-800/30"
									>
										View Work Unit
										<ExternalLink class="h-2.5 w-2.5" />
									</A>
								)}
							</Show>
						</div>
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
				)}
			</Show>
			{/* Related sessions badges when no spec path but work unit exists */}
			<Show when={!specPath() && props.relatedSessions}>
				{(related) => (
					<div class="mb-3">
						<Show when={related().work_unit_id}>
							{(wuId) => (
								<div class="mb-2 flex items-center gap-2">
									<A
										href={`/work-unit/${wuId()}`}
										class="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-400 dark:hover:bg-violet-900/30"
									>
										View Work Unit
										<ExternalLink class="h-3 w-3" />
									</A>
								</div>
							)}
						</Show>
						<RelatedSessionBadges
							currentSessionId={session().session_id}
							relatedSessions={related().sessions}
						/>
					</div>
				)}
			</Show>

			{/* 3-column grid */}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				{/* Left: Request */}
				<div class="space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-400">
						Request
					</h3>
					<Show
						when={rawPrompt()}
						fallback={
							<p class="text-sm text-gray-400 italic dark:text-gray-400">
								No prompt captured
							</p>
						}
					>
						<p class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
							{displayText()}
						</p>
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

				{/* Center: Outcome */}
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-400">
							Outcome
						</h3>
						<StatusBadge complete={session().complete} />
					</div>
					<div class="space-y-1">
						<MetaRow label="Commits" value={commitCount()} />
						<MetaRow label="Files modified" value={filesModified()} />
						<MetaRow
							label="Working tree changes"
							value={workingTreeChanges()}
						/>
					</div>
				</div>

				{/* Right: Session Facts (raw data, no judgment) */}
				<div class="space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-400">
						Session Facts
					</h3>
					<div class="space-y-1">
						<MetaRow label="Tool calls" value={toolCallCount()} />
						<MetaRow label="Backtracks" value={backtrackCount()} />
						<MetaRow label="Failure rate" value={failureRatePct()} />
						<Show when={Object.keys(session().stats.failures_by_tool ?? {}).length > 0}>
							<div class="mt-1 flex flex-wrap gap-1">
								<For each={Object.entries(session().stats.failures_by_tool ?? {})}>
									{([tool, count]) => (
										<span class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
											{tool} x{count}
										</span>
									)}
								</For>
							</div>
						</Show>
					</div>
				</div>
			</div>

			{/* Bottom row: Active time */}
			<Show when={activeMs() !== undefined}>
				<div class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
					<p class="text-xs text-text-muted">
						Active:{" "}
						<span class="font-medium text-gray-700 dark:text-gray-300">
							{formatDuration(activeMs() ?? 0)}
						</span>
						{" / "}
						<span class="font-medium text-gray-700 dark:text-gray-300">
							{formatDuration(totalMs())}
						</span>
						{" "}
						<span class="text-gray-400 dark:text-gray-400">
							({formatPercentage(activeMs() ?? 0, totalMs())})
						</span>
					</p>
				</div>
			</Show>
		</div>
	);
};

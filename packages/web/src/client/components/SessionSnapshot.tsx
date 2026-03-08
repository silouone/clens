import { createMemo, createSignal, Show, type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { formatDuration, formatPercentage, truncateMultiline } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

// ── Types ────────────────────────────────────────────────────────────

type SessionSnapshotProps = {
	readonly session: DistilledSession;
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

// ── Stat row ─────────────────────────────────────────────────────────

const StatRow: Component<{
	readonly label: string;
	readonly value: string | number;
}> = (props) => (
	<div class="flex items-center justify-between text-xs">
		<span class="text-gray-500 dark:text-gray-400">{props.label}</span>
		<span class="font-medium tabular-nums text-gray-700 dark:text-gray-300">
			{props.value}
		</span>
	</div>
);

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
		() => session().file_map.files.filter((f) => f.edits > 0).length,
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
		<div class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/50">
			{/* Spec path banner (if plan_drift exists) */}
			<Show when={specPath()}>
				{(path) => (
					<div class="mb-3 flex items-center gap-2 rounded-md bg-violet-50 px-3 py-1.5 dark:bg-violet-900/20">
						<span class="text-xs font-medium text-violet-600 dark:text-violet-400">Spec</span>
						<span class="truncate font-mono text-xs text-violet-700 dark:text-violet-300" title={path()}>
							{path()}
						</span>
					</div>
				)}
			</Show>

			{/* 3-column grid */}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				{/* Left: Request */}
				<div class="space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
						Request
					</h3>
					<Show
						when={rawPrompt()}
						fallback={
							<p class="text-sm text-gray-400 italic dark:text-gray-600">
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
						<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
							Outcome
						</h3>
						<StatusBadge complete={session().complete} />
					</div>
					<div class="space-y-1">
						<StatRow label="Commits" value={commitCount()} />
						<StatRow label="Files modified" value={filesModified()} />
						<StatRow
							label="Working tree changes"
							value={workingTreeChanges()}
						/>
					</div>
				</div>

				{/* Right: Session Facts (raw data, no judgment) */}
				<div class="space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
						Session Facts
					</h3>
					<div class="space-y-1">
						<StatRow label="Tool calls" value={toolCallCount()} />
						<StatRow label="Backtracks" value={backtrackCount()} />
						<StatRow label="Failure rate" value={failureRatePct()} />
					</div>
				</div>
			</div>

			{/* Bottom row: Active time */}
			<Show when={activeMs() !== undefined}>
				<div class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Active:{" "}
						<span class="font-medium text-gray-700 dark:text-gray-300">
							{formatDuration(activeMs() ?? 0)}
						</span>
						{" / "}
						<span class="font-medium text-gray-700 dark:text-gray-300">
							{formatDuration(totalMs())}
						</span>
						{" "}
						<span class="text-gray-400 dark:text-gray-500">
							({formatPercentage(activeMs() ?? 0, totalMs())})
						</span>
					</p>
				</div>
			</Show>
		</div>
	);
};

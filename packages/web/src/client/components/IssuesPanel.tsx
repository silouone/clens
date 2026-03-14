import { For, Show, createMemo, type Component } from "solid-js";
import { AlertTriangle } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";
import { classifySeverity } from "../lib/format";
import { getBacktrackBadgeClass } from "../lib/severity";

// ── Types ────────────────────────────────────────────────────────────

type IssuesPanelProps = {
	readonly session: DistilledSession;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const truncate = (text: string, maxLen: number): string =>
	text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}...`;

const formatBacktrackType = (type: string): string =>
	type.replace(/_/g, " ");

// ── Component ────────────────────────────────────────────────────────

export const IssuesPanel: Component<IssuesPanelProps> = (props) => {
	const backtracks = () => props.session.backtracks;
	const topErrors = () => props.session.summary?.top_errors ?? [];
	const backtrackCount = () => backtracks().length;

	const severity = createMemo(() => classifySeverity(backtrackCount()));

	const hasContent = createMemo(
		() => backtrackCount() > 0 || topErrors().length > 0,
	);

	return (
		<div class="animate-fade-in rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
			<div class="flex items-center gap-2">
				<AlertTriangle class="h-4 w-4 text-red-500" />
				<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
					Issues &amp; Errors
				</h3>
			</div>

			<Show
				when={hasContent()}
				fallback={
					<div class="mt-3 flex items-center gap-2">
						<span class="inline-block h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
						<span class="text-xs font-medium text-emerald-600 dark:text-emerald-400">
							Clean session — no backtracks or errors
						</span>
					</div>
				}
			>
				{/* Backtracks section */}
				<div class="mt-3">
					<div class="flex items-center gap-2">
						<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
							Backtracks ({backtrackCount()})
						</span>
						<span class={`text-xs font-medium ${severity().color}`}>
							{severity().label}
						</span>
					</div>

					<Show
						when={backtrackCount() > 0}
						fallback={
							<p class="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
								No backtracks — clean session
							</p>
						}
					>
						<div class="mt-2 space-y-1.5">
							<For each={backtracks()}>
								{(bt) => (
									<div class="flex items-start gap-2 text-xs">
										<span
											class={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getBacktrackBadgeClass(bt.type)}`}
										>
											{formatBacktrackType(bt.type)}
										</span>
										<span class="font-mono text-gray-600 dark:text-gray-400">
											{bt.tool_name}
										</span>
										<Show when={bt.error_message}>
											{(msg) => (
												<span class="truncate text-gray-400 dark:text-gray-400">
													{truncate(msg(), 80)}
												</span>
											)}
										</Show>
									</div>
								)}
							</For>
						</div>
					</Show>
				</div>

				{/* Top Errors section */}
				<Show when={topErrors().length > 0}>
					<div class="mt-4">
						<span class="text-xs font-medium text-gray-600 dark:text-gray-400">
							Top Errors
						</span>
						<div class="mt-2 space-y-1.5">
							<For each={topErrors()}>
								{(err) => (
									<div class="flex items-start gap-2 text-xs">
										<span class="font-mono text-gray-600 dark:text-gray-400">
											{err.tool_name}
										</span>
										<span class="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-400">
											{err.count}
										</span>
										<Show when={err.sample_message}>
											{(msg) => (
												<span class="truncate text-gray-400 dark:text-gray-400">
													{truncate(msg(), 100)}
												</span>
											)}
										</Show>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>
			</Show>
		</div>
	);
};

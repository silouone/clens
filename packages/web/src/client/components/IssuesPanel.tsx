import { For, Show, createMemo, type Component } from "solid-js";
import { AlertTriangle } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";
import { classifySeverity } from "../lib/format";
import { getBacktrackBadgeClass } from "../lib/severity";
import { Card } from "./ui/Card";

// ── Types ────────────────────────────────────────────────────────────

type IssuesPanelProps = {
	readonly session: DistilledSession;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const truncate = (text: string, maxLen: number): string =>
	text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}...`;

const formatBacktrackType = (type: string): string =>
	type.replace(/_/g, " ");

// ── Backtrack grouping ──────────────────────────────────────────────

type GroupedBacktrack = {
	readonly type: string;
	readonly tool_name: string;
	readonly error_message?: string;
	readonly count: number;
};

const groupBacktracks = (
	backtracks: readonly { readonly type: string; readonly tool_name: string; readonly error_message?: string }[],
): readonly GroupedBacktrack[] => {
	const grouped = backtracks.reduce<ReadonlyMap<string, GroupedBacktrack>>(
		(acc, bt) => {
			const key = `${bt.type}::${bt.tool_name}`;
			const existing = acc.get(key);
			return new Map([
				...acc,
				[key, existing
					? { ...existing, count: existing.count + 1 }
					: { type: bt.type, tool_name: bt.tool_name, error_message: bt.error_message, count: 1 }],
			]);
		},
		new Map(),
	);
	return [...grouped.values()].sort((a, b) => b.count - a.count);
};

// ── Component ────────────────────────────────────────────────────────

export const IssuesPanel: Component<IssuesPanelProps> = (props) => {
	const backtracks = () => props.session.backtracks;
	const grouped = createMemo(() => groupBacktracks(backtracks()));
	const topErrors = () => props.session.summary?.top_errors ?? [];
	const backtrackCount = () => backtracks().length;

	const severity = createMemo(() => classifySeverity(backtrackCount()));

	const hasContent = createMemo(
		() => backtrackCount() > 0 || topErrors().length > 0,
	);

	return (
		<Card class="p-3">
			<div class="flex items-center gap-2">
				<AlertTriangle class="h-4 w-4 text-muted" />
				<h3 class="instrument-microcaps text-[11px] text-muted">
					Issues &amp; Errors
				</h3>
			</div>

			<Show
				when={hasContent()}
				fallback={
					<div class="mt-3 flex items-center gap-2">
						<span class="instrument-led instrument-led--live bg-[var(--clens-success)]" />
						<span class="text-xs font-medium text-[var(--clens-success)]">
							Clean session — no backtracks or errors
						</span>
					</div>
				}
			>
				{/* Backtracks section */}
				<div class="mt-3">
					<div class="flex items-center gap-2">
						<span class="instrument-microcaps text-[10px] text-muted">
							Backtracks ({backtrackCount()})
						</span>
						<span class={`text-xs font-medium ${severity().color}`}>
							{severity().label}
						</span>
					</div>

					<Show
						when={backtrackCount() > 0}
						fallback={
							<p class="mt-1.5 text-xs text-[var(--clens-success)]">
								No backtracks — clean session
							</p>
						}
					>
						<div class="mt-2 space-y-1.5">
							<For each={grouped()}>
								{(group) => (
									<div class="flex items-start gap-2 text-xs">
										<Show when={group.count > 1}>
											<span class="rounded-none border border-clens bg-surface-inset px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-muted">
												{group.count}x
											</span>
										</Show>
										<span
											class={`inline-flex shrink-0 items-center rounded-none px-1.5 py-0.5 text-[10px] font-medium ${getBacktrackBadgeClass(group.type)}`}
										>
											{formatBacktrackType(group.type)}
										</span>
										<span class="font-mono text-muted">
											{group.tool_name}
										</span>
										<Show when={group.error_message}>
											{(msg) => (
												<span class="truncate text-muted">
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
						<span class="instrument-microcaps text-[10px] text-muted">
							Top Errors
						</span>
						<div class="mt-2 space-y-1.5">
							<For each={topErrors()}>
								{(err) => (
									<div class="flex items-start gap-2 text-xs">
										<span class="font-mono text-muted">
											{err.tool_name}
										</span>
										<span class="rounded-none border border-clens bg-surface-inset px-1.5 py-0.5 text-xs font-mono tabular-nums text-muted">
											{err.count}
										</span>
										<Show when={err.sample_message}>
											{(msg) => (
												<span class="truncate text-muted">
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
		</Card>
	);
};

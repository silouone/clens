import { Clock, GitBranch, Layers, Users } from "lucide-solid";
import { type Component, For, Show } from "solid-js";
import type { DecisionPoint } from "../../shared/types";
import { Card } from "./ui/Card";

// ── Types ────────────────────────────────────────────────────────────

type DecisionsSectionProps = {
	readonly decisions: readonly DecisionPoint[];
};

// ── Pure helpers ─────────────────────────────────────────────────────

const formatMs = (ms: number): string => {
	if (ms < 1_000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
	if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
	return `${(ms / 3_600_000).toFixed(1)}h`;
};

const gapClassificationColor = (
	classification: "user_idle" | "session_pause" | "agent_thinking",
): string => {
	const colors: Readonly<Record<string, string>> = {
		user_idle: "text-muted",
		session_pause: "text-[var(--clens-warning)]",
		agent_thinking: "text-brand-500",
	};
	return colors[classification] ?? "text-muted";
};

const formatClassification = (c: string): string => c.replace(/_/g, " ");

const isDecisionType =
	<T extends DecisionPoint["type"]>(type: T) =>
	(d: DecisionPoint): d is Extract<DecisionPoint, { readonly type: T }> =>
		d.type === type;

// ── Component ────────────────────────────────────────────────────────

export const DecisionsSection: Component<DecisionsSectionProps> = (props) => {
	const toolPivots = () => props.decisions.filter(isDecisionType("tool_pivot"));
	const timingGaps = () => props.decisions.filter(isDecisionType("timing_gap"));
	const taskDelegations = () => props.decisions.filter(isDecisionType("task_delegation"));
	const phaseBoundaries = () => props.decisions.filter(isDecisionType("phase_boundary"));

	return (
		<Card class="p-3">
			<div class="flex items-center gap-2">
				<GitBranch class="h-3.5 w-3.5 text-muted" />
				<h3 class="instrument-microcaps text-[11px] text-muted">Decision Points</h3>
				<span class="rounded-none border border-clens bg-surface-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted">
					{props.decisions.length}
				</span>
			</div>

			<div class="mt-3 space-y-3">
				{/* Tool Pivots */}
				<Show when={toolPivots().length > 0}>
					<div>
						<div class="instrument-microcaps flex items-center gap-1.5 text-[10px] text-muted">
							<GitBranch class="h-3 w-3" />
							Changed approach ({toolPivots().length})
						</div>
						<div class="mt-1.5 space-y-1">
							<For each={toolPivots()}>
								{(d) => (
									<div class="flex items-center gap-2 text-xs">
										<span class="font-mono text-muted">{d.from_tool}</span>
										<span class="text-muted">&rarr;</span>
										<span class="font-mono text-secondary">{d.to_tool}</span>
										<Show when={d.after_failure}>
											<span class="instrument-microcaps inline-flex items-center gap-1 rounded-none border border-clens bg-surface-raised px-1.5 py-0.5 text-[10px] text-[var(--clens-danger)]">
												<span class="instrument-led bg-[var(--clens-danger)]" />
												after failure
											</span>
										</Show>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

				{/* Timing Gaps */}
				<Show when={timingGaps().length > 0}>
					<div>
						<div class="instrument-microcaps flex items-center gap-1.5 text-[10px] text-muted">
							<Clock class="h-3 w-3" />
							Timing gaps ({timingGaps().length})
						</div>
						<div class="mt-1.5 space-y-1">
							<For each={timingGaps()}>
								{(d) => (
									<div class="flex items-center gap-2 text-xs">
										<span class="tabular-nums font-medium text-secondary">
											{formatMs(d.gap_ms)}
										</span>
										<span class={`text-xs ${gapClassificationColor(d.classification)}`}>
											{formatClassification(d.classification)}
										</span>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

				{/* Task Delegations */}
				<Show when={taskDelegations().length > 0}>
					<div>
						<div class="instrument-microcaps flex items-center gap-1.5 text-[10px] text-muted">
							<Users class="h-3 w-3" />
							Task delegations ({taskDelegations().length})
						</div>
						<div class="mt-1.5 space-y-1">
							<For each={taskDelegations()}>
								{(d) => (
									<div class="flex items-center gap-2 text-xs">
										<span class="font-mono text-brand-500">{d.agent_name}</span>
										<Show when={d.subject}>
											<span class="truncate text-muted">{d.subject}</span>
										</Show>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

				{/* Phase Boundaries */}
				<Show when={phaseBoundaries().length > 0}>
					<div>
						<div class="instrument-microcaps flex items-center gap-1.5 text-[10px] text-muted">
							<Layers class="h-3 w-3" />
							Phase boundaries ({phaseBoundaries().length})
						</div>
						<div class="mt-1.5 space-y-1">
							<For each={phaseBoundaries()}>
								{(d) => (
									<div class="flex items-center gap-2 text-xs">
										<span class="instrument-microcaps rounded-none border border-clens bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted">
											Phase {d.phase_index + 1}
										</span>
										<span class="text-secondary">{d.phase_name}</span>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>
			</div>
		</Card>
	);
};

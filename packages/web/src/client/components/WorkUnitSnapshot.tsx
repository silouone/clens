import { createMemo, Show, type Component } from "solid-js";
import type { WorkUnit } from "../../shared/types";
import type { WorkUnitDetailSession } from "../lib/stores";
import { Card } from "./ui/Card";
import { MetaRow } from "./ui/MetaRow";
import { formatDuration, formatCost } from "../lib/format";
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS } from "../lib/work-unit-constants";
import {
	distilledSessions,
	aggregateBacktracks,
	aggregateFileMap,
	aggregateCosts,
	totalToolCalls,
	totalFailures,
} from "../lib/work-unit-utils";

// ── Types ────────────────────────────────────────────────────────────

type WorkUnitSnapshotProps = {
	readonly unit: WorkUnit;
	readonly sessions: readonly WorkUnitDetailSession[];
};

// ── Component ────────────────────────────────────────────────────────

export const WorkUnitSnapshot: Component<WorkUnitSnapshotProps> = (props) => {
	const distilled = createMemo(() => distilledSessions(props.sessions));
	const distilledCount = createMemo(() => distilled().length);
	const backtrackCount = createMemo(() => aggregateBacktracks(distilled()).length);
	const fileCount = createMemo(() => aggregateFileMap(distilled()).filter((f) => f.edits > 0 || f.writes > 0).length);
	const cost = createMemo(() => aggregateCosts(distilled()));
	const toolCalls = createMemo(() => totalToolCalls(distilled()));
	const failures = createMemo(() => totalFailures(distilled()));

	return (
		<Card class="p-3">
			{/* Spec/branch banner */}
			<Show when={props.unit.spec_path}>
				{(path) => (
					<div class="mb-3">
						<div class="flex items-center gap-2 rounded-md bg-violet-50 px-3 py-1.5 dark:bg-violet-900/20">
							<span class="text-xs font-medium text-violet-600 dark:text-violet-400">Spec</span>
							<span class="truncate font-mono text-xs text-violet-700 dark:text-violet-300" title={path()}>
								{path()}
							</span>
						</div>
					</div>
				)}
			</Show>

			{/* 3-column grid */}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				{/* Left: Identity */}
				<div class="space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">
						Work Unit
					</h3>
					<div class="flex items-center gap-2">
						<span class={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${LIFECYCLE_COLORS[props.unit.lifecycle]}`}>
							{LIFECYCLE_LABELS[props.unit.lifecycle]}
						</span>
					</div>
					<div class="space-y-1">
						<MetaRow label="Duration" value={formatDuration(props.unit.total_duration_ms)} />
						<MetaRow label="Sessions" value={`${props.unit.sessions.length} (${distilledCount()} analyzed)`} />
					</div>
				</div>

				{/* Center: Outcome */}
				<div class="space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">
						Outcome
					</h3>
					<div class="space-y-1">
						<MetaRow label="Files modified" value={fileCount()} />
						<MetaRow label="Tool calls" value={toolCalls()} />
						<MetaRow label="Failures" value={failures()} />
					</div>
				</div>

				{/* Right: Facts */}
				<div class="space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">
						Facts
					</h3>
					<div class="space-y-1">
						<MetaRow label="Backtracks" value={backtrackCount()} />
						<Show when={cost()}>
							{(c) => (
								<MetaRow
									label="Total cost"
									value={formatCost(c().estimated_cost_usd, c().is_estimated)}
								/>
							)}
						</Show>
					</div>
				</div>
			</div>
		</Card>
	);
};

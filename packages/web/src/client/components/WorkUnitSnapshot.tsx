import { createMemo, Show, type Component } from "solid-js";
import type { WorkUnit } from "../../shared/types";
import type { WorkUnitDetailSession } from "../lib/stores";
import { Card } from "./ui/Card";
import { MetaRow } from "./ui/MetaRow";
import { formatDuration, formatCost } from "../lib/format";
import { LIFECYCLE_LABELS } from "../lib/work-unit-constants";
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
						<div class="flex items-center gap-2 rounded-none border border-clens bg-surface-inset px-3 py-1.5">
							<span class="instrument-microcaps text-[10px] text-brand-500">Spec</span>
							<span class="truncate font-mono text-xs text-secondary" title={path()}>
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
					<h3 class="instrument-microcaps text-[10px] text-muted">
						Work Unit
					</h3>
					<div class="flex items-center gap-2">
						<span class="instrument-microcaps inline-flex items-center rounded-none border border-clens px-1.5 py-0.5 text-[9px] text-muted">
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
					<h3 class="instrument-microcaps text-[10px] text-muted">
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
					<h3 class="instrument-microcaps text-[10px] text-muted">
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

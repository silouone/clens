import { Show, createSignal, type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { TimelineBar } from "./TimelineBar";
import { StatusBadge } from "./ui/StatusBadge";
import { CostDrilldown } from "./CostDrilldown";
import { StatItem } from "./ui/StatItem";
import { DetailHeader } from "./DetailHeader";
import { formatDuration, formatCost } from "../lib/format";

// ── Types ────────────────────────────────────────────────────────────

type SessionHeaderProps = {
	readonly session: DistilledSession;
	readonly onPhaseClick?: (phaseIndex: number) => void;
	readonly onRedistill?: () => Promise<void>;
};

// ── Component ────────────────────────────────────────────────────────

export const SessionHeader: Component<SessionHeaderProps> = (props) => {
	const session = () => props.session;
	const summary = () => session().summary;
	const phases = () => summary()?.phases ?? [];
	const duration = () => session().stats.duration_ms;
	const model = () => session().stats.model ?? "unknown";
	const cost = () => session().cost_estimate?.estimated_cost_usd;
	const costIsEstimated = () => session().cost_estimate?.is_estimated;
	const [distilling, setDistilling] = createSignal(false);
	const [costOpen, setCostOpen] = createSignal(false);

	return (
		<DetailHeader
			title={session().session_name ?? session().session_id.slice(0, 12)}
			action={
				<Show when={props.onRedistill}>
					<button
						onClick={async () => {
							setDistilling(true);
							try { await props.onRedistill?.(); }
							finally { setDistilling(false); }
						}}
						disabled={distilling()}
						class="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
					>
						{distilling() ? "Re-analyzing..." : "Re-analyze"}
					</button>
				</Show>
			}
		>
			<StatusBadge complete={session().complete} />
			<div class="flex flex-wrap items-center gap-1.5">
				<StatItem variant="pill" label="Duration" value={formatDuration(duration())} />
				<StatItem variant="pill" label="Model" value={model()} />
				<Show when={cost() !== undefined}>
					<div class="relative">
						<button
							onClick={() => setCostOpen((prev) => !prev)}
							class="cursor-pointer rounded-md transition hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600"
						>
							<StatItem variant="pill"
								label="Cost"
								value={formatCost(cost() ?? 0, costIsEstimated())}
								muted={costIsEstimated()}
								title={costIsEstimated() ? "Click for details — estimated cost" : "Click for cost breakdown"}
							/>
						</button>
						<CostDrilldown
							session={props.session}
							open={costOpen()}
							onClose={() => setCostOpen(false)}
						/>
					</div>
				</Show>
				<StatItem variant="pill"
					label="Tools"
					value={String(summary()?.key_metrics.tool_calls ?? session().stats.tool_call_count)}
				/>
				<StatItem variant="pill"
					label="Failures"
					value={String(summary()?.key_metrics.failures ?? session().stats.failure_count)}
				/>
			</div>

			{/* Inline phase timeline */}
			<Show when={phases().length > 0}>
				<div class="hidden md:flex items-center border-l border-gray-200 pl-2 dark:border-gray-700">
					<TimelineBar
						phases={phases()}
						totalDuration={duration()}
						onPhaseClick={props.onPhaseClick}
					/>
				</div>
			</Show>
		</DetailHeader>
	);
};

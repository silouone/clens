import { Show, createSignal, type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { TimelineBar } from "./TimelineBar";
import { StatusBadge } from "./StatusBadge";
import { formatDuration, formatCost } from "../lib/format";

// ── Stat pill ────────────────────────────────────────────────────────

const StatPill: Component<{
	readonly label: string;
	readonly value: string;
	readonly muted?: boolean;
	readonly title?: string;
}> = (props) => (
	<div class="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800/60" title={props.title}>
		<span class="text-gray-500">{props.label}</span>
		<span
			class="font-medium"
			classList={{
				"text-gray-400 dark:text-gray-400": props.muted === true,
				"text-gray-700 dark:text-gray-300": props.muted !== true,
			}}
		>
			{props.value}
		</span>
	</div>
);

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

	return (
		<div class="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
			{/* Single row: name + status + stats + phases + re-distill */}
			<div class="flex flex-wrap items-center gap-2">
				<h2 class="text-sm font-semibold text-gray-900 truncate max-w-md dark:text-gray-100">
					{session().session_name ?? session().session_id.slice(0, 12)}
				</h2>
				<StatusBadge complete={session().complete} />
				<div class="flex flex-wrap items-center gap-1.5">
					<StatPill label="Duration" value={formatDuration(duration())} />
					<StatPill label="Model" value={model()} />
					<Show when={cost() !== undefined}>
						<StatPill
							label="Cost"
							value={formatCost(cost() ?? 0, costIsEstimated())}
							muted={costIsEstimated()}
							title={costIsEstimated() ? "Estimated cost (real token data unavailable)" : undefined}
						/>
					</Show>
					<StatPill
						label="Tools"
						value={String(summary()?.key_metrics.tool_calls ?? session().stats.tool_call_count)}
					/>
					<StatPill
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

				<Show when={props.onRedistill}>
					<div class="ml-auto">
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
					</div>
				</Show>
			</div>
		</div>
	);
};

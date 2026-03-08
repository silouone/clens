import { Show, createSignal, type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { TimelineBar } from "./TimelineBar";
import { formatDuration, formatCost } from "../lib/format";

// ── Status badge ─────────────────────────────────────────────────────

const StatusBadge: Component<{ readonly complete: boolean }> = (props) => {
	const cls = () =>
		props.complete
			? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-400 dark:border-emerald-700/50"
			: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50";

	return (
		<span
			class={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls()}`}
		>
			{props.complete ? "complete" : "in progress"}
		</span>
	);
};

// ── Stat pill ────────────────────────────────────────────────────────

const StatPill: Component<{
	readonly label: string;
	readonly value: string;
}> = (props) => (
	<div class="flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800/60">
		<span class="text-gray-500">{props.label}</span>
		<span class="font-medium text-gray-700 dark:text-gray-300">{props.value}</span>
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
	const [distilling, setDistilling] = createSignal(false);

	// First user prompt as request preview (skip commands, system, teammate messages)
	const requestPreview = () => {
		const msg = session().user_messages.find(
			(m) => !m.message_type || m.message_type === "prompt",
		);
		if (!msg) return undefined;
		const clean = msg.content.replace(/<[^>]+>/g, "").trim();
		return clean.length > 0
			? clean.slice(0, 120) + (clean.length > 120 ? "..." : "")
			: undefined;
	};

	return (
		<div class="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-900/50">
			{/* Top row: name + status + stats + re-distill */}
			<div class="flex flex-wrap items-center gap-3">
				<h2 class="text-lg font-semibold text-gray-900 truncate max-w-md dark:text-gray-100">
					{session().session_name ?? session().session_id.slice(0, 12)}
				</h2>
				<StatusBadge complete={session().complete} />
				<div class="flex flex-wrap items-center gap-2">
					<StatPill label="Duration" value={formatDuration(duration())} />
					<StatPill label="Model" value={model()} />
					<Show when={cost() !== undefined}>
						<StatPill label="Cost" value={formatCost(cost() ?? 0)} />
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
				<Show when={props.onRedistill}>
					<div class="ml-auto">
						<button
							onClick={async () => {
								setDistilling(true);
								try { await props.onRedistill?.(); }
								finally { setDistilling(false); }
							}}
							disabled={distilling()}
							class="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
						>
							{distilling() ? "Re-analyzing..." : "Re-analyze"}
						</button>
					</div>
				</Show>
			</div>

			{/* Request preview */}
			<Show when={requestPreview()}>
				{(text) => (
					<p class="mt-1.5 text-xs text-gray-500 truncate max-w-2xl">
						{text()}
					</p>
				)}
			</Show>

			{/* Timeline bar */}
			<Show when={phases().length > 0}>
				<div class="mt-2">
					<TimelineBar
						phases={phases()}
						totalDuration={duration()}
						onPhaseClick={props.onPhaseClick}
					/>
				</div>
			</Show>
		</div>
	);
};

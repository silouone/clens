import { Show, type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { TimelineBar } from "./TimelineBar";

// ── Formatting helpers ───────────────────────────────────────────────

const formatDuration = (ms: number): string => {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
};

const formatCost = (usd: number): string =>
	usd < 0.01 ? `<$0.01` : `$${usd.toFixed(2)}`;

// ── Status badge ─────────────────────────────────────────────────────

const StatusBadge: Component<{ readonly complete: boolean }> = (props) => {
	const cls = () =>
		props.complete
			? "bg-emerald-900/50 text-emerald-400 border-emerald-700/50"
			: "bg-amber-900/50 text-amber-400 border-amber-700/50";

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
	<div class="flex items-center gap-1.5 rounded-md bg-gray-800/60 px-2.5 py-1 text-xs">
		<span class="text-gray-500">{props.label}</span>
		<span class="font-medium text-gray-300">{props.value}</span>
	</div>
);

// ── Types ────────────────────────────────────────────────────────────

type SessionHeaderProps = {
	readonly session: DistilledSession;
	readonly onPhaseClick?: (phaseIndex: number) => void;
};

// ── Component ────────────────────────────────────────────────────────

export const SessionHeader: Component<SessionHeaderProps> = (props) => {
	const session = () => props.session;
	const summary = () => session().summary;
	const phases = () => summary()?.phases ?? [];
	const duration = () => session().stats.duration_ms;
	const model = () => session().stats.model ?? "unknown";
	const cost = () => session().cost_estimate?.estimated_cost_usd;

	// First user message as request preview
	const requestPreview = () => {
		const msgs = session().user_messages;
		return msgs.length > 0
			? msgs[0].content.slice(0, 120) + (msgs[0].content.length > 120 ? "..." : "")
			: undefined;
	};

	return (
		<div class="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
			{/* Top row: name + status + stats */}
			<div class="flex flex-wrap items-center gap-3">
				<h2 class="text-lg font-semibold text-gray-100 truncate max-w-md">
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

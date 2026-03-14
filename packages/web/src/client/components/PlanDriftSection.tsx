import { For, Show, type Component } from "solid-js";
import { Check, X, PlusCircle, GitBranch } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";

// ── Types ────────────────────────────────────────────────────────────

type PlanDriftSectionProps = {
	readonly session: DistilledSession;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const alignmentScore = (
	expectedCount: number,
	missingCount: number,
): number => {
	if (expectedCount === 0) return 100;
	return Math.round(((expectedCount - missingCount) / expectedCount) * 100);
};

const alignmentColorClass = (score: number): string => {
	if (score > 80) return "text-emerald-500 dark:text-emerald-400";
	if (score >= 50) return "text-amber-500 dark:text-amber-400";
	return "text-red-500 dark:text-red-400";
};

// ── Component ────────────────────────────────────────────────────────

export const PlanDriftSection: Component<PlanDriftSectionProps> = (props) => {
	const drift = () => props.session.plan_drift;
	const alignment = () => {
		const d = drift();
		if (d == null) return 0;
		return alignmentScore(d.expected_files.length, d.missing_files.length);
	};
	const driftPct = () => {
		const d = drift();
		if (d == null) return 0;
		return Math.round(d.drift_score * 100);
	};
	const missingSet = () => new Set(drift()?.missing_files ?? []);

	return (
		<Show when={drift()}>
			{(d) => (
				<div class="animate-fade-in rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
					{/* Header */}
					<div class="mb-3 flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<GitBranch class="h-4 w-4 text-amber-500" />
								<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
									Plan Fidelity
								</h3>
							</div>
							<span class="block truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={d().spec_path}>{d().spec_path}</span>
						</div>
						{/* Scores */}
						<div class="flex shrink-0 items-end gap-4">
							<div class="text-right">
								<div class={`text-2xl font-bold tabular-nums ${alignmentColorClass(alignment())}`}>
									{alignment()}%
								</div>
								<div class="text-xs text-gray-400 dark:text-gray-400">aligned</div>
							</div>
							<div class="text-right">
								<div class="text-2xl font-bold tabular-nums text-gray-500 dark:text-gray-400">
									{driftPct()}%
								</div>
								<div class="text-xs text-gray-400 dark:text-gray-400">drift</div>
							</div>
						</div>
					</div>

					{/* Expected files */}
					<div class="mb-2">
						<div class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
							Expected files ({d().expected_files.length})
						</div>
						<div class="space-y-0.5">
							<For each={d().expected_files}>
								{(file) => {
									const isMissing = () => missingSet().has(file);
									return (
										<div class="flex items-center gap-1.5 min-w-0">
											<Show
												when={isMissing()}
												fallback={
													<Check class="h-3 w-3 shrink-0 text-emerald-500 dark:text-emerald-400" />
												}
											>
												<X class="h-3 w-3 shrink-0 text-red-500 dark:text-red-400" />
											</Show>
											<span
												class={`truncate font-mono text-xs ${
													isMissing()
														? "text-red-500 line-through dark:text-red-400"
														: "text-gray-600 dark:text-gray-300"
												}`}
												title={file}
											>
												{file}
											</span>
										</div>
									);
								}}
							</For>
						</div>
					</div>

					{/* Unexpected files */}
					<Show when={d().unexpected_files.length > 0}>
						<div>
							<div class="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
								Unexpected files ({d().unexpected_files.length})
							</div>
							<div class="space-y-0.5">
								<For each={d().unexpected_files}>
									{(file) => (
										<div class="flex items-center gap-1.5 min-w-0">
											<PlusCircle class="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" />
											<span class="truncate font-mono text-xs text-amber-600 dark:text-amber-400" title={file}>
												{file}
											</span>
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>
				</div>
			)}
		</Show>
	);
};

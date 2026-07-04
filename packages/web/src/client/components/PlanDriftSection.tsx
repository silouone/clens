import { Check, GitBranch, PlusCircle, X } from "lucide-solid";
import { type Component, For, Show } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { Card } from "./ui/Card";

// ── Types ────────────────────────────────────────────────────────────

type PlanDriftSectionProps = {
	readonly session: DistilledSession;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const alignmentScore = (expectedCount: number, missingCount: number): number => {
	if (expectedCount === 0) return 100;
	return Math.round(((expectedCount - missingCount) / expectedCount) * 100);
};

const alignmentColorClass = (score: number): string => {
	if (score > 80) return "text-[var(--clens-success)]";
	if (score >= 50) return "text-[var(--clens-warning)]";
	return "text-[var(--clens-danger)]";
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
				<Card class="p-3">
					{/* Header */}
					<div class="mb-3 flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<GitBranch class="h-3.5 w-3.5 text-muted" />
								<h3 class="instrument-microcaps text-[11px] text-muted">Plan Fidelity</h3>
							</div>
							<span class="block truncate font-mono text-xs text-muted" title={d().spec_path}>
								{d().spec_path}
							</span>
						</div>
						{/* Scores */}
						<div class="flex shrink-0 items-end gap-4">
							<div class="text-right">
								<div class={`text-2xl font-bold tabular-nums ${alignmentColorClass(alignment())}`}>
									{alignment()}%
								</div>
								<div class="text-xs text-muted">aligned</div>
							</div>
							<div class="text-right">
								<div class="text-2xl font-bold tabular-nums text-muted">{driftPct()}%</div>
								<div class="text-xs text-muted">drift</div>
							</div>
						</div>
					</div>

					{/* Expected files */}
					<div class="mb-2">
						<div class="instrument-microcaps mb-1 text-[10px] text-muted">
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
												fallback={<Check class="h-3 w-3 shrink-0 text-[var(--clens-success)]" />}
											>
												<X class="h-3 w-3 shrink-0 text-[var(--clens-danger)]" />
											</Show>
											<span
												class={`truncate font-mono text-xs ${
													isMissing() ? "text-[var(--clens-danger)] line-through" : "text-secondary"
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
							<div class="instrument-microcaps mb-1 text-[10px] text-muted">
								Unexpected files ({d().unexpected_files.length})
							</div>
							<div class="space-y-0.5">
								<For each={d().unexpected_files}>
									{(file) => (
										<div class="flex items-center gap-1.5 min-w-0">
											<PlusCircle class="h-3 w-3 shrink-0 text-[var(--clens-warning)]" />
											<span
												class="truncate font-mono text-xs text-[var(--clens-warning)]"
												title={file}
											>
												{file}
											</span>
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>
				</Card>
			)}
		</Show>
	);
};

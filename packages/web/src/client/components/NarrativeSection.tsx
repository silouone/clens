import { BookOpen } from "lucide-solid";
import { type Component, createMemo, For, Show } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { formatDuration, formatRelTime } from "../lib/format";
import { renderPlainText } from "../lib/markdown";
import { Card } from "./ui/Card";

// ── Types ────────────────────────────────────────────────────────────

type NarrativeSectionProps = {
	readonly session: DistilledSession;
};

// ── Component ────────────────────────────────────────────────────────

export const NarrativeSection: Component<NarrativeSectionProps> = (props) => {
	const narrative = () => props.session.summary?.narrative;
	const phases = () => props.session.summary?.phases ?? [];
	const startTime = () => props.session.start_time;

	const hasContent = createMemo(() => {
		const n = narrative();
		return n !== undefined && n.length > 0;
	});

	return (
		<Show when={hasContent()}>
			<Card class="p-3">
				<div class="flex items-center gap-2">
					<BookOpen class="h-4 w-4 text-muted" />
					<h3 class="instrument-microcaps text-[11px] text-muted">What Happened</h3>
				</div>

				{/* Narrative text — generated prose interpolating raw model ids and
				    file paths; rendered verbatim, never as markdown (bug B16) */}
				<div
					class="mt-2 text-sm leading-relaxed text-muted prose-sm-dark"
					innerHTML={renderPlainText(narrative() ?? "")}
				/>

				{/* Phase milestones */}
				<Show when={phases().length > 0}>
					<div class="mt-3 divide-y divide-clens">
						<For each={phases()}>
							{(phase) => (
								<div class="py-1.5 first:pt-0 last:pb-0">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium text-secondary">{phase.name}</span>
										<span class="text-xs text-muted">
											{formatDuration(phase.end_t - phase.start_t)}
										</span>
										<Show when={startTime() !== undefined}>
											<span class="text-xs text-muted">
												({formatRelTime(phase.start_t, startTime() ?? 0)}
												{" \u2013 "}
												{formatRelTime(phase.end_t, startTime() ?? 0)})
											</span>
										</Show>
									</div>
									<Show when={phase.description.length > 0}>
										<p class="mt-0.5 text-xs text-muted">{phase.description}</p>
									</Show>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Card>
		</Show>
	);
};

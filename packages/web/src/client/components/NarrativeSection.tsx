import { For, Show, createMemo, type Component } from "solid-js";
import { BookOpen } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";
import { formatDuration, formatRelTime } from "../lib/format";

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
			<div class="animate-fade-in rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
				<div class="flex items-center gap-2">
					<BookOpen class="h-4 w-4 text-sky-500" />
					<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
						What Happened
					</h3>
				</div>

				{/* Narrative text */}
				<p class="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
					{narrative()}
				</p>

				{/* Phase milestones */}
				<Show when={phases().length > 0}>
					<div class="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
						<For each={phases()}>
							{(phase) => (
								<div class="py-1.5 first:pt-0 last:pb-0">
									<div class="flex items-center gap-2">
										<span class="text-sm font-medium text-gray-700 dark:text-gray-300">
											{phase.name}
										</span>
										<span class="text-xs text-gray-400 dark:text-gray-400">
											{formatDuration(phase.end_t - phase.start_t)}
										</span>
										<Show when={startTime() !== undefined}>
											<span class="text-xs text-gray-400 dark:text-gray-400">
												({formatRelTime(phase.start_t, startTime() ?? 0)}
												{" \u2013 "}
												{formatRelTime(phase.end_t, startTime() ?? 0)})
											</span>
										</Show>
									</div>
									<Show when={phase.description.length > 0}>
										<p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
											{phase.description}
										</p>
									</Show>
								</div>
							)}
						</For>
					</div>
				</Show>
			</div>
		</Show>
	);
};

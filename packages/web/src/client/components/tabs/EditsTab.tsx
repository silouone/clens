import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import type { TranscriptReasoning } from "../../../shared/types";
import type { TabProps } from "./types";

// ── EditsTab — Wave 0 carry-over (Wave 2 reworks) ────────────────────
// Preserves the original edit-chain list + per-step thinking expansion (R-F2).
// Wave 2 adds the churn/abandoned overview (R-C3, AC8).

/** tool_use_id → reasoning entry (no non-null assertion; FP filter+flatMap). */
const buildReasoningLookup = (
	reasoning: readonly TranscriptReasoning[],
): ReadonlyMap<string, TranscriptReasoning> =>
	new Map(
		reasoning.flatMap((r) =>
			r.tool_use_id !== undefined ? ([[r.tool_use_id, r]] as const) : [],
		),
	);

const truncateText = (text: string, maxLen: number): string =>
	text.length <= maxLen ? text : `${text.slice(0, maxLen)}...`;

const EmptyTab: Component<{ readonly message: string }> = (props) => (
	<div class="flex h-full items-center justify-center py-8">
		<span class="instrument-microcaps border border-clens px-3 py-1.5 text-[10px] text-muted">
			{props.message}
		</span>
	</div>
);

export const EditsTab: Component<TabProps> = (props) => {
	const chains = () => props.session.edit_chains?.chains ?? [];
	const reasoningMap = createMemo(() => buildReasoningLookup(props.session.reasoning ?? []));
	const [expandedStep, setExpandedStep] = createSignal<string | undefined>();

	const toggleStep = (toolUseId: string) => {
		setExpandedStep((prev) => (prev === toolUseId ? undefined : toolUseId));
	};

	return (
		<Show when={chains().length > 0} fallback={<EmptyTab message="No edit chains" />}>
			<div class="divide-y divide-clens">
				<For each={chains()}>
					{(chain) => (
						<div class="px-3 py-1.5">
							<div class="flex items-center gap-2">
								<span class="flex-1 truncate font-mono text-xs text-secondary">
									{chain.file_path}
								</span>
								<span class="font-mono text-[10px] tabular-nums text-muted">
									{chain.total_edits} edit{chain.total_edits !== 1 ? "s" : ""}
								</span>
								<span class="font-mono text-[10px] tabular-nums text-muted">
									{chain.total_reads} read{chain.total_reads !== 1 ? "s" : ""}
								</span>
								<Show when={chain.has_backtrack}>
									<span class="instrument-microcaps rounded-none border border-clens px-1 py-0.5 text-[9px] text-[var(--clens-warning)]">
										backtrack
									</span>
								</Show>
							</div>

							<div class="mt-1 flex flex-wrap gap-1">
								<For each={chain.steps}>
									{(step) => {
										const isAbandoned = chain.abandoned_edit_ids.includes(step.tool_use_id);
										const hasThinking = () => reasoningMap().has(step.tool_use_id);
										const isExpanded = () => expandedStep() === step.tool_use_id;

										return (
											<div class="inline-flex flex-col">
												<button
													onClick={() => (hasThinking() ? toggleStep(step.tool_use_id) : undefined)}
													class="inline-flex items-center gap-0.5 rounded-none border px-1 py-0.5 font-mono text-[11px]"
													classList={{
														"border-clens bg-surface-raised text-[var(--clens-success)]":
															step.outcome === "success" && !isAbandoned,
														"border-clens bg-surface-raised text-[var(--clens-danger)]":
															step.outcome === "failure",
														"border-clens bg-surface-raised text-muted": step.outcome === "info",
														"line-through opacity-50": isAbandoned,
														"cursor-pointer hover:bg-surface-hover": hasThinking(),
														"cursor-default": !hasThinking(),
													}}
												>
													{step.tool_name}
													{isAbandoned ? " (abandoned)" : ""}
													<Show when={hasThinking()}>
														<span class="text-[11px] text-brand-500" title="Has thinking context">
															&#x1D4D5;
														</span>
													</Show>
												</button>
												<Show when={isExpanded() && reasoningMap().get(step.tool_use_id)}>
													{(r) => (
														<div class="mt-0.5 max-w-xs whitespace-pre-wrap rounded-none border border-clens bg-surface-inset px-2 py-1 text-[10px] text-secondary">
															{truncateText(r().thinking, 200)}
														</div>
													)}
												</Show>
											</div>
										);
									}}
								</For>
							</div>

							<Show when={chain.abandoned_edit_ids.length > 0}>
								<div class="mt-1 text-[11px] text-[var(--clens-warning)]">
									{chain.abandoned_edit_ids.length} abandoned edit
									{chain.abandoned_edit_ids.length !== 1 ? "s" : ""}
								</div>
							</Show>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
};

import { ChevronRight } from "lucide-solid";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { CostEstimate, TokenUsage } from "../../../../shared/types";
import { formatCost, modelDisplayName } from "../../../lib/format";
import { CostDrilldown } from "../../CostDrilldown";
import { formatCompact, TOKEN_COLORS } from "../../charts";
import { MetaRow } from "../../ui/MetaRow";
import { Widget } from "../../ui/Widget";
import type { WidgetProps } from "../types";

// ── CostWidget [cost] — Wave 1 ───────────────────────────────────────
//
// The cost figure is ALWAYS estimated-marked (the `~` from formatCost, plus a
// provenance caption — honesty R-D1; an estimate never reads as exact). The
// token mix is shown as a compact proportional bar in the sanctioned token
// channel palette (TOKEN_COLORS) so the cache-read-dominant shape is legible at
// a glance instead of a text wall (R-C). Clicking the cost figure opens the
// existing CostDrilldown popover (R-F2, preserved from the old SessionOverview).
// Every value is sourced or empty-stated — nothing is fabricated (R-D4/R-E1).

type TokenSlice = {
	readonly key: string;
	readonly label: string;
	readonly value: number;
	readonly color: string;
};

/**
 * Token counts for the mix bar. `stats.token_usage` is absent on ~92% of
 * sessions (cost is token-estimated, not from a verbatim usage object), so we
 * fall back to the CostEstimate's own token counts (NUM-15) — the very numbers
 * that back the priced cost. The whole widget is estimated-marked, so this is
 * honest, not fabricated. Returns undefined only when there is no estimate.
 */
const tokensFromCost = (cost: CostEstimate | undefined): TokenUsage | undefined =>
	cost
		? {
				input_tokens: cost.estimated_input_tokens,
				output_tokens: cost.estimated_output_tokens,
				cache_read_tokens: cost.cache_read_tokens ?? 0,
				cache_creation_tokens: cost.cache_creation_tokens ?? 0,
			}
		: undefined;

const tokenSlices = (tu: TokenUsage): readonly TokenSlice[] =>
	[
		{ key: "input", label: "Input", value: tu.input_tokens, color: TOKEN_COLORS.input },
		{ key: "output", label: "Output", value: tu.output_tokens, color: TOKEN_COLORS.output },
		{
			key: "cache_read",
			label: "Cache read",
			value: tu.cache_read_tokens,
			color: TOKEN_COLORS.cache_read,
		},
		{
			key: "cache_create",
			label: "Cache create",
			value: tu.cache_creation_tokens,
			color: TOKEN_COLORS.cache_create,
		},
	].filter((s) => s.value > 0);

export const CostWidget: Component<WidgetProps> = (props) => {
	const estimate = () => props.session.cost_estimate ?? props.session.stats.cost_estimate;
	const cost = () => estimate()?.estimated_cost_usd;
	const isEstimated = () => estimate()?.is_estimated ?? true;
	const tier = () => estimate()?.pricing_tier;
	const basis = () => estimate()?.cost_basis ?? (isEstimated() ? "estimated" : undefined);
	const model = () => props.session.stats.model;

	const tokens = createMemo(() => props.session.stats.token_usage ?? tokensFromCost(estimate()));
	const slices = createMemo(() => {
		const tu = tokens();
		return tu ? tokenSlices(tu) : [];
	});
	const tokenTotal = createMemo(() => slices().reduce((sum, s) => sum + s.value, 0));

	const hasAny = () => cost() !== undefined || Boolean(model()) || slices().length > 0;

	const [costOpen, setCostOpen] = createSignal(false);

	return (
		<Widget category="cost" title="Cost" span={4}>
			<Show when={hasAny()} fallback={<p class="text-xs italic text-muted">No cost data</p>}>
				<div class="space-y-3">
					{/* Cost figure — dominant, estimated-marked, opens the drilldown */}
					<Show when={cost() !== undefined}>
						<div class="relative">
							<button
								type="button"
								onClick={() => setCostOpen((prev) => !prev)}
								class="group flex w-full items-baseline gap-2 text-left focus-ring"
								aria-label="Show cost breakdown"
								aria-expanded={costOpen()}
							>
								<span class="font-mono text-xl font-semibold tabular-nums text-primary group-hover:text-cat-cost">
									{formatCost(cost() ?? 0, isEstimated())}
								</span>
								<Show when={basis()}>
									{(b) => <span class="instrument-microcaps text-[9px] text-muted">{b()}</span>}
								</Show>
								<ChevronRight
									class={`ml-auto h-3.5 w-3.5 flex-shrink-0 text-muted transition-transform ${costOpen() ? "rotate-90" : ""}`}
								/>
							</button>
							<CostDrilldown
								session={props.session}
								open={costOpen()}
								onClose={() => setCostOpen(false)}
							/>
						</div>
					</Show>

					{/* Token mix — proportional bar in the sanctioned token palette */}
					<Show when={slices().length > 0 && tokenTotal() > 0}>
						<div class="space-y-1.5">
							<div class="flex h-2.5 w-full overflow-hidden rounded-none border border-clens bg-surface-inset">
								<For each={slices()}>
									{(s) => (
										<div
											class="h-full"
											style={{
												width: `${(s.value / tokenTotal()) * 100}%`,
												"background-color": s.color,
											}}
										/>
									)}
								</For>
							</div>
							<div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
								<For each={slices()}>
									{(s) => (
										<div class="flex items-center justify-between gap-1.5">
											<span class="flex min-w-0 items-center gap-1 instrument-microcaps text-[9px] text-muted">
												<span
													class="inline-block h-2 w-2 flex-shrink-0 rounded-[1px]"
													style={{ "background-color": s.color }}
												/>
												<span class="truncate">{s.label}</span>
											</span>
											<span class="font-mono text-[10px] tabular-nums text-secondary">
												{formatCompact(s.value)}
											</span>
										</div>
									)}
								</For>
							</div>
						</div>
					</Show>

					{/* Model + pricing tier */}
					<div class="space-y-1 border-t border-clens pt-2">
						<MetaRow label="Model" value={model() ? modelDisplayName(model() ?? "") : "unknown"} />
						<Show when={tier()}>{(t) => <MetaRow label="Tier" value={t()} />}</Show>
					</div>
				</div>
			</Show>
		</Widget>
	);
};

import { createEffect, onCleanup, Show, type Component } from "solid-js";
import type { CostEstimate, DistilledSession, TokenUsage } from "../../shared/types";

// ── Types ────────────────────────────────────────────────────────────

type CostDrilldownProps = {
	readonly session: DistilledSession;
	readonly open: boolean;
	readonly onClose: () => void;
};

// ── Pure helpers ─────────────────────────────────────────────────────

const fmt = (n: number): string => n.toLocaleString();

const cacheEfficiency = (input: number, cacheRead: number): string => {
	const total = input + cacheRead;
	if (total === 0) return "0%";
	return `${Math.round((cacheRead / total) * 100)}%`;
};

/**
 * Derive a token breakdown from a CostEstimate (NUM-15).
 *
 * `stats.token_usage` is absent on ~92% of sessions (the cost is token-estimated
 * rather than from a verbatim usage object), which left the drilldown blank. The
 * CostEstimate that backs every priced session still carries its own token
 * counts, so fall back to those. The estimated banner already flags provenance.
 * Returns undefined when there is no cost_estimate, so the "not available"
 * branch still covers the truly-empty case.
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

// ── Token row ────────────────────────────────────────────────────────

const TokenRow: Component<{
	readonly label: string;
	readonly value: number;
}> = (props) => (
	<div class="flex items-center justify-between text-xs">
		<span class="text-muted">{props.label}</span>
		<span class="font-mono font-medium tabular-nums text-secondary">
			{fmt(props.value)}
		</span>
	</div>
);

// ── Component ────────────────────────────────────────────────────────

export const CostDrilldown: Component<CostDrilldownProps> = (props) => {
	const cost = () => props.session.cost_estimate;
	// Prefer a verbatim token_usage object; fall back to the CostEstimate's own
	// token counts when it's absent (NUM-15) so the breakdown isn't blank.
	const tokens = () => props.session.stats.token_usage ?? tokensFromCost(cost());

	// Close on outside click via backdrop
	// Close on Escape key
	createEffect(() => {
		if (!props.open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") props.onClose();
		};
		document.addEventListener("keydown", handler);
		onCleanup(() => document.removeEventListener("keydown", handler));
	});

	return (
		<Show when={props.open}>
			{/* Invisible backdrop to catch outside clicks */}
			<div class="fixed inset-0 z-40" onClick={props.onClose} />

			{/* Popover */}
			<div class="absolute top-full left-0 z-50 mt-1 w-72 rounded-none border border-clens bg-surface-overlay p-3">
				{/* Estimated banner — token warning, square hairline */}
				<Show when={cost()?.is_estimated}>
					<div class="mb-2 flex items-center gap-1.5 rounded-none border border-clens bg-surface-inset px-2.5 py-1.5 text-[11px] text-[var(--clens-warning)]">
						<span class="instrument-led bg-[var(--clens-warning)]" />
						Rough estimate — real token data unavailable
					</div>
				</Show>

				{/* Token breakdown */}
				<Show
					when={tokens()}
					fallback={
						<p class="text-xs text-muted">
							Token breakdown not available for this session
						</p>
					}
				>
					{(tu) => (
						<div class="space-y-1.5">
							<TokenRow label="Input tokens" value={tu().input_tokens} />
							<TokenRow label="Output tokens" value={tu().output_tokens} />
							<TokenRow label="Cache read" value={tu().cache_read_tokens} />
							<TokenRow label="Cache creation" value={tu().cache_creation_tokens} />

							{/* Cache efficiency */}
							<div class="mt-2 border-t border-clens pt-2">
								<div class="flex items-center justify-between text-xs">
									<span class="text-muted">Cache hit rate</span>
									<span class="font-mono font-medium tabular-nums text-[var(--clens-success)]">
										{cacheEfficiency(tu().input_tokens, tu().cache_read_tokens)}
									</span>
								</div>
							</div>
						</div>
					)}
				</Show>

				{/* Pricing tier */}
				<Show when={cost()?.pricing_tier}>
					{(tier) => (
						<div class="mt-2 border-t border-clens pt-2">
							<div class="flex items-center justify-between text-xs">
								<span class="text-muted">Pricing tier</span>
								<span class="font-medium text-secondary">{tier()}</span>
							</div>
						</div>
					)}
				</Show>

				{/* Confidence label when estimated */}
				<Show when={cost()?.is_estimated}>
					<div class="mt-2 text-[10px] text-muted">
						Confidence: low — based on heuristic token estimates
					</div>
				</Show>
			</div>
		</Show>
	);
};

import { X } from "lucide-solid";
import { type Component, Show } from "solid-js";
import { clearCustomRange, customRange } from "../lib/analytics-store";
import { formatShortDate } from "./charts/shared";

// ── Custom range chip (AC8) ─────────────────────────────────────────
//
// Single shared chip used by both Usage and Insights so a brush window on
// either tab reads identically. Surfaces the resolved inclusive dates in one
// canonical format (en-dash, short M/D) with a control to clear back to the
// active preset. Replaces the two divergent inline chips (Usage ISO `from..to`
// vs Insights en-dash) with a single source of truth.
export const CustomRangeChip: Component = () => (
	<Show when={customRange()}>
		{(range) => (
			<div class="instrument-microcaps flex items-center gap-1.5 rounded-none border border-brand-500 bg-surface-muted px-2.5 py-1 text-[10px] text-primary">
				<span class="h-1.5 w-1.5 shrink-0 bg-brand-500" />
				<span>Custom</span>
				<span class="font-mono tabular-nums text-secondary normal-case tracking-normal">
					{formatShortDate(range().from)}–{formatShortDate(range().to)}
				</span>
				<button
					type="button"
					onClick={() => clearCustomRange()}
					class="ml-0.5 -mr-0.5 text-muted transition-colors hover:text-danger"
					title="Clear custom range"
					aria-label="Clear custom range"
				>
					<X class="h-3 w-3" />
				</button>
			</div>
		)}
	</Show>
);

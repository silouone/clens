import { type Component, type JSX, Show } from "solid-js";
import { CATEGORY, type CategoryKey } from "../../lib/categories";

// ── StatTile (overview-moat-refactor, Wave 0) ────────────────────────
//
// Compact category-coloured stat for the HeroBand health strip: a microcaps
// label in the channel color over a mono tabular value, with the sanctioned
// colored left-rule. Optional `delta` (trend) and `spark` (sparkline) slots.
// Square, hairline — same INSTRUMENT idiom as <Widget> (constraint C2).

type StatTileProps = {
	readonly category: CategoryKey;
	readonly label: string;
	readonly value: string | number;
	/** Optional trend/delta indicator rendered next to the value. */
	readonly delta?: JSX.Element;
	/** Optional muted sub-line (mono numerals) rendered under the value. */
	readonly sub?: string;
	/** Optional sparkline / micro-chart slot rendered under the value. */
	readonly spark?: JSX.Element;
	readonly class?: string;
};

export const StatTile: Component<StatTileProps> = (props) => {
	const meta = () => CATEGORY[props.category];
	return (
		<div
			class={`flex min-w-[5.5rem] flex-col gap-0.5 rounded-none border border-clens bg-surface-raised px-2.5 py-1.5 ${meta().ruleClass} ${props.class ?? ""}`}
		>
			<span class="instrument-microcaps text-[9px]" style={{ color: meta().cssVar }}>
				{props.label}
			</span>
			<div class="flex items-baseline gap-1.5">
				<span class="font-mono text-sm tabular-nums text-primary">{props.value}</span>
				<Show when={props.delta}>{props.delta}</Show>
			</div>
			<Show when={props.sub}>
				<span class="font-mono text-[9px] tabular-nums text-muted">{props.sub}</span>
			</Show>
			<Show when={props.spark}>{props.spark}</Show>
		</div>
	);
};

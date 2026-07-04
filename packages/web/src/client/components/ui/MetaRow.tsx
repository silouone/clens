import type { Component } from "solid-js";

type MetaRowProps = {
	readonly label: string;
	readonly value: string | number;
};

export const MetaRow: Component<MetaRowProps> = (props) => (
	<div class="flex items-center justify-between text-xs">
		<span class="instrument-microcaps text-[10px] text-muted">{props.label}</span>
		<span class="text-right font-mono tabular-nums text-secondary">{props.value}</span>
	</div>
);

export type { MetaRowProps };

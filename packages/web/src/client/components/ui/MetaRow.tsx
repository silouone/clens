import type { Component } from "solid-js";

type MetaRowProps = {
	readonly label: string;
	readonly value: string | number;
};

export const MetaRow: Component<MetaRowProps> = (props) => (
	<div class="flex items-center justify-between text-xs">
		<span class="text-muted">{props.label}</span>
		<span class="font-medium tabular-nums text-secondary">
			{props.value}
		</span>
	</div>
);

export type { MetaRowProps };

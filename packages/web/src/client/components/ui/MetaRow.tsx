import type { Component } from "solid-js";

type MetaRowProps = {
	readonly label: string;
	readonly value: string | number;
};

export const MetaRow: Component<MetaRowProps> = (props) => (
	<div class="flex items-center justify-between text-xs">
		<span class="text-text-muted">{props.label}</span>
		<span class="font-medium tabular-nums text-gray-700 dark:text-gray-300">
			{props.value}
		</span>
	</div>
);

export type { MetaRowProps };

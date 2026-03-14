import type { Component } from "solid-js";

type StatItemVariant = "row" | "pill";

type StatItemProps = {
	readonly label: string;
	readonly value: string;
	readonly muted?: boolean;
	readonly title?: string;
	readonly colorClass?: string;
	readonly variant?: StatItemVariant;
};

const valueClasses = (props: StatItemProps): string =>
	props.colorClass
		? `font-medium tabular-nums ${props.colorClass}`
		: props.muted === true
			? "font-medium tabular-nums text-gray-400 dark:text-gray-400"
			: "font-medium tabular-nums text-gray-700 dark:text-gray-300";

const RowLayout: Component<StatItemProps> = (props) => (
	<div class="flex items-center justify-between py-0.5 text-xs" title={props.title}>
		<span class="text-gray-500 dark:text-gray-400">{props.label}</span>
		<span class={valueClasses(props)}>{props.value}</span>
	</div>
);

const PillLayout: Component<StatItemProps> = (props) => (
	<div
		class="flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800/60"
		title={props.title}
	>
		<span class="text-gray-500 dark:text-gray-400">{props.label}</span>
		<span class={valueClasses(props)}>{props.value}</span>
	</div>
);

const VARIANT_RENDERERS: Readonly<Record<StatItemVariant, Component<StatItemProps>>> = {
	row: RowLayout,
	pill: PillLayout,
} as const;

export const StatItem: Component<StatItemProps> = (props) => {
	const Renderer = VARIANT_RENDERERS[props.variant ?? "row"];
	return <Renderer {...props} />;
};

export type { StatItemProps };

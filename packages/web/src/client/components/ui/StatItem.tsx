import { Show, type Component } from "solid-js";

type StatItemVariant = "row" | "pill";

type StatItemProps = {
	readonly label: string;
	readonly value: string;
	readonly muted?: boolean;
	readonly title?: string;
	readonly colorClass?: string;
	readonly variant?: StatItemVariant;
	readonly icon?: Component<{ readonly class?: string }>;
	readonly bordered?: boolean;
};

const valueClasses = (props: StatItemProps): string =>
	props.colorClass
		? `font-mono font-medium tabular-nums ${props.colorClass}`
		: props.muted === true
			? "font-mono font-medium tabular-nums text-muted"
			: "font-mono font-medium tabular-nums text-secondary";

const RowLayout: Component<StatItemProps> = (props) => (
	<div class="flex items-center justify-between gap-2 py-0.5 text-xs min-w-0" title={props.title ?? props.value}>
		<span class="instrument-microcaps shrink-0 text-[10px] text-muted">{props.label}</span>
		<span class={`truncate text-right ${valueClasses(props)}`}>{props.value}</span>
	</div>
);

const PillLayout: Component<StatItemProps> = (props) => (
	<div
		class="flex items-center gap-1.5 rounded-none px-2.5 py-1 text-xs"
		classList={{
			"bg-surface-muted": !props.bordered,
			"border border-clens bg-surface-raised": props.bordered === true,
		}}
		title={props.title}
	>
		<Show when={props.icon}>
			{(Icon) => {
				const IconComp = Icon();
				return <IconComp class="h-3 w-3 text-muted" />;
			}}
		</Show>
		<span class="instrument-microcaps text-[10px] text-muted">{props.label}</span>
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

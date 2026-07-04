import { type Component, type JSX, Show } from "solid-js";

type SectionHeadingVariant = "default" | "muted";

type SectionHeadingProps = {
	readonly title: string;
	readonly icon?: Component<{ readonly class?: string }>;
	readonly count?: number;
	readonly children?: JSX.Element;
	readonly variant?: SectionHeadingVariant;
};

export const SectionHeading: Component<SectionHeadingProps> = (props) => (
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Show when={props.icon}>
				{(Icon) => {
					const IconComp = Icon();
					return <IconComp class="h-3.5 w-3.5 text-muted" />;
				}}
			</Show>
			<h3
				class="instrument-microcaps text-[11px]"
				classList={{
					"text-secondary": (props.variant ?? "default") === "default",
					"text-muted": props.variant === "muted",
				}}
			>
				{props.title}
			</h3>
			<Show when={props.count !== undefined}>
				<span class="rounded-none border border-clens bg-surface-inset px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-muted">
					{props.count}
				</span>
			</Show>
		</div>
		<Show when={props.children}>{props.children}</Show>
	</div>
);

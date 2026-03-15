import { Show, type Component, type JSX } from "solid-js";

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
					return <IconComp class="h-4 w-4 text-muted" />;
				}}
			</Show>
			<h3
			class="text-xs font-semibold uppercase tracking-wider"
			classList={{
				"text-secondary": (props.variant ?? "default") === "default",
				"text-muted": props.variant === "muted",
			}}
		>
				{props.title}
			</h3>
			<Show when={props.count !== undefined}>
				<span class="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">
					{props.count}
				</span>
			</Show>
		</div>
		<Show when={props.children}>
			{props.children}
		</Show>
	</div>
);

import { type Component, type JSX, Show } from "solid-js";

type CardProps = {
	readonly title?: string;
	readonly icon?: Component<{ readonly class?: string }>;
	readonly children: JSX.Element;
	readonly class?: string;
	readonly headerRight?: JSX.Element;
	readonly colorAccent?: string;
};

export const Card: Component<CardProps> = (props) => (
	<div
		class={`animate-fade-in rounded-none border border-clens bg-surface-raised ${props.class ?? ""}`}
		style={props.colorAccent ? { "border-left": `3px solid ${props.colorAccent}` } : undefined}
	>
		<Show when={props.title}>
			<div class="flex items-center justify-between border-b border-clens px-4 py-2.5">
				<div class="flex items-center gap-2">
					<Show when={props.icon}>
						{(Icon) => {
							const IconComp = Icon();
							return <IconComp class="h-3.5 w-3.5 text-muted" />;
						}}
					</Show>
					<h3 class="instrument-microcaps text-[11px] text-muted">{props.title}</h3>
				</div>
				<Show when={props.headerRight}>{props.headerRight}</Show>
			</div>
		</Show>
		{props.children}
	</div>
);

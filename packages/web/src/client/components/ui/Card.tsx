import { Show, type Component, type JSX } from "solid-js";

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
		class={`animate-fade-in rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5 ${props.class ?? ""}`}
		style={props.colorAccent ? { "border-left": `3px solid ${props.colorAccent}` } : undefined}
	>
		<Show when={props.title}>
			<div class="flex items-center justify-between border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
				<div class="flex items-center gap-2">
					<Show when={props.icon}>
						{(Icon) => {
							const IconComp = Icon();
							return <IconComp class="h-4 w-4 text-gray-400 dark:text-gray-400" />;
						}}
					</Show>
					<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
						{props.title}
					</h3>
				</div>
				<Show when={props.headerRight}>
					{props.headerRight}
				</Show>
			</div>
		</Show>
		{props.children}
	</div>
);

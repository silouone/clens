import { Show, type Component, type JSX } from "solid-js";

type SectionHeadingProps = {
	readonly title: string;
	readonly icon?: Component<{ readonly class?: string }>;
	readonly count?: number;
	readonly children?: JSX.Element;
};

export const SectionHeading: Component<SectionHeadingProps> = (props) => (
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Show when={props.icon}>
				{(Icon) => {
					const IconComp = Icon();
					return <IconComp class="h-4 w-4 text-gray-400 dark:text-gray-400" />;
				}}
			</Show>
			<h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
				{props.title}
			</h3>
			<Show when={props.count !== undefined}>
				<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
					{props.count}
				</span>
			</Show>
		</div>
		<Show when={props.children}>
			{props.children}
		</Show>
	</div>
);

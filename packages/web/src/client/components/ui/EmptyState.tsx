import { Show, type Component, type JSX } from "solid-js";

type EmptyStateProps = {
	readonly icon?: Component<{ readonly class?: string }>;
	readonly title: string;
	readonly description?: string;
	readonly action?: JSX.Element;
};

export const EmptyState: Component<EmptyStateProps> = (props) => (
	<div class="flex flex-col items-center justify-center py-12 text-center">
		<Show when={props.icon}>
			{(Icon) => {
				const IconComp = Icon();
				return (
					<div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
						<IconComp class="h-6 w-6 text-gray-400 dark:text-gray-400" />
					</div>
				);
			}}
		</Show>
		<p class="text-lg font-medium text-gray-600 dark:text-gray-400">{props.title}</p>
		<Show when={props.description}>
			{(desc) => (
				<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{desc()}</p>
			)}
		</Show>
		<Show when={props.action}>
			<div class="mt-4">
				{props.action}
			</div>
		</Show>
	</div>
);

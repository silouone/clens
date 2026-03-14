import { Show, type Component, type JSX } from "solid-js";

type DetailHeaderProps = {
	readonly title: string;
	/** Extra elements after the title (status badge, stat pills, etc.) */
	readonly children?: JSX.Element;
	/** Optional right-aligned action area */
	readonly action?: JSX.Element;
};

export const DetailHeader: Component<DetailHeaderProps> = (props) => (
	<div class="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-sm font-semibold text-gray-900 truncate max-w-md dark:text-gray-100">
				{props.title}
			</h2>
			{props.children}
			<Show when={props.action}>
				<div class="ml-auto">
					{props.action}
				</div>
			</Show>
		</div>
	</div>
);

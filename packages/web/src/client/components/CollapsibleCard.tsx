import { createSignal, Show, type Component, type JSX } from "solid-js";

type CollapsibleCardProps = {
	readonly title: string;
	readonly defaultOpen?: boolean;
	readonly children: JSX.Element;
};

export const CollapsibleCard: Component<CollapsibleCardProps> = (props) => {
	const [open, setOpen] = createSignal(props.defaultOpen ?? true);

	return (
		<div class="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/50">
			<button
				onClick={() => setOpen((o) => !o)}
				class="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/30"
			>
				<span
					class="text-gray-400 transition-transform dark:text-gray-600"
					classList={{ "rotate-90": open() }}
				>
					&#9654;
				</span>
				{props.title}
			</button>
			<Show when={open()}>
				<div class="border-t border-gray-200 dark:border-gray-800">
					{props.children}
				</div>
			</Show>
		</div>
	);
};

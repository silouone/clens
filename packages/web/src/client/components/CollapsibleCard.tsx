import { createSignal, Show, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { ChevronRight } from "lucide-solid";

type CollapsibleCardProps = {
	readonly title: string;
	readonly icon?: Component<{ readonly class?: string }>;
	readonly defaultOpen?: boolean;
	readonly children: JSX.Element;
};

export const CollapsibleCard: Component<CollapsibleCardProps> = (props) => {
	const [open, setOpen] = createSignal(props.defaultOpen ?? true);

	return (
		<div class="animate-fade-in rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 dark:ring-1 dark:ring-white/5">
			<button
				onClick={() => setOpen((o) => !o)}
				class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/30"
			>
				<ChevronRight
					class="h-3.5 w-3.5 text-gray-400 transition-transform dark:text-gray-400"
					classList={{ "rotate-90": open() }}
				/>
				<Show when={props.icon}>
					{(Icon) => (
						<Dynamic component={Icon()} class="h-3.5 w-3.5 text-gray-400 dark:text-gray-400" />
					)}
				</Show>
				{props.title}
			</button>
			<div
				class="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ "grid-template-rows": open() ? "1fr" : "0fr" }}
			>
				<div class="overflow-hidden">
					<div class="border-t border-gray-200 dark:border-gray-800">
						{props.children}
					</div>
				</div>
			</div>
		</div>
	);
};

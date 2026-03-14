import { Show, type Component } from "solid-js";
import { ChevronRight } from "lucide-solid";

type TreeToggleProps = {
	readonly expanded: boolean;
	readonly onToggle: (e: MouseEvent) => void;
	readonly hasChildren: boolean;
};

export const TreeToggle: Component<TreeToggleProps> = (props) => (
	<Show when={props.hasChildren} fallback={<span class="w-3" />}>
		<button
			type="button"
			aria-label="Toggle subtree"
			aria-expanded={props.expanded}
			class="flex items-center justify-center rounded p-0 hover:text-gray-700 dark:hover:text-gray-300"
			onClick={props.onToggle}
		>
			<ChevronRight
				class="h-3 w-3 shrink-0 text-gray-400 transition-transform"
				classList={{ "rotate-90": props.expanded }}
			/>
		</button>
	</Show>
);

export type { TreeToggleProps };

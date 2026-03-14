import { Show, type Component } from "solid-js";
import { KbdShortcut } from "./KbdShortcut";

type NavButtonProps = {
	readonly label: string;
	readonly icon: Component<{ class?: string }>;
	readonly active: boolean;
	readonly onClick: () => void;
	readonly shortcut?: string;
};

export const NavButton: Component<NavButtonProps> = (props) => (
	<button
		onClick={props.onClick}
		class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 dark:hover:bg-gray-800/50 dark:focus:ring-offset-gray-900"
		classList={{
			"bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300": props.active,
			"text-gray-700 dark:text-gray-300": !props.active,
		}}
		aria-current={props.active ? "page" : undefined}
	>
		<props.icon class="h-3.5 w-3.5 shrink-0" />
		{props.label}
		<Show when={props.shortcut}>
			{(sc) => <KbdShortcut shortcut={sc()} />}
		</Show>
	</button>
);

export type { NavButtonProps };

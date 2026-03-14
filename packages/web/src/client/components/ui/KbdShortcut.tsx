import type { Component } from "solid-js";

export type KbdShortcutProps = {
	readonly shortcut: string;
};

export const KbdShortcut: Component<KbdShortcutProps> = (props) => (
	<kbd class="ml-auto rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[10px] font-mono text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
		{props.shortcut}
	</kbd>
);

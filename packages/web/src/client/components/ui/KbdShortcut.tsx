import type { Component } from "solid-js";

export type KbdShortcutProps = {
	readonly shortcut: string;
};

export const KbdShortcut: Component<KbdShortcutProps> = (props) => (
	<kbd class="ml-auto rounded border border-clens bg-surface-inset px-1 py-0.5 text-[10px] font-mono text-muted">
		{props.shortcut}
	</kbd>
);

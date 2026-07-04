import type { Component, JSX } from "solid-js";

type TabBarProps = {
	readonly children: JSX.Element;
};

export const TabBar: Component<TabBarProps> = (props) => (
	<div
		role="tablist"
		class="flex items-center gap-1 overflow-x-auto border-b border-clens bg-surface-inset px-2 py-1"
	>
		{props.children}
	</div>
);

export type { TabBarProps };

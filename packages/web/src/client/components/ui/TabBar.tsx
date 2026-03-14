import type { Component, JSX } from "solid-js";

type TabBarProps = {
	readonly children: JSX.Element;
};

export const TabBar: Component<TabBarProps> = (props) => (
	<div role="tablist" class="flex items-center border-b border-gray-200 bg-gray-50 px-2 dark:border-gray-800 dark:bg-gray-900/50">
		{props.children}
	</div>
);

export type { TabBarProps };

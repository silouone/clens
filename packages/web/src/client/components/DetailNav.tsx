import type { Component, JSX } from "solid-js";

type DetailNavProps = {
	/** Top nav items (Overview, Conversation, etc.) */
	readonly topItems: JSX.Element;
	/** Titled tree sections (Agents, Sessions, etc.) */
	readonly sections?: JSX.Element;
	readonly ariaLabel?: string;
};

export const DetailNav: Component<DetailNavProps> = (props) => (
	<nav
		class="flex h-full w-full flex-col border-r border-clens bg-surface-raised"
		role="navigation"
		aria-label={props.ariaLabel ?? "Navigation"}
	>
		{/* Top nav items */}
		<div class="px-2 py-2 space-y-0.5">
			{props.topItems}
		</div>

		{/* Sections */}
		{props.sections}
	</nav>
);

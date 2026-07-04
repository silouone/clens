import { type Component, type JSX, Show } from "solid-js";

type DetailHeaderProps = {
	readonly title: string;
	/** Extra elements after the title (status badge, stat pills, etc.) */
	readonly children?: JSX.Element;
	/** Optional right-aligned action area */
	readonly action?: JSX.Element;
	/** Optional second row content (stat pills, timeline, etc.) */
	readonly bottomRow?: JSX.Element;
};

export const DetailHeader: Component<DetailHeaderProps> = (props) => (
	<div class="border-b border-clens bg-surface-inset px-3 py-2">
		{/* Row 1: title + inline children + action */}
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-base font-bold text-primary truncate max-w-md font-mono">{props.title}</h2>
			{!props.bottomRow && props.children}
			<Show when={props.action}>
				<div class="ml-auto">{props.action}</div>
			</Show>
		</div>
		{/* Row 2: bottom row content */}
		<Show when={props.bottomRow}>
			<div class="mt-1.5 flex flex-wrap items-center gap-2">{props.bottomRow}</div>
		</Show>
		{/* Instrument graticule tick strip beneath the header */}
		<div class="instrument-ruler mt-2 -mx-3" />
	</div>
);

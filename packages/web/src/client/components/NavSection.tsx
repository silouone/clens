import { Show, type Component, type JSX } from "solid-js";

type NavSectionProps = {
	readonly title: string;
	readonly count?: number;
	readonly children: JSX.Element;
	readonly ariaLabel?: string;
};

export const NavSection: Component<NavSectionProps> = (props) => (
	<>
		<div class="border-t border-clens" />
		<div class="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
			<h3 class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-400">
				{props.title}
			</h3>
			<Show when={props.count !== undefined}>
				<span class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:bg-gray-800 dark:text-gray-400">
					{props.count}
				</span>
			</Show>
		</div>
		<div class="flex-1 overflow-y-auto px-1 pb-2" role="tree" aria-label={props.ariaLabel ?? props.title}>
			{props.children}
		</div>
	</>
);

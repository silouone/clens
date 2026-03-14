import { Show, type Component } from "solid-js";

type TabButtonProps = {
	readonly label: string;
	readonly active: boolean;
	readonly onClick: () => void;
	readonly badge?: number;
	readonly badgeVariant?: "default" | "warning";
};

const TabBadge: Component<{
	readonly count: number;
	readonly variant?: "default" | "warning";
}> = (props) => (
	<Show when={props.count > 0}>
		<span
			class="rounded-full px-1.5 py-0.5 text-[11px] font-medium"
			classList={{
				"bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400": props.variant === "warning",
				"bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400": props.variant !== "warning",
			}}
		>
			{props.count}
		</span>
	</Show>
);

export const TabButton: Component<TabButtonProps> = (props) => (
	<button
		role="tab"
		aria-selected={props.active}
		onClick={props.onClick}
		class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition border-b-2"
		classList={{
			"border-blue-500 text-blue-600 dark:text-blue-400": props.active,
			"border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300": !props.active,
		}}
	>
		{props.label}
		<Show when={props.badge !== undefined && props.badge > 0}>
			<TabBadge count={props.badge ?? 0} variant={props.badgeVariant} />
		</Show>
	</button>
);

export type { TabButtonProps };

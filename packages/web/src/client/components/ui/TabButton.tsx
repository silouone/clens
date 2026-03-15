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
				"bg-surface-muted text-muted": props.variant !== "warning",
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
		class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors rounded-md"
		classList={{
			"bg-surface-muted text-primary": props.active,
			"text-muted hover:text-secondary hover:bg-surface-hover": !props.active,
		}}
	>
		{props.label}
		<Show when={props.badge !== undefined && props.badge > 0}>
			<TabBadge count={props.badge ?? 0} variant={props.badgeVariant} />
		</Show>
	</button>
);

export type { TabButtonProps };

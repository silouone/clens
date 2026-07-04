import { type Component, Show } from "solid-js";

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
			class="rounded-none border px-1 py-0 text-[10px] font-mono tabular-nums"
			classList={{
				"border-clens bg-surface-raised text-[var(--clens-warning)]": props.variant === "warning",
				"border-clens bg-surface-inset text-muted": props.variant !== "warning",
			}}
		>
			{props.count}
		</span>
	</Show>
);

export const TabButton: Component<TabButtonProps> = (props) => (
	<button
		type="button"
		role="tab"
		aria-selected={props.active}
		onClick={props.onClick}
		class="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-none px-3 py-1.5 text-xs font-medium transition-colors focus-ring"
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

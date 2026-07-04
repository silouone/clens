import { type Component, createSignal, For, type JSX, Show } from "solid-js";
import { TreeToggle } from "./ui/TreeToggle";

// ── Types ────────────────────────────────────────────────────────────

type TreeNavItemProps = {
	readonly depth: number;
	readonly selected: boolean;
	readonly onClick: () => void;
	readonly hasChildren: boolean;
	readonly defaultExpanded?: boolean;
	readonly ariaLabel?: string;
	/** Top row content: badges, name, etc. */
	readonly topRow: JSX.Element;
	/** Bottom row content: stats, cost, duration, etc. */
	readonly bottomRow?: JSX.Element;
	/** Child items (rendered when expanded) */
	readonly children?: JSX.Element;
};

// ── Component ────────────────────────────────────────────────────────

export const TreeNavItem: Component<TreeNavItemProps> = (props) => {
	const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? true);

	const handleToggle = (e: MouseEvent) => {
		e.stopPropagation();
		setExpanded((prev) => !prev);
	};

	return (
		<div
			role="treeitem"
			tabIndex={-1}
			aria-selected={props.selected}
			aria-expanded={props.hasChildren ? expanded() : undefined}
		>
			<button
				type="button"
				onClick={props.onClick}
				class="group flex w-full flex-col rounded-none mx-1.5 mb-0.5 text-left text-xs transition-colors duration-150 hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-brand-500"
				classList={{
					"bg-surface-selected ring-1 ring-inset ring-[var(--clens-border)] border-l-2 border-l-brand-500":
						props.selected,
				}}
				style={{ "margin-left": `${6 + props.depth * 12}px` }}
				aria-label={props.ariaLabel}
			>
				{/* Row 1: chevron + content */}
				<div class="flex w-full items-center gap-1.5 px-2 pt-1.5 pb-0.5">
					<TreeToggle
						expanded={expanded()}
						onToggle={handleToggle}
						hasChildren={props.hasChildren}
					/>
					{props.topRow}
				</div>

				{/* Row 2: stats row */}
				<Show when={props.bottomRow}>
					<div class="flex w-full items-center gap-2 px-2 pb-1.5 pl-[26px] text-[10px] tabular-nums text-muted">
						{props.bottomRow}
					</div>
				</Show>
			</button>

			{/* Children */}
			<Show when={expanded() && props.hasChildren}>{props.children}</Show>
		</div>
	);
};

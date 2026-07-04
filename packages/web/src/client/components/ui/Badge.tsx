import { type Component, type JSX, Show } from "solid-js";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

type BadgeProps = {
	readonly variant?: BadgeVariant;
	readonly children: JSX.Element;
	readonly class?: string;
	readonly dot?: boolean;
};

// Instrument: square hairline chip, microcaps, token-derived colors.
const VARIANT_CLASSES: Readonly<Record<BadgeVariant, string>> = {
	default: "bg-surface-muted text-secondary border-clens",
	success: "bg-surface-raised text-[var(--clens-success)] border-clens",
	warning: "bg-surface-raised text-[var(--clens-warning)] border-clens",
	danger: "bg-surface-raised text-[var(--clens-danger)] border-clens",
	info: "bg-surface-raised text-brand-500 border-clens",
} as const;

// LED square indicator color per variant.
const DOT_CLASSES: Readonly<Record<BadgeVariant, string>> = {
	default: "bg-muted",
	success: "bg-[var(--clens-success)]",
	warning: "bg-[var(--clens-warning)]",
	danger: "bg-[var(--clens-danger)]",
	info: "bg-brand-500",
} as const;

export const Badge: Component<BadgeProps> = (props) => {
	const variant = () => props.variant ?? "default";

	return (
		<span
			class={`instrument-microcaps inline-flex items-center gap-1.5 rounded-none border px-1.5 py-0.5 text-[10px] ${VARIANT_CLASSES[variant()]} ${props.class ?? ""}`}
		>
			<Show when={props.dot}>
				<span class={`instrument-led ${DOT_CLASSES[variant()]}`} />
			</Show>
			{props.children}
		</span>
	);
};

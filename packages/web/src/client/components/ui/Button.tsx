import { splitProps, type Component, type JSX } from "solid-js";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

type ButtonProps = {
	readonly variant?: ButtonVariant;
	readonly size?: ButtonSize;
	readonly children: JSX.Element;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

// Instrument: flat, hairline-bordered, square controls. Hover = surface-hover,
// never color washes. Primary inverts ink (brand fill) as the one accent.
const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
	primary:
		"border border-brand-500 bg-brand-500 text-white hover:bg-brand-600 hover:border-brand-600 disabled:opacity-50",
	secondary:
		"border border-clens bg-surface-raised text-secondary hover:bg-surface-hover disabled:opacity-50",
	ghost:
		"border border-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:opacity-40",
} as const;

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
	sm: "px-2.5 py-1 text-xs",
	md: "px-3 py-1.5 text-sm",
} as const;

export const Button: Component<ButtonProps> = (props) => {
	const [local, native] = splitProps(props, ["variant", "size", "children", "class"]);
	const variant = () => local.variant ?? "secondary";
	const size = () => local.size ?? "md";

	return (
		<button
			{...native}
			class={`inline-flex items-center justify-center gap-1.5 rounded-none font-medium transition focus-ring disabled:cursor-not-allowed ${VARIANT_CLASSES[variant()]} ${SIZE_CLASSES[size()]} ${local.class ?? ""}`}
		>
			{local.children}
		</button>
	);
};

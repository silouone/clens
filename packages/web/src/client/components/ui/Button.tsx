import { splitProps, type Component, type JSX } from "solid-js";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md";

type ButtonProps = {
	readonly variant?: ButtonVariant;
	readonly size?: ButtonSize;
	readonly children: JSX.Element;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
	primary:
		"bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600 disabled:opacity-50",
	secondary:
		"bg-surface-muted text-secondary hover:bg-surface-hover disabled:opacity-50",
	ghost:
		"text-gray-500 hover:bg-surface-hover hover:text-secondary text-muted disabled:opacity-40",
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
			class={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition focus-ring disabled:cursor-not-allowed ${VARIANT_CLASSES[variant()]} ${SIZE_CLASSES[size()]} ${local.class ?? ""}`}
		>
			{local.children}
		</button>
	);
};

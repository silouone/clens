import { Show, type Component, type JSX } from "solid-js";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

type BadgeProps = {
	readonly variant?: BadgeVariant;
	readonly children: JSX.Element;
	readonly class?: string;
	readonly dot?: boolean;
};

const VARIANT_CLASSES: Readonly<Record<BadgeVariant, string>> = {
	default:
		"bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
	success:
		"bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-400 dark:border-emerald-700/50",
	warning:
		"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50",
	danger:
		"bg-red-100 text-red-700 border-red-200 dark:bg-red-900/50 dark:text-red-400 dark:border-red-700/50",
	info:
		"bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/50 dark:text-blue-400 dark:border-blue-700/50",
} as const;

const DOT_CLASSES: Readonly<Record<BadgeVariant, string>> = {
	default: "bg-gray-500",
	success: "bg-emerald-500",
	warning: "bg-amber-500",
	danger: "bg-red-500",
	info: "bg-blue-500",
} as const;

export const Badge: Component<BadgeProps> = (props) => {
	const variant = () => props.variant ?? "default";

	return (
		<span
			class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant()]} ${props.class ?? ""}`}
		>
			<Show when={props.dot}>
				<span class={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASSES[variant()]}`} />
			</Show>
			{props.children}
		</span>
	);
};

import type { Component } from "solid-js";

type SpinnerSize = "sm" | "md" | "lg";

type SpinnerProps = {
	readonly size?: SpinnerSize;
};

const SIZE_CLASSES: Readonly<Record<SpinnerSize, string>> = {
	sm: "h-4 w-4 border-2",
	md: "h-8 w-8 border-2",
	lg: "h-12 w-12 border-[3px]",
} as const;

export const Spinner: Component<SpinnerProps> = (props) => {
	const size = () => props.size ?? "md";

	return (
		<div
			class={`animate-spin rounded-full border-gray-300 border-t-brand-500 dark:border-gray-700 dark:border-t-brand-400 ${SIZE_CLASSES[size()]}`}
			role="status"
			aria-label="Loading"
		/>
	);
};

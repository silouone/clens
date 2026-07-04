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
		<output
			class={`inline-block animate-spin rounded-none border-clens border-t-brand-500 ${SIZE_CLASSES[size()]}`}
			aria-label="Loading"
		/>
	);
};

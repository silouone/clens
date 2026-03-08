import type { Component } from "solid-js";

export const StatusBadge: Component<{ readonly complete: boolean }> = (props) => {
	const cls = () =>
		props.complete
			? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-400 dark:border-emerald-700/50"
			: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50";

	return (
		<span
			class={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls()}`}
		>
			{props.complete ? "complete" : "in progress"}
		</span>
	);
};

import type { Component } from "solid-js";
import { CheckCircle, Clock } from "lucide-solid";

/**
 * Unified status badge — accepts boolean `complete` OR string `status`.
 * Both APIs resolve to the same visual output.
 */
type StatusBadgeProps =
	| { readonly complete: boolean; readonly status?: never }
	| { readonly status: string; readonly complete?: never };

const isComplete = (props: StatusBadgeProps): boolean =>
	"complete" in props && props.complete !== undefined
		? props.complete
		: props.status === "complete";

const COMPLETE_CLS =
	"bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-400 dark:border-emerald-700/50";
const IN_PROGRESS_CLS =
	"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50";

export const StatusBadge: Component<StatusBadgeProps> = (props) => {
	const done = () => isComplete(props);
	const cls = () => (done() ? COMPLETE_CLS : IN_PROGRESS_CLS);

	return (
		<span
			class={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cls()}`}
		>
			{done() ? (
				<CheckCircle class="h-3 w-3" />
			) : (
				<Clock class="h-3 w-3" />
			)}
			{done() ? "complete" : "in progress"}
		</span>
	);
};

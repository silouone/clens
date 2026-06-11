import { Match, Switch, type Component } from "solid-js";
import { CheckCircle, Clock } from "lucide-solid";
import type { SessionStatus } from "../../../shared/types";

/**
 * Unified status badge — accepts boolean `complete` OR string `status`.
 *
 * The string form carries the live session status (bug B6): "complete" means the
 * session ended cleanly, "active" means it is still emitting events, "idle" means
 * it went quiet without ending. A boolean `complete` collapses to complete/idle.
 * When `compact` is true, renders as a small colored dot + short text.
 */
type StatusBadgeProps =
	| { readonly complete: boolean; readonly status?: never; readonly compact?: boolean }
	| { readonly status: string; readonly complete?: never; readonly compact?: boolean };

/** Resolve any prop form to one of the three canonical statuses. */
const resolveStatus = (props: StatusBadgeProps): SessionStatus => {
	if ("complete" in props && props.complete !== undefined) {
		return props.complete ? "complete" : "idle";
	}
	const s = props.status;
	if (s === "complete" || s === "active" || s === "idle") return s;
	// Legacy values: "incomplete" → idle, anything else → idle.
	return "idle";
};

const FULL_CLS: Record<SessionStatus, string> = {
	complete:
		"bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-400 dark:border-emerald-700/50",
	active:
		"bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/50 dark:text-amber-400 dark:border-amber-700/50",
	idle: "bg-surface-muted text-muted border-clens",
};

const DOT_CLS: Record<SessionStatus, string> = {
	complete: "bg-emerald-500 dark:bg-emerald-400",
	active: "bg-amber-500 dark:bg-amber-400 animate-pulse",
	idle: "bg-gray-400 dark:bg-gray-500",
};

const FULL_LABEL: Record<SessionStatus, string> = {
	complete: "complete",
	active: "active",
	idle: "idle",
};

const COMPACT_LABEL: Record<SessionStatus, string> = {
	complete: "done",
	active: "active",
	idle: "idle",
};

export const StatusBadge: Component<StatusBadgeProps> = (props) => {
	const status = (): SessionStatus => resolveStatus(props);

	return (
		<Switch>
			<Match when={props.compact}>
				<span class="inline-flex items-center gap-1 text-[10px] font-medium text-muted">
					<span class={`inline-block h-1.5 w-1.5 rounded-full ${DOT_CLS[status()]}`} />
					{COMPACT_LABEL[status()]}
				</span>
			</Match>
			<Match when={!props.compact}>
				<span
					class={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${FULL_CLS[status()]}`}
				>
					{status() === "complete" ? <CheckCircle class="h-3 w-3" /> : <Clock class="h-3 w-3" />}
					{FULL_LABEL[status()]}
				</span>
			</Match>
		</Switch>
	);
};

import { type Component, Match, Switch } from "solid-js";
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

// Instrument: square hairline chip, LED square + microcaps word — no pill, no
// colored badge wash. Signal-green = complete/ok, amber warning trace = active
// (lit, --live glow), graphite = idle (unlit).
const TEXT_CLS: Record<SessionStatus, string> = {
	complete: "text-[var(--clens-success)]",
	active: "text-[var(--clens-warning)]",
	idle: "text-muted",
};

const LED_CLS: Record<SessionStatus, string> = {
	complete: "bg-[var(--clens-success)]",
	active: "bg-[var(--clens-warning)] instrument-led--live animate-pulse",
	idle: "bg-[var(--clens-tick)]",
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
				<span
					class={`instrument-microcaps inline-flex items-center gap-1.5 text-[9px] ${TEXT_CLS[status()]}`}
				>
					<span class={`instrument-led ${LED_CLS[status()]}`} />
					{COMPACT_LABEL[status()]}
				</span>
			</Match>
			<Match when={!props.compact}>
				<span
					class={`instrument-microcaps inline-flex items-center gap-1.5 rounded-none border border-clens px-1.5 py-0.5 text-[9px] ${TEXT_CLS[status()]}`}
				>
					<span class={`instrument-led ${LED_CLS[status()]}`} />
					{FULL_LABEL[status()]}
				</span>
			</Match>
		</Switch>
	);
};

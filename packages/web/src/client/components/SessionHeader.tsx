import { Show, createSignal, type Component } from "solid-js";
import type { DistilledSession, SessionStatus } from "../../shared/types";
import { StatusBadge } from "./ui/StatusBadge";
import { DetailHeader } from "./DetailHeader";

// -- Types ----------------------------------------------------------------

type SessionHeaderProps = {
	readonly session: DistilledSession;
	// Raw-derived live status from the session list (bug B5/B6). When provided it
	// is authoritative over the distilled `complete` flag, which is frozen at
	// distill time and goes stale while a live session keeps running.
	readonly status?: SessionStatus;
	readonly onRedistill?: () => Promise<void>;
};

// -- Component ------------------------------------------------------------

export const SessionHeader: Component<SessionHeaderProps> = (props) => {
	const [distilling, setDistilling] = createSignal(false);

	return (
		<DetailHeader
			title={props.session.session_name ?? props.session.session_id.slice(0, 12)}
			action={
				<Show when={props.onRedistill}>
					<button
						onClick={async () => {
							setDistilling(true);
							try { await props.onRedistill?.(); }
							finally { setDistilling(false); }
						}}
						disabled={distilling()}
						class="instrument-microcaps rounded-none border border-clens bg-surface-inset px-2 py-1 text-[10px] text-secondary transition hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{distilling() ? "Re-analyzing..." : "Re-analyze"}
					</button>
				</Show>
			}
		>
			<Show
				when={props.status}
				fallback={<StatusBadge complete={props.session.complete} />}
			>
				{(status) => <StatusBadge status={status()} />}
			</Show>
		</DetailHeader>
	);
};

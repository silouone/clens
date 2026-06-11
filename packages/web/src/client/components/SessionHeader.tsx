import { Show, createSignal, type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { StatusBadge } from "./ui/StatusBadge";
import { DetailHeader } from "./DetailHeader";

// -- Types ----------------------------------------------------------------

type SessionHeaderProps = {
	readonly session: DistilledSession;
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
						class="rounded-md bg-surface-muted px-2 py-1 text-xs font-medium text-secondary transition hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{distilling() ? "Re-analyzing..." : "Re-analyze"}
					</button>
				</Show>
			}
		>
			<StatusBadge complete={props.session.complete} />
		</DetailHeader>
	);
};

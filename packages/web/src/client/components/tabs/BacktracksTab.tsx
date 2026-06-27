import { For, Show, type Component } from "solid-js";
import { formatRelTime } from "../../lib/format";
import { getSeverityStyle } from "../../lib/severity";
import type { TabProps } from "./types";

// ── BacktracksTab — Wave 0 carry-over (Wave 2 reworks) ───────────────
// Preserves the original BottomPanel backtrack list + the backtrack→timeline
// jump (R-F2). Wave 2 adds the shape-at-a-glance summary (R-C2, AC7).

const EmptyTab: Component<{ readonly message: string }> = (props) => (
	<div class="flex h-full items-center justify-center py-8">
		<span class="instrument-microcaps border border-clens px-3 py-1.5 text-[10px] text-muted">
			{props.message}
		</span>
	</div>
);

export const BacktracksTab: Component<TabProps> = (props) => {
	const backtracks = () => props.session.backtracks;
	const startTime = () => props.session.start_time ?? 0;

	return (
		<Show
			when={backtracks().length > 0}
			fallback={<EmptyTab message="No backtracks detected" />}
		>
			<div class="divide-y divide-clens">
				<For each={backtracks()}>
					{(bt) => (
						<button
							onClick={() => props.onBacktrackClick?.(bt.start_t)}
							class="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs transition hover:bg-surface-hover"
						>
							<span class="w-12 font-mono text-[10px] tabular-nums text-muted">
								{formatRelTime(bt.start_t, startTime())}
							</span>
							<span
								class={`instrument-microcaps rounded-none border px-1.5 py-0.5 text-[9px] ${getSeverityStyle(bt.type)}`}
							>
								{bt.type.replaceAll("_", " ")}
							</span>
							<span class="font-mono text-muted">{bt.tool_name}</span>
							<Show when={bt.file_path}>
								{(fp) => <span class="max-w-xs truncate font-mono text-muted">{fp()}</span>}
							</Show>
							<span class="ml-auto text-muted">
								{bt.attempts} attempt{bt.attempts !== 1 ? "s" : ""}
							</span>
						</button>
					)}
				</For>
			</div>
		</Show>
	);
};

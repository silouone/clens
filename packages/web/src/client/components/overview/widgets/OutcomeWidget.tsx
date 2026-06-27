import { Show, createMemo, type Component } from "solid-js";
import { Widget } from "../../ui/Widget";
import { MetaRow } from "../../ui/MetaRow";
import type { WidgetProps } from "../types";

// ── OutcomeWidget [outcome] — what landed on disk ────────────────────
//
// The git-level footprint of the session: commits, files modified, working-tree
// changes, and total +/− churn (additions green / deletions red) summed across
// committed hunks AND the uncommitted working tree (disjoint sets → safe to add).
// This is the GIT outcome, deliberately distinct from EditsWidget's tool-level
// edit churn. Honesty (R-D4): churn comes only from git_diff (file_map carries
// no line counts), and the whole widget empty-states when the run left no git
// footprint rather than rendering "0 of 0" noise (R-E1).

// Grouped thousands in deterministic en-US form (commas) so the mono tabular
// numerals (R-C6) read the same regardless of host locale.
const groupNum = (n: number): string => n.toLocaleString("en-US");

export const OutcomeWidget: Component<WidgetProps> = (props) => {
	const git = () => props.session.git_diff;

	const commits = () => git().commits.length;
	const filesModified = createMemo(
		() => props.session.file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length,
	);
	const workingTree = () => git().working_tree_changes?.length ?? 0;

	// Sum line churn across committed hunks + the uncommitted working tree. Both
	// hold required/optional additions+deletions; the two sets never overlap.
	const churn = createMemo(() => {
		const hunks = git().hunks ?? [];
		const wt = git().working_tree_changes ?? [];
		const additions =
			hunks.reduce((sum, h) => sum + h.additions, 0) +
			wt.reduce((sum, c) => sum + (c.additions ?? 0), 0);
		const deletions =
			hunks.reduce((sum, h) => sum + h.deletions, 0) +
			wt.reduce((sum, c) => sum + (c.deletions ?? 0), 0);
		return { additions, deletions };
	});

	const totalChurn = () => churn().additions + churn().deletions;
	const addPct = () => (totalChurn() > 0 ? (churn().additions / totalChurn()) * 100 : 0);

	const hasActivity = () =>
		commits() > 0 || workingTree() > 0 || filesModified() > 0 || totalChurn() > 0;

	return (
		<Widget category="outcome" title="Outcome" span={4}>
			<Show
				when={hasActivity()}
				fallback={<p class="text-xs italic text-muted">No git activity</p>}
			>
				<div class="space-y-3">
					{/* Churn — the colored pop: additions (green) vs deletions (red). */}
					<Show when={totalChurn() > 0}>
						<div>
							<div class="flex items-baseline gap-3">
								<span class="font-mono text-lg tabular-nums text-[var(--clens-success)]">
									+{groupNum(churn().additions)}
								</span>
								<span class="font-mono text-lg tabular-nums text-[var(--clens-danger)]">
									−{groupNum(churn().deletions)}
								</span>
							</div>
							{/* Proportion gauge — a 2-segment data bar, not a candy fill. */}
							<div class="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-none border border-clens">
								<div
									class="h-full shrink-0"
									style={{
										width: `${addPct()}%`,
										"background-color": "var(--clens-success)",
									}}
								/>
								<div
									class="h-full flex-1"
									style={{ "background-color": "var(--clens-danger)" }}
								/>
							</div>
							<div class="instrument-microcaps mt-1 flex justify-between text-[9px] text-muted">
								<span>Additions</span>
								<span>Deletions</span>
							</div>
						</div>
					</Show>

					<div class="space-y-1">
						<MetaRow label="Commits" value={commits()} />
						<MetaRow label="Files modified" value={filesModified()} />
						<Show when={git().working_tree_changes !== undefined}>
							<MetaRow label="Working tree" value={workingTree()} />
						</Show>
					</div>
				</div>
			</Show>
		</Widget>
	);
};

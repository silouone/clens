import { Show, createMemo, createSignal, type Component } from "solid-js";
import { Widget } from "../../ui/Widget";
import { FileList, buildFileRows, type FileRow } from "../../FileList";
import { computeClientRiskScores } from "../../../lib/risk";
import type { RiskLevel } from "../../../../shared/types";
import type { WidgetProps } from "../types";

// ── FilesWidget [edits] — compact modified-files (overview-moat-refactor) ──
//
// THE FIX for page bloat: the old Overview dumped ALL modified files inline
// (298 rows on the rich fixture → an ~18k-px scroll). This widget is COMPACT by
// contract — the top-N most-RELEVANT files (risk-scored) with +adds/−dels, a
// total-count header, and a HEIGHT-CAPPED expand that scrolls instead of dumping
// every row inline. The rows themselves reuse <FileList> (with per-file diff
// expansion) so this stays a thin, honest consumer of existing data.
//
// "Relevant" = risk first (backtracks / abandoned edits / failures bubble to the
// top), with buildFileRows' edits-first/alpha order as the stable tiebreak.

const TOP_N = 6;

// Risk ordering: high > medium > low > (unscored). Drives which files surface in
// the collapsed top-N — the riskiest churn is what a reviewer wants first.
const RISK_RANK: Readonly<Record<RiskLevel, number>> = { high: 3, medium: 2, low: 1 };
const riskRank = (level?: RiskLevel): number => (level ? RISK_RANK[level] : 0);

// buildFileRows returns EVERY valid path in the file_map, including read-only
// files. A widget titled "Modified Files" must count/show only files that were
// actually changed, so we filter its output before counting, sorting, slicing.
const isModified = (r: FileRow): boolean =>
	r.edits > 0 || r.additions > 0 || r.deletions > 0;

export const FilesWidget: Component<WidgetProps> = (props) => {
	const riskMap = createMemo(() => computeClientRiskScores(props.session));

	const rows = createMemo(() => {
		const modified = buildFileRows(props.session, riskMap()).filter(isModified);
		// Re-prioritise by risk; Array.sort is stable so the edits-first/alpha order
		// from buildFileRows is preserved within each risk tier.
		return [...modified].sort((a, b) => riskRank(b.riskLevel) - riskRank(a.riskLevel));
	});

	const [expanded, setExpanded] = createSignal(false);
	const shown = createMemo(() => (expanded() ? rows() : rows().slice(0, TOP_N)));
	const overflow = () => Math.max(0, rows().length - TOP_N);

	return (
		<Widget
			category="edits"
			title="Modified Files"
			span={6}
			headerRight={
				<Show when={rows().length > 0}>
					<span class="font-mono text-[10px] tabular-nums text-muted">
						{rows().length} {rows().length === 1 ? "file" : "files"}
					</span>
				</Show>
			}
		>
			<Show
				when={rows().length > 0}
				fallback={<p class="text-xs italic text-muted">No files modified</p>}
			>
				{/* Cancel the Widget's p-3 so FileList sits edge-to-edge (Card pattern). */}
				<div class="-m-3">
					{/* Height-cap when expanded so 298 rows scroll, never dump inline. */}
					<div class={expanded() ? "max-h-80 overflow-y-auto" : ""}>
						<FileList rows={shown()} />
					</div>
					<Show when={overflow() > 0}>
						<div class="border-t border-clens px-4 py-2">
							<button
								onClick={() => setExpanded((prev) => !prev)}
								class="instrument-microcaps rounded-none border border-clens px-2 py-0.5 text-[10px] text-muted transition hover:bg-surface-hover hover:text-secondary"
							>
								{expanded() ? "Show less" : `+${overflow()} more`}
							</button>
						</div>
					</Show>
				</div>
			</Show>
		</Widget>
	);
};

import { Show, createMemo, type Component } from "solid-js";
import { Widget } from "../../ui/Widget";
import { HorizontalBar } from "../../charts";
import { CATEGORY } from "../../../lib/categories";
import type { WidgetProps } from "../types";

// ── EditsWidget [edits] — churn + abandoned waste (R-C3, AC8) ─────────
//
// Surfaces edit churn at a glance, click-through → Edits tab:
//   • headline — chains / total edits / abandoned (exact mono counts, R-C6)
//   • most-churned FILES — chains aggregated by file_path (summed total_edits),
//     top 5. NOT raw chains: one file edited by several agents is several chains
//     but ONE churn bar; the per-chain list would show duplicate bars for the
//     same path (rich fixture: SessionList.tsx is 3 chains = 124 edits, 1 bar).
//   • abandoned-edit gauge — abandoned / total edits proportion.
//
// Single-channel by contract: abandoned "waste" is honestly a risk signal, but
// borrowing the risk hue is a cross-channel call left to the W3.1 coherence
// pass — a sliver in the edits color already reads as waste, and AC4 wants this
// to point cleanly back to "the edits widget".

const basename = (path: string): string => path.split("/").pop() || path;

type FileChurn = { readonly file_path: string; readonly edits: number };

const HeadlineStat: Component<{ readonly label: string; readonly value: number }> = (props) => (
	<div class="flex flex-col gap-0.5">
		<span class="font-mono text-lg leading-none tabular-nums text-primary">
			{props.value.toLocaleString()}
		</span>
		<span class="instrument-microcaps text-[9px] text-muted">{props.label}</span>
	</div>
);

export const EditsWidget: Component<WidgetProps> = (props) => {
	const chains = () => props.session.edit_chains?.chains ?? [];

	const totalEdits = createMemo(() => chains().reduce((sum, c) => sum + c.total_edits, 0));
	const abandoned = createMemo(() =>
		chains().reduce((sum, c) => sum + c.abandoned_edit_ids.length, 0),
	);
	const survived = createMemo(() => Math.max(0, totalEdits() - abandoned()));
	const abandonedPct = createMemo(() =>
		totalEdits() > 0 ? (abandoned() / totalEdits()) * 100 : 0,
	);

	// Most-churned FILES: aggregate chains by path (one file == one bar), top 5.
	const topFiles = createMemo<readonly FileChurn[]>(() => {
		const byPath = chains().reduce<Record<string, number>>(
			(acc, c) => ({ ...acc, [c.file_path]: (acc[c.file_path] ?? 0) + c.total_edits }),
			{},
		);
		return Object.entries(byPath)
			.map(([file_path, edits]) => ({ file_path, edits }))
			.sort((a, b) => b.edits - a.edits)
			.slice(0, 5);
	});

	return (
		<Widget
			category="edits"
			title="Edits"
			span={6}
			onClick={() => props.onNavigate?.("edits")}
		>
			<Show
				when={chains().length > 0}
				fallback={<p class="text-xs italic text-muted">No edits captured</p>}
			>
				{/* Headline — exact mono counts (R-C6, R-D4: never compacted). */}
				<div class="grid grid-cols-3 gap-2 border-b border-clens pb-3">
					<HeadlineStat label="Chains" value={chains().length} />
					<HeadlineStat label="Edits" value={totalEdits()} />
					<HeadlineStat label="Abandoned" value={abandoned()} />
				</div>

				{/* Most-churned files. */}
				<div class="pt-3">
					<p class="instrument-microcaps mb-1.5 text-[9px] text-muted">Most-churned files</p>
					<HorizontalBar
						data={topFiles()}
						label={(d) => basename(d.file_path)}
						value={(d) => d.edits}
						color={CATEGORY.edits.cssVar}
						tooltipLabel={(d) => `${d.file_path}: ${d.edits} edits`}
						ariaLabel="Most-churned files by edit count"
					/>
				</div>

				{/* Abandoned-edit gauge — share of all edits later abandoned. */}
				<Show when={totalEdits() > 0}>
					<div class="mt-3 border-t border-clens pt-3">
						<div class="mb-1 flex items-baseline justify-between text-xs">
							<span class="instrument-microcaps text-[9px] text-muted">Abandoned waste</span>
							<span class="font-mono tabular-nums text-secondary">
								{Math.round(abandonedPct())}%
							</span>
						</div>
						<div
							class="h-2 w-full overflow-hidden rounded-none border border-clens bg-surface-inset"
							role="img"
							aria-label={`${abandoned()} of ${totalEdits()} edits abandoned`}
						>
							<div
								class="h-full rounded-none"
								style={{
									width: `${abandonedPct()}%`,
									"background-color": CATEGORY.edits.cssVar,
								}}
							/>
						</div>
						<p class="mt-1 font-mono text-[10px] tabular-nums text-muted">
							{abandoned() === 0
								? "0 abandoned — clean run"
								: `${abandoned().toLocaleString()} abandoned · ${survived().toLocaleString()} survived`}
						</p>
					</div>
				</Show>
			</Show>
		</Widget>
	);
};

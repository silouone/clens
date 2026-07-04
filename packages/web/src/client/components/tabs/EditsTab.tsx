import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import type { EditChain, EditStep, TranscriptReasoning } from "../../../shared/types";
import { CATEGORY } from "../../lib/categories";
import { HorizontalBar } from "../charts";
import { Widget } from "../ui/Widget";
import type { TabProps } from "./types";

// ── EditsTab [edits] — churn overview + per-file chains (R-C3, AC8) ───
//
// Wave 2 rework. The old tab was a flat 386-row list that surfaced no shape.
// Now a GLANCEABLE summary sits above an improved detail list:
//   SUMMARY  — headline counts (files · edits · abandoned · backtrack-flagged
//              FILES, not chains), top-churned files (HorizontalBar aggregated
//              by file_path), and an abandoned-waste gauge (abandoned vs the
//              captured surviving partition).
//   DETAIL   — per-file chains sorted by churn desc, each with an outcome step
//              strip (shape at a glance); problem rows (backtrack/abandoned)
//              carry the risk left-rule so the eye lands on the bad files.
//              Expanding a row reveals the original step badges + the
//              click-to-expand thinking context (R-F2 — preserved verbatim).

const CHAIN_CAP = 40;
const TOP_FILES = 6;

const basename = (path: string): string => path.split("/").pop() || path;

/** tool_use_id → reasoning entry (no non-null assertion; FP filter+flatMap). */
const buildReasoningLookup = (
	reasoning: readonly TranscriptReasoning[],
): ReadonlyMap<string, TranscriptReasoning> =>
	new Map(
		reasoning.flatMap((r) => (r.tool_use_id !== undefined ? ([[r.tool_use_id, r]] as const) : [])),
	);

const truncateText = (text: string, maxLen: number): string =>
	text.length <= maxLen ? text : `${text.slice(0, maxLen)}...`;

// ── Per-chain step shape ─────────────────────────────────────────────

type StepKind = "success" | "failure" | "info" | "abandoned";

const KIND_COLOR: Readonly<Record<StepKind, string>> = {
	success: "var(--clens-success)",
	failure: "var(--clens-danger)",
	info: "var(--clens-text-muted)",
	abandoned: "var(--clens-warning)",
};

const stepKind = (step: EditStep, abandoned: ReadonlySet<string>): StepKind =>
	abandoned.has(step.tool_use_id)
		? "abandoned"
		: step.outcome === "failure"
			? "failure"
			: step.outcome === "success"
				? "success"
				: "info";

// Reads (info) are deliberately excluded from the strip: a chain is ~⅓ reads,
// and the gray would compress the edit-outcome shape the strip exists to show.
const STRIP_ORDER: readonly StepKind[] = ["success", "failure", "abandoned"] as const;

type StepCounts = Readonly<Record<StepKind, number>>;

const countSteps = (steps: readonly EditStep[], abandoned: ReadonlySet<string>): StepCounts =>
	steps.reduce<StepCounts>(
		(acc, s) => {
			const k = stepKind(s, abandoned);
			return { ...acc, [k]: acc[k] + 1 };
		},
		{ success: 0, failure: 0, info: 0, abandoned: 0 },
	);

/** Segmented outcome strip — the per-file shape, glanceable without expanding. */
const StepStrip: Component<{ readonly counts: StepCounts; readonly total: number }> = (props) => (
	<div
		class="flex h-1.5 w-full overflow-hidden rounded-none border border-clens bg-surface-inset"
		role="img"
		aria-label="Step outcome distribution"
	>
		<For each={STRIP_ORDER}>
			{(kind) => (
				<Show when={props.counts[kind] > 0}>
					<div
						style={{
							width: `${props.total > 0 ? (props.counts[kind] / props.total) * 100 : 0}%`,
							"background-color": KIND_COLOR[kind],
						}}
					/>
				</Show>
			)}
		</For>
	</div>
);

const EmptyTab: Component<{ readonly message: string }> = (props) => (
	<div class="flex h-full items-center justify-center py-8">
		<span class="instrument-microcaps border border-clens px-3 py-1.5 text-[10px] text-muted">
			{props.message}
		</span>
	</div>
);

// ── Summary ──────────────────────────────────────────────────────────

type FileChurn = { readonly file_path: string; readonly edits: number };

const SummaryStat: Component<{
	readonly label: string;
	readonly value: number;
	readonly color?: string;
}> = (props) => (
	<div class="flex flex-col gap-0.5">
		<span
			class="font-mono text-lg leading-none tabular-nums"
			style={{ color: props.color ?? "var(--clens-text-primary)" }}
		>
			{props.value.toLocaleString()}
		</span>
		<span class="instrument-microcaps text-[9px] text-muted">{props.label}</span>
	</div>
);

const ChurnSummary: Component<{ readonly chains: readonly EditChain[] }> = (props) => {
	const distinctFiles = createMemo(() => new Set(props.chains.map((c) => c.file_path)).size);
	const totalEdits = createMemo(() => props.chains.reduce((s, c) => s + c.total_edits, 0));
	const abandoned = createMemo(() =>
		props.chains.reduce((s, c) => s + c.abandoned_edit_ids.length, 0),
	);
	const survived = createMemo(() =>
		props.chains.reduce((s, c) => s + c.surviving_edit_ids.length, 0),
	);
	const gaugeDenom = createMemo(() => survived() + abandoned());
	const abandonedPct = createMemo(() =>
		gaugeDenom() > 0 ? (abandoned() / gaugeDenom()) * 100 : 0,
	);
	// Backtrack-flagged FILES (distinct paths), NOT chains — one file may be many
	// chains; labeling the chain count "files" would mislabel (R-D4).
	const flaggedFiles = createMemo(
		() => new Set(props.chains.filter((c) => c.has_backtrack).map((c) => c.file_path)).size,
	);

	const topFiles = createMemo<readonly FileChurn[]>(() => {
		const byPath = props.chains.reduce<Record<string, number>>(
			(acc, c) => ({ ...acc, [c.file_path]: (acc[c.file_path] ?? 0) + c.total_edits }),
			{},
		);
		return Object.entries(byPath)
			.map(([file_path, edits]) => ({ file_path, edits }))
			.sort((a, b) => b.edits - a.edits)
			.slice(0, TOP_FILES);
	});

	return (
		<Widget category="edits" title="Edit Churn">
			{/* Headline — exact mono counts (R-C6, R-D4: never compacted). */}
			<div class="grid grid-cols-4 gap-2 border-b border-clens pb-3">
				<SummaryStat label="Files" value={distinctFiles()} />
				<SummaryStat label="Edits" value={totalEdits()} />
				<SummaryStat
					label="Abandoned"
					value={abandoned()}
					color={abandoned() > 0 ? "var(--clens-warning)" : undefined}
				/>
				<SummaryStat
					label="Backtrack files"
					value={flaggedFiles()}
					color={flaggedFiles() > 0 ? CATEGORY.risk.cssVar : undefined}
				/>
			</div>

			{/* Top-churned files — one bar per FILE (chains aggregated by path). */}
			<div class="pt-3">
				<p class="instrument-microcaps mb-1.5 text-[10px] text-muted">Most-churned files</p>
				<HorizontalBar
					data={topFiles()}
					label={(d) => basename(d.file_path)}
					value={(d) => d.edits}
					color={CATEGORY.edits.cssVar}
					tooltipLabel={(d) => `${d.file_path}: ${d.edits} edits`}
					ariaLabel="Most-churned files by edit count"
				/>
			</div>

			{/* Abandoned-waste gauge — share of captured edits later abandoned. */}
			<Show when={gaugeDenom() > 0}>
				<div class="mt-3 border-t border-clens pt-3">
					<div class="mb-1 flex items-baseline justify-between text-xs">
						<span class="instrument-microcaps text-[10px] text-muted">Abandoned waste</span>
						<span class="font-mono tabular-nums text-secondary">{Math.round(abandonedPct())}%</span>
					</div>
					<div
						class="h-2 w-full overflow-hidden rounded-none border border-clens bg-surface-inset"
						role="img"
						aria-label={`${abandoned()} of ${gaugeDenom()} edits abandoned`}
					>
						<div
							class="h-full rounded-none"
							style={{
								width: `${abandonedPct()}%`,
								"background-color": "var(--clens-warning)",
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
		</Widget>
	);
};

// ── Detail — per-file chains ─────────────────────────────────────────

const ChainRow: Component<{
	readonly chain: EditChain;
	readonly expanded: boolean;
	readonly onToggle: () => void;
	readonly reasoningMap: ReadonlyMap<string, TranscriptReasoning>;
	readonly expandedStep: string | undefined;
	readonly onToggleStep: (id: string) => void;
}> = (props) => {
	const abandonedSet = createMemo(() => new Set(props.chain.abandoned_edit_ids));
	const counts = createMemo(() => countSteps(props.chain.steps, abandonedSet()));
	// Strip proportions are over EDIT outcomes only (reads excluded, see STRIP_ORDER).
	const editTotal = createMemo(() => {
		const c = counts();
		return c.success + c.failure + c.abandoned;
	});
	const isProblem = () => props.chain.has_backtrack || props.chain.abandoned_edit_ids.length > 0;

	return (
		<div class={`px-3 py-1.5 ${isProblem() ? CATEGORY.risk.ruleClass : ""}`}>
			<button
				type="button"
				onClick={props.onToggle}
				class="flex w-full items-center gap-2 text-left focus-ring"
				aria-expanded={props.expanded}
			>
				<span class="flex-1 truncate font-mono text-xs text-secondary">
					{props.chain.file_path}
				</span>
				<span class="font-mono text-[10px] tabular-nums text-muted">
					{props.chain.total_edits} edit{props.chain.total_edits !== 1 ? "s" : ""}
				</span>
				<span class="font-mono text-[10px] tabular-nums text-muted">
					{props.chain.total_reads} read{props.chain.total_reads !== 1 ? "s" : ""}
				</span>
				<Show when={props.chain.has_backtrack}>
					<span
						class="instrument-microcaps rounded-none border px-1 py-0.5 text-[9px]"
						style={{ color: CATEGORY.risk.cssVar, "border-color": CATEGORY.risk.cssVar }}
					>
						backtrack
					</span>
				</Show>
			</button>

			{/* Outcome shape — visible without expanding. */}
			<Show when={editTotal() > 0}>
				<div class="mt-1">
					<StepStrip counts={counts()} total={editTotal()} />
				</div>
			</Show>

			{/* Expanded — original step badges + thinking context (R-F2). */}
			<Show when={props.expanded}>
				<div class="mt-1.5 flex flex-wrap gap-1">
					<For each={props.chain.steps}>
						{(step) => {
							const isAbandoned = abandonedSet().has(step.tool_use_id);
							const hasThinking = () => props.reasoningMap.has(step.tool_use_id);
							const isStepExpanded = () => props.expandedStep === step.tool_use_id;

							return (
								<div class="inline-flex flex-col">
									<button
										type="button"
										onClick={() =>
											hasThinking() ? props.onToggleStep(step.tool_use_id) : undefined
										}
										class="inline-flex items-center gap-0.5 rounded-none border px-1 py-0.5 font-mono text-[11px]"
										classList={{
											"border-clens bg-surface-raised text-[var(--clens-success)]":
												step.outcome === "success" && !isAbandoned,
											"border-clens bg-surface-raised text-[var(--clens-danger)]":
												step.outcome === "failure",
											"border-clens bg-surface-raised text-muted": step.outcome === "info",
											"line-through opacity-50": isAbandoned,
											"cursor-pointer hover:bg-surface-hover": hasThinking(),
											"cursor-default": !hasThinking(),
										}}
									>
										{step.tool_name}
										{isAbandoned ? " (abandoned)" : ""}
										<Show when={hasThinking()}>
											<span class="text-[11px] text-brand-500" title="Has thinking context">
												&#x1D4D5;
											</span>
										</Show>
									</button>
									<Show when={isStepExpanded() && props.reasoningMap.get(step.tool_use_id)}>
										{(r) => (
											<div class="mt-0.5 max-w-xs whitespace-pre-wrap rounded-none border border-clens bg-surface-inset px-2 py-1 text-[10px] text-secondary">
												{truncateText(r().thinking, 200)}
											</div>
										)}
									</Show>
								</div>
							);
						}}
					</For>
				</div>
			</Show>
		</div>
	);
};

export const EditsTab: Component<TabProps> = (props) => {
	const chains = () => props.session.edit_chains?.chains ?? [];
	const reasoningMap = createMemo(() => buildReasoningLookup(props.session.reasoning ?? []));
	const [expandedStep, setExpandedStep] = createSignal<string | undefined>();
	// Sparse fixtures (≤3 chains) open by default so the state isn't inert (R-E1).
	const [expandedChains, setExpandedChains] = createSignal<ReadonlySet<number>>(
		chains().length <= 3 ? new Set(chains().map((_, i) => i)) : new Set(),
	);
	const [showAll, setShowAll] = createSignal(false);

	const toggleStep = (toolUseId: string) =>
		setExpandedStep((prev) => (prev === toolUseId ? undefined : toolUseId));

	const toggleChain = (idx: number) =>
		setExpandedChains((prev) =>
			prev.has(idx) ? new Set([...prev].filter((i) => i !== idx)) : new Set([...prev, idx]),
		);

	// Problem-first, then churn-desc (derived ordering; allowed). The whole point
	// of the rework is to make problems pop — backtrack/abandoned chains sort
	// ABOVE high-churn-but-clean ones so they're never buried under the cap.
	const problemRank = (c: EditChain): number =>
		c.has_backtrack || c.abandoned_edit_ids.length > 0 ? 1 : 0;
	const sorted = createMemo<readonly EditChain[]>(() =>
		[...chains()].sort(
			(a, b) =>
				problemRank(b) - problemRank(a) ||
				b.total_edits - a.total_edits ||
				b.abandoned_edit_ids.length - a.abandoned_edit_ids.length,
		),
	);
	const visible = createMemo(() => (showAll() ? sorted() : sorted().slice(0, CHAIN_CAP)));
	const hidden = createMemo(() => Math.max(0, sorted().length - visible().length));

	return (
		<Show when={chains().length > 0} fallback={<EmptyTab message="No edit chains" />}>
			<div class="space-y-3 p-3">
				<ChurnSummary chains={chains()} />

				<div class="border border-clens bg-surface-raised">
					<p class="instrument-microcaps border-b border-clens px-3 py-2 text-[10px] text-muted">
						Chains · problems first, then churn
					</p>
					<div class="divide-y divide-clens">
						<For each={visible()}>
							{(chain, i) => (
								<ChainRow
									chain={chain}
									expanded={expandedChains().has(i())}
									onToggle={() => toggleChain(i())}
									reasoningMap={reasoningMap()}
									expandedStep={expandedStep()}
									onToggleStep={toggleStep}
								/>
							)}
						</For>
					</div>
					<Show when={hidden() > 0}>
						<button
							type="button"
							onClick={() => setShowAll(true)}
							class="instrument-microcaps w-full border-t border-clens px-3 py-2 text-[10px] text-muted hover:bg-surface-hover focus-ring"
						>
							Show {hidden().toLocaleString()} more
						</button>
					</Show>
				</div>
			</div>
		</Show>
	);
};

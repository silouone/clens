import { type Component, createMemo, createSignal, Show } from "solid-js";
import type { DistilledSession } from "../../../shared/types";
import { CATEGORY } from "../../lib/categories";
import { formatCost, formatDuration, truncateMultiline } from "../../lib/format";
import { renderPlainText } from "../../lib/markdown";
import { sessionVerdict } from "../../lib/verdict";
import { StatTile } from "../ui/StatTile";

// ── HeroBand (overview-moat-refactor, Wave 0) ────────────────────────
//
// The dominant above-the-fold block (R-A1/R-A2): the answer to "what happened"
// — request (verbatim), outcome verdict, promoted narrative, and a health strip
// of category StatTiles — rendered BEFORE the widget grid. Wave 1 finalizes
// verdict prominence + show-more polish; this is the real foundation, not a stub.

type HeroBandProps = {
	readonly session: DistilledSession;
};

// ── Pure request helpers (lifted from SessionOverview) ───────────────

const stripHtml = (text: string): string => text.replace(/<[^>]+>/g, "");

const findFirstPrompt = (messages: DistilledSession["user_messages"]): string | undefined => {
	const msg = messages.find((m) => !m.message_type || m.message_type === "prompt");
	if (!msg) return undefined;
	const clean = stripHtml(msg.content).trim();
	return clean.length > 0 ? clean : undefined;
};

export const HeroBand: Component<HeroBandProps> = (props) => {
	const session = () => props.session;
	const [expanded, setExpanded] = createSignal(false);

	const verdict = createMemo(() => sessionVerdict(session()));
	const verdictColor = () => CATEGORY[verdict().category].cssVar;
	// The sanctioned colored left-rule (inset shadow, not a banned drop-shadow)
	// channels the WHOLE band in the verdict's hue so the outcome is the first
	// thing the eye lands on (R-B2). Literal in categories.ts → JIT emits it.
	const verdictRule = () => CATEGORY[verdict().category].ruleClass;

	// -- Request (verbatim, show-more) ----------------------------------
	const rawPrompt = createMemo(() => findFirstPrompt(session().user_messages));
	const truncated = createMemo(() => {
		const text = rawPrompt();
		if (!text) return { text: "", truncated: false };
		return truncateMultiline(text, 3);
	});
	const displayText = () => (expanded() ? (rawPrompt() ?? "") : truncated().text);

	// -- Narrative ------------------------------------------------------
	const narrative = () => session().summary?.narrative;
	const hasNarrative = createMemo(() => {
		const n = narrative();
		return n !== undefined && n.length > 0;
	});

	// -- Health strip values --------------------------------------------
	// Wall span is the headline (matches the session list, locked B2 semantic);
	// active = idle-trimmed working time, surfaced as a sub-line so the tile
	// reconciles with the "what happened" narrative instead of contradicting it.
	const durationMs = () => session().stats.wall_duration_ms ?? session().stats.duration_ms;
	const activeMs = () => session().summary?.key_metrics.active_duration_ms;
	const cost = () => (session().cost_estimate ?? session().stats.cost_estimate)?.estimated_cost_usd;
	const costIsEstimated = () =>
		(session().cost_estimate ?? session().stats.cost_estimate)?.is_estimated;
	const toolCalls = () =>
		session().summary?.key_metrics.tool_calls ?? session().stats.tool_call_count;
	const backtracks = () => session().backtracks.length;
	const ctxPeak = () => session().context_consumption?.peak_context_pct;

	return (
		<div
			class={`animate-fade-in rounded-none border border-clens bg-surface-raised ${verdictRule()}`}
		>
			<div class="flex flex-col gap-3 p-3">
				{/* Verdict — the dominant above-the-fold answer (R-A1/R-B2, AC2):
				    a large category LED square + a big microcaps label in the
				    verdict hue + one honest one-line detail. */}
				<div class="flex items-center gap-3">
					<span
						class="instrument-led"
						style={{
							"background-color": verdictColor(),
							width: "1.75rem",
							height: "1.75rem",
						}}
						aria-hidden="true"
					/>
					<div class="flex min-w-0 flex-col gap-1">
						<span
							class="instrument-microcaps text-xl font-semibold leading-none"
							style={{ color: verdictColor() }}
						>
							{verdict().label}
						</span>
						<span class="text-sm leading-snug text-muted">{verdict().detail}</span>
					</div>
				</div>

				{/* Request — rendered VERBATIM (R-D2 / bug B16) */}
				<div>
					<h4 class="instrument-microcaps mb-1 text-[10px] text-muted">Request</h4>
					<Show
						when={rawPrompt()}
						fallback={<p class="text-sm italic text-muted">No prompt captured</p>}
					>
						<div
							class="prose-sm-dark whitespace-pre-wrap break-words text-sm text-secondary"
							innerHTML={renderPlainText(displayText())}
						/>
						<Show when={truncated().truncated}>
							<button
								type="button"
								onClick={() => setExpanded((prev) => !prev)}
								class="instrument-microcaps text-[10px] text-brand-500 transition hover:text-brand-600 dark:text-brand-400"
							>
								{expanded() ? "Show less" : "Show more"}
							</button>
						</Show>
					</Show>
				</div>

				{/* Promoted narrative — "what happened" (verbatim, never markdown) */}
				<Show when={hasNarrative()}>
					<div>
						<h4 class="instrument-microcaps mb-1 text-[10px] text-muted">What Happened</h4>
						<div
							class="prose-sm-dark text-sm leading-relaxed text-muted"
							innerHTML={renderPlainText(narrative() ?? "")}
						/>
					</div>
				</Show>

				{/* Health strip — category StatTiles */}
				<div class="flex flex-wrap gap-2 pt-1">
					<StatTile
						category="timing"
						label="Duration"
						value={formatDuration(durationMs())}
						sub={activeMs() !== undefined ? `${formatDuration(activeMs() ?? 0)} active` : undefined}
					/>
					<Show when={cost() !== undefined}>
						<StatTile
							category="cost"
							label="Cost"
							value={formatCost(cost() ?? 0, costIsEstimated())}
						/>
					</Show>
					<StatTile category="outcome" label="Tool Calls" value={toolCalls()} />
					<StatTile category="risk" label="Backtracks" value={backtracks()} />
					<Show when={ctxPeak() !== undefined}>
						<StatTile
							category="context"
							label="Context Peak"
							value={`${Math.round(ctxPeak() ?? 0)}%`}
						/>
					</Show>
				</div>
			</div>
		</div>
	);
};

import { createMemo, For, Show, type Component } from "solid-js";
import { Brain } from "lucide-solid";
import type { DistilledSession } from "../../shared/types";
import { formatPercentage } from "../lib/format";
import { Card } from "./ui/Card";

// ── Types ────────────────────────────────────────────────────────────

type ThinkingBreakdownProps = {
	readonly session: DistilledSession;
};

type IntentRow = {
	readonly intent: string;
	readonly count: number;
	readonly pct: number;
};

// ── Intent bar colors ───────────────────────────────────────────────

// Instrument trace colors — graphite ramp for neutral intents, status tokens
// reserved for debugging (danger) and deciding (warning).
const INTENT_COLORS: Readonly<Record<string, string>> = {
	planning: "bg-[var(--clens-text-secondary)]",
	research: "bg-[var(--clens-text-muted)]",
	debugging: "bg-[var(--clens-danger)]",
	deciding: "bg-[var(--clens-warning)]",
	general: "bg-[var(--clens-tick)]",
};

const getIntentBarClass = (intent: string): string =>
	INTENT_COLORS[intent] ?? "bg-[var(--clens-tick)]";

// ── Pure helpers ─────────────────────────────────────────────────────

/** Aggregate reasoning blocks by intent_hint and return sorted rows. */
const buildIntentRows = (session: DistilledSession): readonly IntentRow[] => {
	const reasoning = session.reasoning;
	if (reasoning.length === 0) return [];

	const counts = reasoning.reduce(
		(acc, r) => {
			const intent = r.intent_hint ?? "general";
			return { ...acc, [intent]: (acc[intent] ?? 0) + 1 };
		},
		{} as Readonly<Record<string, number>>,
	);

	const total = reasoning.length;
	const maxCount = Math.max(...Object.values(counts));

	return Object.entries(counts)
		.map(([intent, count]) => ({
			intent,
			count,
			pct: maxCount > 0 ? (count / maxCount) * 100 : 0,
		}))
		.sort((a, b) => b.count - a.count);
};

// ── Component ────────────────────────────────────────────────────────

export const ThinkingBreakdown: Component<ThinkingBreakdownProps> = (props) => {
	const rows = createMemo(() => buildIntentRows(props.session));
	const total = createMemo(() => props.session.reasoning.length);

	return (
		<Show when={rows().length > 0}>
			<Card class="p-3">
				<div class="mb-3 flex items-center gap-2">
					<Brain class="h-4 w-4 text-muted" />
					<h3 class="instrument-microcaps text-[11px] text-muted">
						Thinking Patterns
					</h3>
					<span class="text-[11px] text-muted">(keyword heuristic)</span>
				</div>

				<div class="space-y-2.5">
					<For each={rows()}>
						{(row) => (
							<div class="flex items-center gap-3 text-xs">
								{/* Label */}
								<span class="w-20 shrink-0 text-right font-medium capitalize text-muted">
									{row.intent}
								</span>

								{/* Bar — square instrument trace */}
								<div class="min-w-16 flex-1 rounded-none bg-surface-inset h-2.5 border border-clens">
									<div
										class={`h-full rounded-none transition-all ${getIntentBarClass(row.intent)}`}
										style={{ width: `${Math.max(row.pct, 4)}%`, "min-width": "0.5rem" }}
									/>
								</div>

								{/* Count + Percentage */}
								<span class="w-16 shrink-0 text-right font-mono tabular-nums text-muted">
									{row.count} ({formatPercentage(row.count, total())})
								</span>
							</div>
						)}
					</For>
				</div>
			</Card>
		</Show>
	);
};

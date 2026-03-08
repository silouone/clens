import { createMemo, For, Show, type Component } from "solid-js";
import type { DistilledSession } from "../../shared/types";
import { formatPercentage } from "../lib/format";

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

const INTENT_COLORS: Readonly<Record<string, string>> = {
	planning: "bg-violet-500 dark:bg-violet-400",
	research: "bg-blue-500 dark:bg-blue-400",
	debugging: "bg-red-500 dark:bg-red-400",
	deciding: "bg-amber-500 dark:bg-amber-400",
	general: "bg-gray-400 dark:bg-gray-500",
};

const getIntentBarClass = (intent: string): string =>
	INTENT_COLORS[intent] ?? "bg-gray-400 dark:bg-gray-500";

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
			<div class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/50">
				<h3 class="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
					Thinking Patterns
				</h3>

				<div class="space-y-2.5">
					<For each={rows()}>
						{(row) => (
							<div class="flex items-center gap-3 text-xs">
								{/* Label */}
								<span class="w-20 shrink-0 text-right font-medium capitalize text-gray-600 dark:text-gray-400">
									{row.intent}
								</span>

								{/* Bar */}
								<div class="min-w-16 flex-1 rounded-full bg-gray-100 dark:bg-gray-800 h-2.5">
									<div
										class={`h-2.5 rounded-full transition-all ${getIntentBarClass(row.intent)}`}
										style={{ width: `${Math.max(row.pct, 4)}%`, "min-width": "0.5rem" }}
									/>
								</div>

								{/* Count + Percentage */}
								<span class="w-16 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">
									{row.count} ({formatPercentage(row.count, total())})
								</span>
							</div>
						)}
					</For>
				</div>
			</div>
		</Show>
	);
};

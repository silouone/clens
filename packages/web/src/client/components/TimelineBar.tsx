import { For, Show, type Component } from "solid-js";
import type { PhaseInfo } from "../../shared/types";

// ── Phase color palette ──────────────────────────────────────────────

const PHASE_COLORS: Readonly<Record<string, string>> = {
	// Single-agent phases (from phaseNameFromTool)
	"file exploration": "bg-sky-600",
	"code modification": "bg-emerald-600",
	research: "bg-indigo-600",
	debugging: "bg-red-600",
	general: "bg-gray-500",
	// Team phases (from buildTeamPhases)
	planning: "bg-violet-600",
	build: "bg-emerald-600",
	validation: "bg-amber-600",
};

const DEFAULT_COLOR = "bg-gray-600";

const getPhaseColor = (name: string): string =>
	PHASE_COLORS[name.toLowerCase()] ?? DEFAULT_COLOR;

// ── Types ────────────────────────────────────────────────────────────

type TimelineBarProps = {
	readonly phases: readonly PhaseInfo[];
	readonly totalDuration: number;
	readonly onPhaseClick?: (phaseIndex: number) => void;
};

// ── Component ────────────────────────────────────────────────────────

export const TimelineBar: Component<TimelineBarProps> = (props) => {
	const segmentWidth = (phase: PhaseInfo): number => {
		if (props.totalDuration <= 0) return 0;
		const duration = phase.end_t - phase.start_t;
		return Math.max(2, (duration / props.totalDuration) * 100);
	};

	return (
		<Show when={props.phases.length > 0}>
			<div class="flex h-6 w-full overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
				<For each={props.phases}>
					{(phase, i) => (
						<button
							class={`relative flex items-center justify-center overflow-hidden text-[10px] font-medium text-white/80 transition-opacity hover:opacity-80 ${getPhaseColor(phase.name)}`}
							style={{ width: `${segmentWidth(phase)}%` }}
							onClick={() => props.onPhaseClick?.(i())}
							title={`${phase.name}: ${phase.description}`}
							aria-label={`Phase: ${phase.name}`}
						>
							<span class="truncate px-1">{phase.name}</span>
						</button>
					)}
				</For>
			</div>
		</Show>
	);
};

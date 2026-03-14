import { createSignal, For, Show, type Component } from "solid-js";
import type { PhaseInfo } from "../../shared/types";

// ── Phase color palette ──────────────────────────────────────────────

const PHASE_COLORS: Readonly<Record<string, string>> = {
	// Single-agent phases
	"file exploration": "bg-sky-500",
	"code modification": "bg-emerald-500",
	research: "bg-blue-500",
	debugging: "bg-red-500",
	general: "bg-gray-400",
	// Team phases
	planning: "bg-violet-500",
	build: "bg-emerald-500",
	validation: "bg-amber-500",
};

const PHASE_DOT_COLORS: Readonly<Record<string, string>> = {
	"file exploration": "bg-sky-400",
	"code modification": "bg-emerald-400",
	research: "bg-blue-400",
	debugging: "bg-red-400",
	general: "bg-gray-400",
	planning: "bg-violet-400",
	build: "bg-emerald-400",
	validation: "bg-amber-400",
};

const DEFAULT_COLOR = "bg-gray-500";

const getPhaseColor = (name: string): string =>
	PHASE_COLORS[name.toLowerCase()] ?? DEFAULT_COLOR;

const getPhaseDotColor = (name: string): string =>
	PHASE_DOT_COLORS[name.toLowerCase()] ?? DEFAULT_COLOR;

// ── Types ────────────────────────────────────────────────────────────

type TimelineBarProps = {
	readonly phases: readonly PhaseInfo[];
	readonly totalDuration: number;
	readonly onPhaseClick?: (phaseIndex: number) => void;
};

// ── Component ────────────────────────────────────────────────────────

export const TimelineBar: Component<TimelineBarProps> = (props) => {
	const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null);

	const segmentWidth = (phase: PhaseInfo): number => {
		if (props.totalDuration <= 0) return 0;
		const duration = phase.end_t - phase.start_t;
		return Math.max(3, (duration / props.totalDuration) * 100);
	};

	const hoveredPhase = () => {
		const idx = hoveredIndex();
		if (idx === null) return null;
		return props.phases[idx] ?? null;
	};

	return (
		<Show when={props.phases.length > 0}>
			<div class="flex items-center gap-2">
				{/* Compact segmented bar */}
				<div
					class="flex h-1.5 w-32 overflow-hidden rounded-full"
					onMouseLeave={() => setHoveredIndex(null)}
				>
					<For each={props.phases}>
						{(phase, i) => (
							<button
								class={`relative transition-opacity ${getPhaseColor(phase.name)} ${
									hoveredIndex() !== null && hoveredIndex() !== i() ? "opacity-40" : "opacity-80"
								}`}
								style={{ width: `${segmentWidth(phase)}%` }}
								onClick={() => props.onPhaseClick?.(i())}
								onMouseEnter={() => setHoveredIndex(i())}
								title={`${phase.name}: ${phase.description}`}
								aria-label={`Phase: ${phase.name}`}
							/>
						)}
					</For>
				</div>

				{/* Phase legend — shows hovered phase or all phases as dots */}
				<Show
					when={hoveredPhase()}
					fallback={
						<div class="flex items-center gap-1.5">
							<For each={props.phases}>
								{(phase) => (
									<div class="flex items-center gap-0.5">
										<span class={`inline-block h-1.5 w-1.5 rounded-full ${getPhaseDotColor(phase.name)}`} />
										<span class="text-[9px] text-gray-400 capitalize">{phase.name}</span>
									</div>
								)}
							</For>
						</div>
					}
				>
					{(phase) => (
						<div class="flex items-center gap-1">
							<span class={`inline-block h-1.5 w-1.5 rounded-full ${getPhaseDotColor(phase().name)}`} />
							<span class="text-[10px] font-medium text-gray-500 capitalize dark:text-gray-400">
								{phase().name}
							</span>
							<span class="text-[10px] text-gray-400 dark:text-gray-500">
								{phase().description}
							</span>
						</div>
					)}
				</Show>
			</div>
		</Show>
	);
};

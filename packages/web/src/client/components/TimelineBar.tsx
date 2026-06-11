import { createSignal, For, Show, type Component } from "solid-js";
import type { PhaseInfo } from "../../shared/types";

// ── Phase color palette ──────────────────────────────────────────────
//
// INSTRUMENT: phase traces derive from the token ramp (signal green for
// active/build, amber for validation/warnings, danger for debugging,
// graphite for neutral phases). Returned as CSS vars so segments/LED dots
// are styled via inline background-color and track both modes.

const PHASE_COLORS: Readonly<Record<string, string>> = {
	// Single-agent phases
	"file exploration": "var(--clens-text-secondary)",
	"code modification": "var(--clens-brand)",
	research: "var(--clens-text-muted)",
	debugging: "var(--clens-danger)",
	general: "var(--clens-tick)",
	// Team phases
	planning: "var(--clens-text-secondary)",
	build: "var(--clens-brand)",
	validation: "var(--clens-warning)",
};

const DEFAULT_COLOR = "var(--clens-tick)";

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
					class="flex h-3 w-48 overflow-hidden rounded-none border border-clens"
					role="img"
					aria-label={`Timeline: ${props.phases.map((p) => p.name).join(", ")}`}
					onMouseLeave={() => setHoveredIndex(null)}
				>
					<For each={props.phases}>
						{(phase, i) => (
							<button
								class={`relative transition-opacity ${
									hoveredIndex() !== null && hoveredIndex() !== i() ? "opacity-40" : "opacity-90"
								}`}
								style={{
									width: `${segmentWidth(phase)}%`,
									"background-color": getPhaseColor(phase.name),
								}}
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
										<span
											class="instrument-led"
											style={{ "background-color": getPhaseColor(phase.name) }}
										/>
										<span class="instrument-microcaps text-[10px] text-muted">{phase.name}</span>
									</div>
								)}
							</For>
						</div>
					}
				>
					{(phase) => (
						<div class="flex items-center gap-1">
							<span
								class="instrument-led"
								style={{ "background-color": getPhaseColor(phase().name) }}
							/>
							<span class="instrument-microcaps text-[10px] text-muted">
								{phase().name}
							</span>
							<span class="text-[10px] text-muted">
								{phase().description}
							</span>
						</div>
					)}
				</Show>
			</div>
		</Show>
	);
};

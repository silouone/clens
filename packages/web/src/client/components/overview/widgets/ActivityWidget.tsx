import { type Component, createMemo, Show } from "solid-js";
import { formatDuration } from "../../../lib/format";
import { ChartEmpty } from "../../charts/ChartEmpty";
import { DensityRibbon } from "../../charts/DensityRibbon";
import { Widget } from "../../ui/Widget";
import type { WidgetProps } from "../types";

// ── ActivityWidget [timing] ──────────────────────────────────────────
//
// A mini DensityRibbon of the session timeline mapped onto the run's span, one
// band per event coloured by type — so the rhythm (bursts vs idle gaps) of the
// run reads at a glance (R-C5). Headline carries the two scalars a viewer wants
// first: how many events, over what span. Clicks through to the Timeline tab,
// where the full-span ribbon + filterable detail lives (Wave 2).
//
// Span derivation (matches the task contract): prefer the honest wall-clock
// `start + wall_duration_ms`; fall back to the last event's timestamp, then to
// the idle-trimmed `duration_ms`. `start_time` is optional on the type, so we
// fall back to the earliest event timestamp.

export const ActivityWidget: Component<WidgetProps> = (props) => {
	const events = createMemo(() => props.session.timeline ?? []);
	const hasData = () => events().length > 0;

	// One pass over the timeline for the [min, max] timestamp bounds (the
	// timeline is not guaranteed sorted, so we don't trust events[0] / [last]).
	const bounds = createMemo(() =>
		events().reduce((acc, e) => ({ min: Math.min(acc.min, e.t), max: Math.max(acc.max, e.t) }), {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
		}),
	);

	const startTime = createMemo(() => props.session.start_time ?? bounds().min);

	const endTime = createMemo(() => {
		const s = startTime();
		const wall = props.session.stats.wall_duration_ms;
		if (wall !== undefined && wall > 0) return s + wall;
		const max = bounds().max;
		if (Number.isFinite(max) && max > s) return max;
		return s + props.session.stats.duration_ms;
	});

	const spanMs = () => Math.max(0, endTime() - startTime());

	return (
		<Widget
			category="timing"
			title="Activity"
			span={6}
			onClick={() => props.onNavigate?.("timeline")}
		>
			<Show
				when={hasData()}
				fallback={
					<ChartEmpty
						height={56}
						label="No activity recorded"
						ariaLabel="No timeline events for this session"
					/>
				}
			>
				<div class="space-y-2.5">
					<div class="flex items-baseline gap-4">
						<div class="flex items-baseline gap-1.5">
							<span class="font-mono text-2xl leading-none tabular-nums text-primary">
								{events().length}
							</span>
							<span class="instrument-microcaps text-[10px] text-muted">events</span>
						</div>
						<div class="flex items-baseline gap-1.5">
							<span class="font-mono text-sm tabular-nums text-secondary">
								{formatDuration(spanMs())}
							</span>
							<span class="instrument-microcaps text-[10px] text-muted">span</span>
						</div>
					</div>
					<DensityRibbon
						events={events()}
						startTime={startTime()}
						endTime={endTime()}
						height={28}
						ariaLabel="Activity density over the session span"
					/>
				</div>
			</Show>
		</Widget>
	);
};

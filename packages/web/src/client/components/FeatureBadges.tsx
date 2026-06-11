import { Repeat, Target, Workflow } from "lucide-solid";
import { For, Show, type Component } from "solid-js";
import type { FeatureFlag } from "../../shared/types";

// ── Feature badges (loop / goal / workflow) ─────────────────────────

// Instrument style: square hairline tags, monochrome graphite/phosphor.
// No colored pills — the tag reads like a panel-mounted label.
const BADGE_STYLES: Record<FeatureFlag, { readonly label: string; readonly classes: string; readonly title: string }> = {
	loop: {
		label: "loop",
		classes: "border border-clens text-secondary bg-surface-inset",
		title: "Used /loop — recurring or self-paced wakeups",
	},
	goal: {
		label: "goal",
		classes: "border border-clens text-secondary bg-surface-inset",
		title: "Used /goal — completion-condition driven session",
	},
	workflow: {
		label: "workflow",
		classes: "border border-clens text-secondary bg-surface-inset",
		title: "Used Workflow — multi-agent orchestration",
	},
};

const BadgeIcon: Component<{ readonly flag: FeatureFlag }> = (props) => (
	<>
		<Show when={props.flag === "loop"}><Repeat class="h-2.5 w-2.5" /></Show>
		<Show when={props.flag === "goal"}><Target class="h-2.5 w-2.5" /></Show>
		<Show when={props.flag === "workflow"}><Workflow class="h-2.5 w-2.5" /></Show>
	</>
);

export const FeatureBadge: Component<{ readonly flag: FeatureFlag }> = (props) => (
	<span
		class={`instrument-microcaps inline-flex items-center gap-0.5 rounded-none px-1.5 py-0.5 text-[9px] ${BADGE_STYLES[props.flag].classes}`}
		title={BADGE_STYLES[props.flag].title}
	>
		<BadgeIcon flag={props.flag} />
		{BADGE_STYLES[props.flag].label}
	</span>
);

export const FeatureBadges: Component<{ readonly features?: readonly FeatureFlag[] }> = (props) => (
	<Show when={(props.features?.length ?? 0) > 0}>
		<For each={props.features}>{(flag) => <FeatureBadge flag={flag} />}</For>
	</Show>
);

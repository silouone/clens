import { Repeat, Target, Workflow } from "lucide-solid";
import { For, Show, type Component } from "solid-js";
import type { FeatureFlag } from "../../shared/types";

// ── Feature badges (loop / goal / workflow) ─────────────────────────

const BADGE_STYLES: Record<FeatureFlag, { readonly label: string; readonly classes: string; readonly title: string }> = {
	loop: {
		label: "loop",
		classes: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400",
		title: "Used /loop — recurring or self-paced wakeups",
	},
	goal: {
		label: "goal",
		classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
		title: "Used /goal — completion-condition driven session",
	},
	workflow: {
		label: "workflow",
		classes: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
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
		class={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${BADGE_STYLES[props.flag].classes}`}
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

import { type Component, type JSX, Show } from "solid-js";

type EmptyStateProps = {
	readonly icon?: Component<{ readonly class?: string }>;
	readonly illustration?: "telescope" | "flask";
	readonly title: string;
	readonly description?: string;
	readonly action?: JSX.Element;
};

// ── SVG Illustrations ────────────────────────────────────────────────

/** Telescope/binoculars illustration for "no sessions" state. */
export const TelescopeIllustration: Component<{ readonly class?: string }> = (props) => (
	<svg
		aria-hidden="true"
		class={props.class ?? "h-16 w-16"}
		viewBox="0 0 64 64"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		{/* Tripod legs */}
		<path d="M32 42v16" class="stroke-[var(--clens-tick)]" />
		<path d="M32 58l-10 4" class="stroke-[var(--clens-tick)]" />
		<path d="M32 58l10 4" class="stroke-[var(--clens-tick)]" />
		{/* Telescope tube */}
		<path d="M18 22l22-12" class="stroke-brand-500" stroke-width="2" />
		<rect
			x="14"
			y="18"
			width="10"
			height="8"
			rx="1"
			transform="rotate(-28 19 22)"
			class="stroke-brand-500"
		/>
		{/* Lens */}
		<circle cx="40" cy="10" r="5" class="stroke-brand-400" />
		<circle cx="40" cy="10" r="2" class="stroke-[var(--clens-muted)]" />
		{/* Eyepiece */}
		<rect
			x="12"
			y="22"
			width="6"
			height="4"
			rx="1"
			transform="rotate(-28 15 24)"
			class="stroke-[var(--clens-tick)]"
		/>
	</svg>
);

/** Flask/beaker illustration for "not analyzed" state. */
export const FlaskIllustration: Component<{ readonly class?: string }> = (props) => (
	<svg
		aria-hidden="true"
		class={props.class ?? "h-16 w-16"}
		viewBox="0 0 64 64"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		{/* Flask neck */}
		<path
			d="M26 8v16l-10 22a4 4 0 003.6 5.6h24.8a4 4 0 003.6-5.6L38 24V8"
			class="stroke-brand-500"
			stroke-width="2"
		/>
		{/* Neck rim */}
		<path d="M24 8h16" class="stroke-brand-400" stroke-width="2" />
		{/* Liquid line */}
		<path d="M20 38h24" class="stroke-[var(--clens-warning)]" stroke-dasharray="3 2" />
		{/* Bubbles */}
		<circle cx="28" cy="42" r="1.5" class="stroke-[var(--clens-warning)]" />
		<circle cx="34" cy="40" r="1" class="stroke-[var(--clens-warning)]" />
		<circle cx="31" cy="35" r="1.2" class="stroke-[var(--clens-warning)]" />
	</svg>
);

const ILLUSTRATIONS: Record<string, Component<{ readonly class?: string }>> = {
	telescope: TelescopeIllustration,
	flask: FlaskIllustration,
} as const;

// ── Component ────────────────────────────────────────────────────────

export const EmptyState: Component<EmptyStateProps> = (props) => {
	const IllustrationComp = () =>
		props.illustration ? ILLUSTRATIONS[props.illustration] : undefined;

	return (
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<Show when={IllustrationComp()}>
				{(Illust) => {
					const Comp = Illust();
					return (
						<div class="mb-4">
							<Comp class="h-16 w-16 text-muted" />
						</div>
					);
				}}
			</Show>
			<Show when={!props.illustration && props.icon}>
				{(Icon) => {
					const IconComp = Icon();
					return (
						<div class="mb-4 flex h-12 w-12 items-center justify-center rounded-none border border-clens bg-surface-inset">
							<IconComp class="h-6 w-6 text-muted" />
						</div>
					);
				}}
			</Show>
			<p class="instrument-microcaps text-[11px] text-secondary">{props.title}</p>
			<Show when={props.description}>
				{(desc) => <p class="mt-1.5 max-w-xs text-xs text-muted">{desc()}</p>}
			</Show>
			<Show when={props.action}>
				<div class="mt-4">{props.action}</div>
			</Show>
		</div>
	);
};

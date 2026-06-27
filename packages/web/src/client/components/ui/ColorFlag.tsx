import { createEffect, createSignal, For, onCleanup, Show, type Component } from "solid-js";
import { COLOR_NAMES, type ColorName } from "../../../shared/types";

// ── Palette mapping ──────────────────────────────────────────────────

/**
 * Map each palette name to its INSTRUMENT-safe CSS token (muted instrument hues,
 * not a raw rainbow — see index.css --clens-flag-*). `none` has no token; it
 * renders as a hollow swatch and selecting it clears the flag (R13).
 */
const flagVar = (color: ColorName): string | undefined =>
	color === "none" ? undefined : `var(--clens-flag-${color})`;

/** Human label for the swatch tooltip / a11y name. */
const flagLabel = (color: ColorName): string =>
	color === "none" ? "No flag" : color.charAt(0).toUpperCase() + color.slice(1);

// ── Color dot (display-only) ─────────────────────────────────────────

/**
 * The standalone colored dot shown in a row's NAME cell. Renders a small filled
 * disc in the flag hue; for `none` it renders nothing (callers `Show`-gate it).
 */
export const ColorDot: Component<{ readonly color: ColorName; readonly class?: string }> = (props) => (
	<Show when={props.color !== "none"}>
		<span
			class={`inline-block h-2 w-2 shrink-0 rounded-full ${props.class ?? ""}`}
			style={{ "background-color": flagVar(props.color) ?? "transparent" }}
			title={flagLabel(props.color)}
			aria-label={`${flagLabel(props.color)} flag`}
		/>
	</Show>
);

// ── Swatch (one palette option button) ───────────────────────────────

const Swatch: Component<{
	readonly color: ColorName;
	readonly selected: boolean;
	readonly onSelect: (c: ColorName) => void;
}> = (props) => {
	const isNone = () => props.color === "none";
	return (
		<button
			type="button"
			title={flagLabel(props.color)}
			aria-label={flagLabel(props.color)}
			aria-pressed={props.selected}
			onClick={(e) => {
				e.stopPropagation();
				props.onSelect(props.color);
			}}
			class={`flex h-6 w-6 items-center justify-center rounded-none border transition ${
				props.selected ? "border-brand-500" : "border-clens hover:border-secondary"
			}`}
		>
			<Show
				when={!isNone()}
				fallback={
					// `none` = hollow swatch with a diagonal slash, the universal "clear"
					<span class="instrument-microcaps text-[10px] leading-none text-muted">∅</span>
				}
			>
				<span
					class="h-3 w-3 rounded-full"
					style={{ "background-color": flagVar(props.color) ?? "transparent" }}
				/>
			</Show>
		</button>
	);
};

// ── ColorFlag picker ─────────────────────────────────────────────────

type ColorFlagProps = {
	readonly value: ColorName;
	readonly onChange: (color: ColorName) => void;
	/** Optional extra classes for the trigger element. */
	readonly class?: string;
};

/**
 * Fixed-palette swatch picker for a session's color flag. The trigger shows the
 * current flag (a colored dot, or a hollow ring when unflagged). Clicking opens
 * a popover of swatches over `{none, red, amber, green, blue, violet, gray}`;
 * picking one calls `onChange`. Selecting `none` clears the flag (R10/R13/D4).
 *
 * Self-contained popover (backdrop + Escape) matching the CostDrilldown pattern;
 * all click handlers stopPropagation so use inside a clickable table row never
 * navigates.
 */
export const ColorFlag: Component<ColorFlagProps> = (props) => {
	const [open, setOpen] = createSignal(false);

	createEffect(() => {
		if (!open()) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", handler);
		onCleanup(() => document.removeEventListener("keydown", handler));
	});

	const flagged = () => props.value !== "none";

	return (
		<div class="relative inline-flex">
			<button
				type="button"
				title={flagged() ? `Flag: ${flagLabel(props.value)}` : "Add color flag"}
				aria-label={flagged() ? `Flag: ${flagLabel(props.value)}` : "Add color flag"}
				aria-haspopup="true"
				aria-expanded={open()}
				onClick={(e) => {
					e.stopPropagation();
					setOpen((v) => !v);
				}}
				class={`flex h-5 w-5 items-center justify-center rounded-none border transition hover:border-secondary ${
					open() ? "border-brand-500" : "border-clens"
				} ${props.class ?? ""}`}
			>
				<Show
					when={flagged()}
					fallback={<span class="h-2 w-2 rounded-full border border-clens" />}
				>
					<span
						class="h-2.5 w-2.5 rounded-full"
						style={{ "background-color": flagVar(props.value) ?? "transparent" }}
					/>
				</Show>
			</button>

			<Show when={open()}>
				{/* Backdrop catches outside clicks without navigating the row */}
				<div
					class="fixed inset-0 z-40"
					onClick={(e) => {
						e.stopPropagation();
						setOpen(false);
					}}
				/>
				<div
					class="absolute top-full left-0 z-50 mt-1 flex items-center gap-1 rounded-none border border-clens bg-surface-overlay p-1.5"
					onClick={(e) => e.stopPropagation()}
				>
					<For each={COLOR_NAMES}>
						{(color) => (
							<Swatch
								color={color}
								selected={props.value === color}
								onSelect={(c) => {
									props.onChange(c);
									setOpen(false);
								}}
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
};

import { Show, type Component, type JSX } from "solid-js";
import { ChevronRight } from "lucide-solid";
import { CATEGORY, type CategoryKey } from "../../lib/categories";

// ── Widget shell (overview-moat-refactor, Wave 0) ────────────────────
//
// The square, hairline, color-channelled panel every Overview widget is built
// from. The category "pop" is the SANCTIONED left-rule idiom
// (`shadow-[inset_2px_0_0_0_var(--clens-cat-*)]`, from CATEGORY.ruleClass) plus
// a microcaps title in the channel color — NO drop-shadow, NO rounded-full,
// corners ≤2px (constraint C2). Optional click-through turns the whole panel
// into a button (cursor + hover + a chevron affordance) used to jump to a
// sibling tab.

// Desktop (12-col) span → responsive col-span classes. LITERAL strings so the
// Tailwind JIT emits them. Reflow follows breakpoint-contract.md: base = full
// width (grid-cols-1), sm = 6-col, lg = 12-col. Nothing clips at 375px.
const SPAN_CLASS: Readonly<Record<number, string>> = {
	3: "sm:col-span-2 lg:col-span-3",
	4: "sm:col-span-3 lg:col-span-4",
	6: "sm:col-span-3 lg:col-span-6",
	8: "sm:col-span-6 lg:col-span-8",
	12: "sm:col-span-6 lg:col-span-12",
};

export type WidgetSpan = 3 | 4 | 6 | 8 | 12;

type WidgetProps = {
	readonly category: CategoryKey;
	readonly title: string;
	readonly headerRight?: JSX.Element;
	readonly onClick?: () => void;
	/** Desktop (12-col) column span; defaults to full width. */
	readonly span?: WidgetSpan;
	readonly class?: string;
	readonly children: JSX.Element;
};

export const Widget: Component<WidgetProps> = (props) => {
	const meta = () => CATEGORY[props.category];
	const spanClass = () => SPAN_CLASS[props.span ?? 12] ?? SPAN_CLASS[12];
	const clickable = () => props.onClick !== undefined;

	const activate = () => props.onClick?.();
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			activate();
		}
	};

	return (
		<div
			class={`animate-fade-in rounded-none border border-clens bg-surface-raised ${meta().ruleClass} ${spanClass()} ${
				clickable() ? "cursor-pointer transition hover:bg-surface-hover focus-ring" : ""
			} ${props.class ?? ""}`}
			role={clickable() ? "button" : undefined}
			tabindex={clickable() ? 0 : undefined}
			onClick={clickable() ? activate : undefined}
			onKeyDown={clickable() ? onKeyDown : undefined}
		>
			<div class="flex items-center justify-between gap-2 border-b border-clens px-3 py-2">
				<div class="flex items-center gap-2" style={{ color: meta().cssVar }}>
					{(() => {
						const Icon = meta().icon;
						return <Icon class="h-3.5 w-3.5" />;
					})()}
					<h3 class="instrument-microcaps text-[11px]">{props.title}</h3>
				</div>
				<div class="flex items-center gap-1.5">
					<Show when={props.headerRight}>{props.headerRight}</Show>
					<Show when={clickable()}>
						<ChevronRight class="h-3.5 w-3.5 text-muted" />
					</Show>
				</div>
			</div>
			<div class="p-3">{props.children}</div>
		</div>
	);
};

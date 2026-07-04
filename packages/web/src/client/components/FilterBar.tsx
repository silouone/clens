import { ChevronDown, RefreshCw, Search, SlidersHorizontal, X } from "lucide-solid";
import { createEffect, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import { SegmentedControl } from "./ui/SegmentedControl";

// ── Types ────────────────────────────────────────────────────────────

type FilterOption = { readonly label: string; readonly value: string };

type FilterGroup = {
	readonly key: string;
	readonly options: readonly FilterOption[];
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly variant?: "segmented" | "dropdown";
	readonly label?: string; // dropdown label shown when value is "all"
};

type FilterBarProps = {
	readonly searchPlaceholder: string;
	readonly searchValue: string;
	readonly onSearch: (value: string) => void;
	readonly searchRef?: (el: HTMLInputElement) => void;
	readonly filters: readonly FilterGroup[];
	readonly resultCount: number;
	readonly resultLabel: string;
	readonly onRefresh: () => void;
	// FE-9: advanced facets collapse into a single "Filters" popover instead of a
	// stack of segmented-control rows. These props are optional so callers that
	// don't need advanced facets render the plain primary row unchanged.
	readonly advancedContent?: JSX.Element; // popover body (labelled facet controls)
	readonly advancedCount?: number; // count badge of active advanced facets
	readonly chips?: JSX.Element; // active-filter chips rendered below the primary row
	readonly onClear?: () => void; // when present, render a Clear-all control
};

// ── Dropdown filter ──────────────────────────────────────────────────

const FilterDropdown = (props: {
	readonly options: readonly FilterOption[];
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly label?: string;
}) => {
	const selectedLabel = () => {
		if (props.value === "all" && props.label) return props.label;
		return props.options.find((o) => o.value === props.value)?.label ?? props.value;
	};

	return (
		<div class="relative inline-flex">
			<select
				value={props.value}
				onChange={(e) => props.onChange(e.currentTarget.value)}
				class="appearance-none rounded-none border border-clens bg-surface-raised py-1 pl-2.5 pr-7 text-xs font-medium text-primary transition focus:border-brand-500 focus:outline-none cursor-pointer hover:bg-surface-hover"
			>
				<For each={props.options}>
					{(opt) => (
						<option value={opt.value}>
							{opt.value === "all" && props.label ? props.label : opt.label}
						</option>
					)}
				</For>
			</select>
			<ChevronDown class="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
		</div>
	);
};

// ── Filters popover (FE-9) ───────────────────────────────────────────

const FiltersPopover = (props: { readonly count: number; readonly children: JSX.Element }) => {
	const [open, setOpen] = createSignal(false);

	// Escape closes — matches the ColorFlag popover pattern.
	createEffect(() => {
		if (!open()) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", handler);
		onCleanup(() => document.removeEventListener("keydown", handler));
	});

	const active = () => props.count > 0;

	return (
		<div class="relative inline-flex">
			<button
				type="button"
				aria-haspopup="true"
				aria-expanded={open()}
				onClick={() => setOpen((v) => !v)}
				class={`instrument-microcaps inline-flex items-center gap-1.5 rounded-none border px-2 py-1 text-[10px] transition ${
					open() || active()
						? "border-brand-500 text-primary"
						: "border-clens text-muted hover:border-strong hover:text-secondary"
				}`}
				title="Filters"
			>
				<SlidersHorizontal class="h-3 w-3" />
				Filters
				<Show when={active()}>
					<span class="font-mono text-[9px] tabular-nums text-brand-500">{props.count}</span>
				</Show>
			</button>

			<Show when={open()}>
				{/* Backdrop catches outside clicks. */}
				<button
					type="button"
					aria-label="Close filters"
					tabIndex={-1}
					class="fixed inset-0 z-40"
					onClick={() => setOpen(false)}
				/>
				<div class="absolute top-full left-0 z-50 mt-1 rounded-none border border-clens bg-surface-overlay p-3">
					{props.children}
				</div>
			</Show>
		</div>
	);
};

// ── Component ────────────────────────────────────────────────────────

export const FilterBar = (props: FilterBarProps) => (
	<div class="mt-3 flex flex-col gap-2">
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative w-full sm:w-auto">
				<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
				<input
					ref={props.searchRef}
					type="text"
					placeholder={props.searchPlaceholder}
					value={props.searchValue}
					onInput={(e) => props.onSearch(e.currentTarget.value)}
					class="w-full sm:w-64 rounded-none border border-clens bg-surface-raised py-1.5 pl-8 pr-3 text-sm font-mono text-primary placeholder:font-sans placeholder:text-muted focus:border-brand-500 focus:outline-none"
				/>
			</div>
			<For each={props.filters}>
				{(group) => (
					<Show
						when={group.variant === "dropdown"}
						fallback={
							<SegmentedControl
								options={group.options}
								value={group.value}
								onChange={group.onChange}
							/>
						}
					>
						<FilterDropdown
							options={group.options}
							value={group.value}
							onChange={group.onChange}
							label={group.label}
						/>
					</Show>
				)}
			</For>
			<Show when={props.advancedContent}>
				<FiltersPopover count={props.advancedCount ?? 0}>{props.advancedContent}</FiltersPopover>
			</Show>
			<span class="instrument-microcaps flex items-baseline gap-1 text-[10px] text-muted">
				<span class="font-mono text-xs tabular-nums text-secondary">{props.resultCount}</span>
				{props.resultLabel}
			</span>
			<button
				type="button"
				onClick={() => props.onRefresh()}
				class="ml-auto flex items-center gap-1 rounded-none border border-clens px-2 py-1 text-xs text-muted transition hover:bg-surface-hover hover:border-strong hover:text-secondary"
				title="Refresh"
			>
				<RefreshCw class="h-3 w-3" />
			</button>
		</div>
		{/* Active-filter chips + Clear (FE-9/FE-10). */}
		<Show when={props.chips || props.onClear}>
			<div class="flex flex-wrap items-center gap-1.5">
				{props.chips}
				<Show when={props.onClear}>
					<button
						type="button"
						onClick={() => props.onClear?.()}
						class="instrument-microcaps inline-flex items-center gap-1 rounded-none px-1.5 py-0.5 text-[10px] text-muted transition hover:text-[var(--clens-danger)]"
						title="Clear all filters"
					>
						<X class="h-3 w-3" />
						Clear all
					</button>
				</Show>
			</div>
		</Show>
	</div>
);

import { For, Show } from "solid-js";
import { Search, RefreshCw, ChevronDown } from "lucide-solid";
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

// ── Component ────────────────────────────────────────────────────────

export const FilterBar = (props: FilterBarProps) => (
	<div class="mt-3 flex flex-wrap items-center gap-3">
		<div class="relative">
			<Search class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
			<input
				ref={props.searchRef}
				type="text"
				placeholder={props.searchPlaceholder}
				value={props.searchValue}
				onInput={(e) => props.onSearch(e.currentTarget.value)}
				class="w-64 rounded-none border border-clens bg-surface-raised py-1.5 pl-8 pr-3 text-sm font-mono text-primary placeholder:font-sans placeholder:text-muted focus:border-brand-500 focus:outline-none"
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
		<span class="instrument-microcaps flex items-baseline gap-1 text-[10px] text-muted">
			<span class="font-mono text-xs tabular-nums text-secondary">{props.resultCount}</span>
			{props.resultLabel}
		</span>
		<button
			onClick={() => props.onRefresh()}
			class="ml-auto flex items-center gap-1 rounded-none border border-clens px-2 py-1 text-xs text-muted transition hover:bg-surface-hover hover:border-brand-500 hover:text-secondary"
			title="Refresh"
		>
			<RefreshCw class="h-3 w-3" />
		</button>
	</div>
);

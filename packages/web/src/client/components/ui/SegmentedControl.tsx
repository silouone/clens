import { For } from "solid-js";

type SegmentedOption<T extends string> = {
	readonly label: string;
	readonly value: T;
};

type SegmentedControlProps<T extends string> = {
	readonly options: readonly SegmentedOption<T>[];
	readonly value: T;
	readonly onChange: (value: T) => void;
	readonly class?: string;
};

export const SegmentedControl = <T extends string>(props: SegmentedControlProps<T>) => (
	<div class={`inline-flex divide-x divide-clens rounded-none border border-clens ${props.class ?? ""}`}>
		<For each={props.options}>
			{(opt) => (
				<button
					class="instrument-microcaps rounded-none px-2.5 py-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
					classList={{
						"bg-surface-muted text-primary": props.value === opt.value,
						"text-muted hover:bg-surface-hover hover:text-secondary": props.value !== opt.value,
					}}
					onClick={() => props.onChange(opt.value)}
				>
					{opt.label}
				</button>
			)}
		</For>
	</div>
);

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
	<div class={`inline-flex rounded-md border border-clens ${props.class ?? ""}`}>
		<For each={props.options}>
			{(opt) => (
				<button
					class="px-2.5 py-1 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md"
					classList={{
						"bg-surface-muted text-primary": props.value === opt.value,
						"text-muted hover:text-secondary": props.value !== opt.value,
					}}
					onClick={() => props.onChange(opt.value)}
				>
					{opt.label}
				</button>
			)}
		</For>
	</div>
);

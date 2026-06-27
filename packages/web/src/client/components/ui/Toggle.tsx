import type { Component } from "solid-js";

type ToggleProps = {
	readonly checked: boolean;
	readonly onChange: (value: boolean) => void;
	readonly disabled?: boolean;
};

export const Toggle: Component<ToggleProps> = (props) => (
	<button
		type="button"
		role="switch"
		aria-checked={props.checked}
		disabled={props.disabled}
		class="relative inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
		classList={{
			"bg-brand-500": props.checked,
			"bg-surface-muted": !props.checked,
		}}
		onClick={() => props.onChange(!props.checked)}
	>
		<span
			class="pointer-events-none inline-block h-[18px] w-[18px] translate-y-[2px] rounded-full bg-white shadow-sm transition-transform duration-200"
			classList={{
				"translate-x-[20px]": props.checked,
				"translate-x-[2px]": !props.checked,
			}}
		/>
	</button>
);

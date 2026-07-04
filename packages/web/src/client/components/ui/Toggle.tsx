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
		class="relative inline-flex h-[20px] w-[40px] shrink-0 cursor-pointer rounded-[2px] border border-clens transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
		classList={{
			"bg-surface-muted": props.checked,
			"bg-surface": !props.checked,
		}}
		onClick={() => props.onChange(!props.checked)}
	>
		<span
			class="pointer-events-none inline-block h-[14px] w-[14px] translate-y-[2px] rounded-[1px] transition-transform duration-200"
			classList={{
				"translate-x-[23px] bg-brand-500": props.checked,
				"translate-x-[2px] bg-muted": !props.checked,
			}}
		/>
	</button>
);

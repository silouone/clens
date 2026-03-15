import { Show, type Component, type JSX } from "solid-js";

type SettingRowProps = {
	readonly label: string;
	readonly description?: string;
	readonly children: JSX.Element;
};

export const SettingRow: Component<SettingRowProps> = (props) => (
	<div class="flex items-center justify-between py-4 border-b border-clens/50 last:border-b-0">
		<div class="min-w-0 mr-6">
			<div class="text-sm font-medium text-primary">{props.label}</div>
			<Show when={props.description}>
				<div class="text-xs text-muted mt-1">{props.description}</div>
			</Show>
		</div>
		<div class="shrink-0">{props.children}</div>
	</div>
);

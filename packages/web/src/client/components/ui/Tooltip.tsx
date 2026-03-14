import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import type { Component, JSX } from "solid-js";

type TooltipProps = {
	readonly content: string;
	readonly children: JSX.Element;
};

export const Tooltip: Component<TooltipProps> = (props) => (
	<KTooltip>
		<KTooltip.Trigger as="span" class="inline-flex">
			{props.children}
		</KTooltip.Trigger>
		<KTooltip.Portal>
			<KTooltip.Content class="z-50 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
				<KTooltip.Arrow />
				{props.content}
			</KTooltip.Content>
		</KTooltip.Portal>
	</KTooltip>
);

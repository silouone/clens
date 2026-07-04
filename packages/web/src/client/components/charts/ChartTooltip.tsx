import { type Component, createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";

export type TooltipData = {
	readonly x: number;
	readonly y: number;
	readonly content: string;
};

export const [tooltipData, setTooltipData] = createSignal<TooltipData | undefined>();

export const showTooltip = (x: number, y: number, content: string): void => {
	setTooltipData({ x, y, content });
};

export const hideTooltip = (): void => {
	setTooltipData(undefined);
};

export const ChartTooltip: Component = () => (
	<Show when={tooltipData()}>
		{(data) => (
			<Portal>
				<div
					class="pointer-events-none fixed z-50 rounded-none border border-clens bg-surface-overlay px-2 py-1 font-mono text-[11px] tabular-nums text-primary"
					style={{
						left: `${data().x}px`,
						top: `${data().y - 40}px`,
						transform: "translateX(-50%)",
					}}
				>
					{data().content}
				</div>
			</Portal>
		)}
	</Show>
);

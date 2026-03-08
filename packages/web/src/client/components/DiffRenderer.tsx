import { html } from "diff2html";
import type { Component } from "solid-js";

export type DiffRendererProps = {
	readonly diff: string;
};

export const DiffRenderer: Component<DiffRendererProps> = (props) => {
	const rendered = () => html(props.diff, { outputFormat: "side-by-side" });

	return <div class="diff-container" innerHTML={rendered()} />;
};

import type { Component, JSX } from "solid-js";
import { Card } from "../ui/Card";

type SettingsSectionProps = {
	readonly title: string;
	readonly icon?: Component<{ readonly class?: string }>;
	readonly children: JSX.Element;
};

export const SettingsSection: Component<SettingsSectionProps> = (props) => (
	<Card title={props.title} icon={props.icon}>
		<div class="px-5 py-1">{props.children}</div>
	</Card>
);

import { projectColor } from "../lib/project-store";

/** Small project badge for table rows and cards. */
const ProjectBadge = (props: { readonly projectId: string; readonly projectName: string }) => {
	return (
		<span class="inline-flex items-center gap-1.5 text-xs text-muted">
			<span
				class="instrument-led flex-shrink-0"
				style={{ "background-color": projectColor(props.projectId) }}
			/>
			<span class="truncate max-w-[120px] font-mono">{props.projectName}</span>
		</span>
	);
};

export { ProjectBadge };

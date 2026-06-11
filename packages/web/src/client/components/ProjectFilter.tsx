import { For, Show } from "solid-js";
import { projectList, selectedProjectId, setSelectedProjectId, isGlobalMode, projectColor } from "../lib/project-store";

/** Project filter -- only renders when server is in global mode. */
const ProjectFilter = () => {
	return (
		<Show when={isGlobalMode()}>
			<div class="flex items-center gap-px rounded-none border border-clens bg-surface-raised p-0.5">
				<button
					class={`instrument-microcaps rounded-none px-3 py-1 text-[10px] transition-colors ${
						selectedProjectId() === undefined
							? "bg-surface-selected text-primary"
							: "text-muted hover:bg-surface-hover hover:text-secondary"
					}`}
					onClick={() => setSelectedProjectId(undefined)}
				>
					All
				</button>
				<For each={projectList() ?? []}>
					{(project) => (
						<button
							class={`instrument-microcaps flex items-center gap-1.5 rounded-none px-3 py-1 text-[10px] transition-colors ${
								selectedProjectId() === project.id
									? "bg-surface-selected text-primary"
									: "text-muted hover:bg-surface-hover hover:text-secondary"
							}`}
							onClick={() => setSelectedProjectId(project.id)}
						>
							<span
								class="instrument-led flex-shrink-0"
								style={{ "background-color": projectColor(project.id) }}
							/>
							{project.name}
						</button>
					)}
				</For>
			</div>
		</Show>
	);
};

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

export { ProjectFilter, ProjectBadge };

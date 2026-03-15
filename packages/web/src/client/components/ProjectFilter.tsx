import { For, Show } from "solid-js";
import { projectList, selectedProjectId, setSelectedProjectId, isGlobalMode, projectColor } from "../lib/project-store";

/** Project filter -- only renders when server is in global mode. */
const ProjectFilter = () => {
	return (
		<Show when={isGlobalMode()}>
			<div class="flex items-center gap-1.5 px-1 py-1 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
				<button
					class={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
						selectedProjectId() === undefined
							? "bg-zinc-600 text-zinc-100"
							: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
					}`}
					onClick={() => setSelectedProjectId(undefined)}
				>
					All
				</button>
				<For each={projectList() ?? []}>
					{(project) => (
						<button
							class={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
								selectedProjectId() === project.id
									? "bg-zinc-600 text-zinc-100"
									: "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
							}`}
							onClick={() => setSelectedProjectId(project.id)}
						>
							<span
								class="inline-block w-2 h-2 rounded-full flex-shrink-0"
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
		<span class="inline-flex items-center gap-1 text-xs text-zinc-400">
			<span
				class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
				style={{ "background-color": projectColor(props.projectId) }}
			/>
			<span class="truncate max-w-[120px]">{props.projectName}</span>
		</span>
	);
};

export { ProjectFilter, ProjectBadge };

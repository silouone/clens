import { For, Show } from "solid-js";
import { ChevronDown } from "lucide-solid";
import {
	projectList,
	selectedProjectId,
	setSelectedProjectId,
	isGlobalMode,
	projectColor,
} from "../lib/project-store";

/** Compact project dropdown for dashboard pages. Only renders in global mode. */
export const ProjectDropdown = () => (
	<Show when={isGlobalMode()}>
		<div class="relative inline-flex">
			<select
				value={selectedProjectId() ?? "all"}
				onChange={(e) =>
					setSelectedProjectId(e.currentTarget.value === "all" ? undefined : e.currentTarget.value)
				}
				class="appearance-none rounded-none border border-clens bg-surface-raised py-1 pl-2.5 pr-7 text-xs font-medium text-primary transition focus:border-brand-500 focus:outline-none cursor-pointer hover:bg-surface-hover"
			>
				<option value="all">All Projects</option>
				<For each={projectList() ?? []}>
					{(p) => <option value={p.id}>{p.name}</option>}
				</For>
			</select>
			<ChevronDown class="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
		</div>
	</Show>
);

import { createResource, createSignal } from "solid-js";
import type { ProjectEntry } from "../../shared/types";

const LOG_PREFIX = "[cLens:projects]";

// ── Fetch projects ───────────────────────────────────────────────────

const fetchProjects = async (): Promise<readonly ProjectEntry[]> => {
	console.debug(LOG_PREFIX, "Fetching projects");
	try {
		const res = await fetch("/api/projects");
		if (!res.ok) {
			console.error(LOG_PREFIX, `Projects error: HTTP ${res.status}`);
			return [];
		}
		const body = await res.json();
		const data = body.data;
		if (!Array.isArray(data)) return [];
		console.debug(LOG_PREFIX, `Projects: ${data.length} entries`);
		return data as readonly ProjectEntry[];
	} catch (err) {
		console.error(LOG_PREFIX, "Projects fetch failed:", err);
		return [];
	}
};

// ── Reactive state ───────────────────────────────────────────────────

const [projectList, { refetch: refetchProjects }] = createResource(fetchProjects);

const [selectedProjectId, setSelectedProjectId] = createSignal<string | undefined>(undefined);

/** True when server is in global mode (more than one project registered). */
const isGlobalMode = (): boolean => (projectList()?.length ?? 0) > 0;

// ── Project color derivation ─────────────────────────────────────────

const PROJECT_COLORS = [
	"#3b82f6", // blue
	"#8b5cf6", // violet
	"#ec4899", // pink
	"#f97316", // orange
	"#14b8a6", // teal
	"#84cc16", // lime
	"#f59e0b", // amber
	"#06b6d4", // cyan
] as const;

/** Derive a stable color for a project ID using a simple hash. */
const projectColor = (projectId: string): string => {
	const hash = projectId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
	return PROJECT_COLORS[hash % PROJECT_COLORS.length];
};

export {
	projectList,
	refetchProjects,
	selectedProjectId,
	setSelectedProjectId,
	isGlobalMode,
	projectColor,
};

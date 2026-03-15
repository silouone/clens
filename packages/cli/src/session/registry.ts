import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { homedir } from "node:os";
import type { ProjectEntry, ProjectRegistry } from "../types";

/** Path to the global project registry file. */
export const registryPath = (): string =>
	`${homedir()}/.clens/projects.json`;

/** Read the project registry. Returns empty registry if file is missing or invalid. */
export const readRegistry = (): ProjectRegistry => {
	const path = registryPath();
	if (!existsSync(path)) return { version: 1, projects: [] };
	try {
		const content = readFileSync(path, "utf-8");
		const parsed: unknown = JSON.parse(content);
		if (
			parsed &&
			typeof parsed === "object" &&
			"version" in parsed &&
			"projects" in parsed &&
			Array.isArray((parsed as Record<string, unknown>).projects)
		) {
			return parsed as ProjectRegistry;
		}
		return { version: 1, projects: [] };
	} catch {
		return { version: 1, projects: [] };
	}
};

/** Write the project registry atomically. */
export const writeRegistry = (registry: ProjectRegistry): void => {
	const path = registryPath();
	const dir = `${homedir()}/.clens`;
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, JSON.stringify(registry, null, 2));
};

/** Derive a kebab-case project ID from a directory path. */
const deriveProjectId = (projectDir: string): string =>
	basename(projectDir)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** Register a project in the global registry. Idempotent — returns existing entry if already registered. */
export const registerProject = (projectDir: string): ProjectEntry => {
	const registry = readRegistry();
	const existing = registry.projects.find((p) => p.path === projectDir);
	if (existing) return existing;

	const entry: ProjectEntry = {
		id: deriveProjectId(projectDir),
		path: projectDir,
		name: basename(projectDir),
		added_at: Date.now(),
	};

	writeRegistry({
		...registry,
		projects: [...registry.projects, entry],
	});

	return entry;
};

/** Unregister a project from the global registry. Returns true if the project was found and removed. */
export const unregisterProject = (projectDir: string): boolean => {
	const registry = readRegistry();
	const filtered = registry.projects.filter((p) => p.path !== projectDir);
	if (filtered.length === registry.projects.length) return false;
	writeRegistry({ ...registry, projects: filtered });
	return true;
};

/** Read registry and filter to entries whose `.clens/` directory still exists. */
export const resolveProjectEntries = (): readonly ProjectEntry[] => {
	const registry = readRegistry();
	return registry.projects.filter((p) => existsSync(`${p.path}/.clens`));
};

import { existsSync } from "node:fs";
import type { GlobalSessionSummary, GlobalWorkUnit, ProjectEntry } from "../types";
import { resolveProjectEntries } from "./registry";
import { listSessions, enrichSessionSummaries } from "./read";
import { readWorkUnitIndex } from "./work-units";

/**
 * List sessions across all registered projects.
 * Reads registry, calls listSessions for each project, tags with project info,
 * merges, and sorts by start_time descending.
 */
export const listGlobalSessions = (): readonly GlobalSessionSummary[] => {
	const projects = resolveProjectEntries();

	const allSessions = projects.flatMap((project): readonly GlobalSessionSummary[] => {
		const raw = listSessions(project.path);
		const enriched = enrichSessionSummaries(raw, project.path);
		return enriched.map((session): GlobalSessionSummary => ({
			...session,
			project_id: project.id,
			project_name: project.name,
		}));
	});

	return [...allSessions].sort((a, b) => b.start_time - a.start_time);
};

/**
 * List work units across all registered projects.
 * Reads registry, calls readWorkUnitIndex for each project, tags units with project info.
 */
export const listGlobalWorkUnits = (): readonly GlobalWorkUnit[] => {
	const projects = resolveProjectEntries();

	const allUnits = projects.flatMap((project): readonly GlobalWorkUnit[] => {
		const index = readWorkUnitIndex(project.path);
		if (!index) return [];
		return index.units.map((unit): GlobalWorkUnit => ({
			...unit,
			project_id: project.id,
			project_name: project.name,
		}));
	});

	return [...allUnits].sort((a, b) => b.date_range.start - a.date_range.start);
};

/**
 * Scan registry projects to find which one owns a given session ID.
 * Returns the project entry, or undefined if not found.
 */
export const resolveProjectForSession = (sessionId: string): ProjectEntry | undefined => {
	const projects = resolveProjectEntries();
	return projects.find((p) =>
		existsSync(`${p.path}/.clens/sessions/${sessionId}.jsonl`)
	);
};

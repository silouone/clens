import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { GlobalSessionSummary, GlobalWorkUnit, ProjectEntry, SessionSummary } from "../types";
import { readGlobalConfig, resolveProjectEntries } from "./registry";
import { listSessions, enrichSessionSummaries } from "./read";
import { readWorkUnitIndex } from "./work-units";

/**
 * In repository mode, a single project (git root) may contain multiple
 * `.clens/sessions/` directories (root + nested packages). This finds them all.
 */
const findAllClensDirs = (projectDir: string, maxDepth = 3): readonly string[] => {
	const dirs: string[] = [];

	const scan = (dir: string, depth: number): void => {
		if (depth > maxDepth) return;
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				if (entry.name === "node_modules" || entry.name === ".git") continue;

				const fullPath = resolve(dir, entry.name);
				if (entry.name === ".clens") {
					if (existsSync(resolve(fullPath, "sessions"))) {
						dirs.push(dir);
					}
					continue;
				}
				if (entry.name.startsWith(".")) continue;
				scan(fullPath, depth + 1);
			}
		} catch {
			// Permission error — skip
		}
	};

	scan(projectDir, 0);
	return dirs;
};

/**
 * List sessions for a project. In repository mode, scans all nested `.clens/`
 * dirs within the project. In project mode, just reads the single dir.
 */
const listSessionsForProject = (project: ProjectEntry, isRepoMode: boolean): readonly SessionSummary[] => {
	if (!isRepoMode) {
		return enrichSessionSummaries(listSessions(project.path), project.path);
	}

	// Repository mode: merge sessions from all .clens/ dirs in the repo
	const clensDirs = findAllClensDirs(project.path);
	return clensDirs.flatMap((dir) =>
		enrichSessionSummaries(listSessions(dir), dir),
	);
};

/**
 * List sessions across all registered projects.
 * Reads registry, collects sessions per project (respecting global_mode),
 * tags with project info, merges, and sorts by start_time descending.
 */
export const listGlobalSessions = (): readonly GlobalSessionSummary[] => {
	const projects = resolveProjectEntries();
	const config = readGlobalConfig();
	const isRepoMode = config.global_mode === "repository";

	const allSessions = projects.flatMap((project): readonly GlobalSessionSummary[] =>
		listSessionsForProject(project, isRepoMode).map((session): GlobalSessionSummary => ({
			...session,
			project_id: project.id,
			project_name: project.name,
		})),
	);

	// Deduplicate by session_id (same session may appear from nested dirs)
	const seen = new Set<string>();
	const unique = allSessions.filter((s) => {
		if (seen.has(s.session_id)) return false;
		seen.add(s.session_id);
		return true;
	});

	return [...unique].sort((a, b) => b.start_time - a.start_time);
};

/**
 * List work units across all registered projects.
 */
export const listGlobalWorkUnits = (): readonly GlobalWorkUnit[] => {
	const projects = resolveProjectEntries();
	const config = readGlobalConfig();
	const isRepoMode = config.global_mode === "repository";

	const allUnits = projects.flatMap((project): readonly GlobalWorkUnit[] => {
		if (isRepoMode) {
			const clensDirs = findAllClensDirs(project.path);
			return clensDirs.flatMap((dir) => {
				const index = readWorkUnitIndex(dir);
				if (!index) return [];
				return index.units.map((unit): GlobalWorkUnit => ({
					...unit,
					project_id: project.id,
					project_name: project.name,
				}));
			});
		}
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
 */
export const resolveProjectForSession = (sessionId: string): ProjectEntry | undefined => {
	const projects = resolveProjectEntries();
	const config = readGlobalConfig();
	const isRepoMode = config.global_mode === "repository";

	for (const project of projects) {
		if (isRepoMode) {
			const dirs = findAllClensDirs(project.path);
			if (dirs.some((dir) => existsSync(`${dir}/.clens/sessions/${sessionId}.jsonl`))) {
				return project;
			}
		} else if (existsSync(`${project.path}/.clens/sessions/${sessionId}.jsonl`)) {
			return project;
		}
	}
	return undefined;
};

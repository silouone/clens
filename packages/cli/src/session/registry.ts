import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { homedir } from "node:os";
import type { GlobalConfig, GlobalMode, ProjectEntry, ProjectRegistry } from "../types";

// ── Paths ────────────────────────────────────────────────────────

const globalDir = (): string => `${homedir()}/.clens`;

/** Path to the global project registry file. */
export const registryPath = (): string => `${globalDir()}/projects.json`;

/** Path to the global config file. */
export const globalConfigPath = (): string => `${globalDir()}/config.json`;

// ── Global Config ────────────────────────────────────────────────

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = { global_mode: "repository" };
const VALID_GLOBAL_MODES: readonly GlobalMode[] = ["repository", "project"];

export const isValidGlobalMode = (value: string): value is GlobalMode =>
	(VALID_GLOBAL_MODES as readonly string[]).includes(value);

export const readGlobalConfig = (): GlobalConfig => {
	const path = globalConfigPath();
	if (!existsSync(path)) return DEFAULT_GLOBAL_CONFIG;
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (typeof raw !== "object" || raw === null) return DEFAULT_GLOBAL_CONFIG;
		const obj = raw as Record<string, unknown>;
		const global_mode =
			typeof obj.global_mode === "string" && isValidGlobalMode(obj.global_mode)
				? obj.global_mode
				: DEFAULT_GLOBAL_CONFIG.global_mode;
		return { global_mode };
	} catch {
		return DEFAULT_GLOBAL_CONFIG;
	}
};

export const writeGlobalConfig = (config: GlobalConfig): void => {
	const dir = globalDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(globalConfigPath(), JSON.stringify(config, null, 2));
};

// ── Registry CRUD ────────────────────────────────────────────────

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
	const dir = globalDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
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

/**
 * Whether a registered project still has a `.clens/` directory reachable from its path.
 *
 * The original check was `existsSync(${path}/.clens)`. In repository mode a project's
 * `path` is the git root, but its `.clens/` may live in a nested package (e.g.
 * `gitRoot/packages/web/.clens/sessions`), so that check dropped every repo whose
 * capture dir was nested (bug repo-mode-nested-clens-projects-dropped). We keep the
 * cheap depth-0 check for project-mode entries and otherwise mirror global-read's
 * findAllClensDirs: accept the project if a nested `.clens/sessions/` exists within a
 * bounded depth below the path.
 */
const hasReachableClensDir = (projectDir: string, maxDepth = 3): boolean => {
	// Fast path — `.clens` directly at the registered path (project mode / root capture).
	if (existsSync(`${projectDir}/.clens`)) return true;

	// Repository mode — `.clens/sessions/` may be nested below the git root.
	const scan = (dir: string, depth: number): boolean => {
		if (depth > maxDepth) return false;
		const entries = (() => {
			try {
				return readdirSync(dir, { withFileTypes: true });
			} catch {
				return [];
			}
		})();
		return entries.some((entry) => {
			if (!entry.isDirectory()) return false;
			if (entry.name === "node_modules" || entry.name === ".git") return false;
			const fullPath = resolve(dir, entry.name);
			if (entry.name === ".clens") return existsSync(resolve(fullPath, "sessions"));
			if (entry.name.startsWith(".")) return false;
			return scan(fullPath, depth + 1);
		});
	};
	return scan(projectDir, 0);
};

/** Read registry and filter to entries whose `.clens/` directory is still reachable. */
export const resolveProjectEntries = (): readonly ProjectEntry[] => {
	const registry = readRegistry();
	return registry.projects.filter((p) => hasReachableClensDir(p.path));
};

// ── Discovery ────────────────────────────────────────────────────

/** Scan home dir for directories containing `.clens/sessions/`. */
const scanForClensDirs = (maxDepth = 3): readonly string[] => {
	const home = homedir();
	const discovered: string[] = [];

	const scan = (dir: string, depth: number): void => {
		if (depth > maxDepth) return;
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				if (entry.name.startsWith(".") && entry.name !== ".clens") continue;
				if (entry.name === "node_modules" || entry.name === ".Trash") continue;

				const fullPath = resolve(dir, entry.name);
				if (entry.name === ".clens") {
					if (existsSync(resolve(fullPath, "sessions"))) {
						discovered.push(dir);
					}
					continue;
				}
				scan(fullPath, depth + 1);
			}
		} catch {
			// Permission denied or other FS error — skip
		}
	};

	scan(home, 0);
	return discovered;
};

/** Find the git root for a directory, or undefined if not in a git repo. */
const findGitRoot = (dir: string): string | undefined => {
	try {
		const root = execSync("git rev-parse --show-toplevel", {
			cwd: dir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return root || undefined;
	} catch {
		return undefined;
	}
};

/**
 * "repository" mode: group all `.clens/sessions/` dirs by their git root.
 * Each git repo becomes one ProjectEntry. Orphans (no git root) become their own entry.
 * The `session_dirs` on ProjectEntry are not stored — callers read sessions from all
 * `.clens/sessions/` dirs within the repo.
 */
const resolveRepositoryMode = (clensDirs: readonly string[]): readonly ProjectEntry[] => {
	// Group by git root
	const gitRootMap = new Map<string, readonly string[]>();
	const orphans: string[] = [];

	for (const dir of clensDirs) {
		const gitRoot = findGitRoot(dir);
		if (gitRoot) {
			gitRootMap.set(gitRoot, [...(gitRootMap.get(gitRoot) ?? []), dir]);
		} else {
			orphans.push(dir);
		}
	}

	const entries: ProjectEntry[] = [];

	// Each git root becomes one project
	for (const [gitRoot] of gitRootMap) {
		entries.push({
			id: deriveProjectId(gitRoot),
			path: gitRoot,
			name: basename(gitRoot),
			added_at: Date.now(),
		});
	}

	// Orphans are their own projects
	for (const dir of orphans) {
		entries.push({
			id: deriveProjectId(dir),
			path: dir,
			name: basename(dir),
			added_at: Date.now(),
		});
	}

	return entries;
};

/**
 * "project" mode: every `.clens/sessions/` directory is its own source.
 * No grouping, no dedup. Every capture location is a separate project.
 */
const resolveProjectMode = (clensDirs: readonly string[]): readonly ProjectEntry[] =>
	clensDirs.map((dir) => ({
		id: deriveProjectId(dir),
		path: dir,
		name: basename(dir),
		added_at: Date.now(),
	}));

// ── Public API ───────────────────────────────────────────────────

/**
 * Discover projects with `.clens/sessions/` under ~, resolve using
 * the configured global_mode, persist to registry, and return.
 */
export const discoverAndRegisterProjects = (maxDepth = 3): readonly ProjectEntry[] => {
	const config = readGlobalConfig();
	const clensDirs = scanForClensDirs(maxDepth);

	const entries = config.global_mode === "project"
		? resolveProjectMode(clensDirs)
		: resolveRepositoryMode(clensDirs);

	// Persist — full replace with fresh discovery
	writeRegistry({ version: 1, projects: entries });
	return entries;
};

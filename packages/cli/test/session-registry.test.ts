import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readRegistry,
	registerProject,
	resolveProjectEntries,
	unregisterProject,
	writeRegistry,
} from "../src/session/registry";

const makeTempDir = (): string => {
	const dir = join(
		tmpdir(),
		`clens-test-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
};

describe("session-registry", () => {
	let tempDir: string;
	let globalDir: string;
	let previousGlobalDir: string | undefined;

	beforeEach(() => {
		tempDir = makeTempDir();
		globalDir = makeTempDir();
		previousGlobalDir = process.env.CLENS_GLOBAL_DIR;
		process.env.CLENS_GLOBAL_DIR = globalDir;
	});

	afterEach(() => {
		if (previousGlobalDir === undefined) delete process.env.CLENS_GLOBAL_DIR;
		else process.env.CLENS_GLOBAL_DIR = previousGlobalDir;
		// Clean up any test projects we registered
		rmSync(tempDir, { recursive: true, force: true });
		rmSync(globalDir, { recursive: true, force: true });
	});

	describe("readRegistry", () => {
		test("returns valid registry structure", () => {
			const registry = readRegistry();
			expect(registry.version).toBe(1);
			expect(Array.isArray(registry.projects)).toBe(true);
		});
	});

	describe("writeRegistry / readRegistry roundtrip", () => {
		test("write and re-read preserves structure", () => {
			const original = readRegistry();
			writeRegistry(original);
			const reread = readRegistry();
			expect(reread.version).toBe(1);
			expect(Array.isArray(reread.projects)).toBe(true);
		});
	});

	describe("registerProject", () => {
		test("registers a project with correct fields", () => {
			const projectDir = join(tempDir, "my-test-project");
			mkdirSync(join(projectDir, ".clens"), { recursive: true });

			const entry = registerProject(projectDir);
			expect(entry.id).toBe("my-test-project");
			expect(entry.path).toBe(projectDir);
			expect(entry.name).toBe("my-test-project");
			expect(typeof entry.added_at).toBe("number");

			// Cleanup
			unregisterProject(projectDir);
		});

		test("is idempotent — returns same entry on duplicate register", () => {
			const projectDir = join(tempDir, "idempotent-project");
			mkdirSync(join(projectDir, ".clens"), { recursive: true });

			const entry1 = registerProject(projectDir);
			const entry2 = registerProject(projectDir);
			expect(entry2.path).toBe(entry1.path);
			expect(entry2.id).toBe(entry1.id);
			expect(entry2.added_at).toBe(entry1.added_at);

			// Registry should have exactly one entry for this path
			const registry = readRegistry();
			const matches = registry.projects.filter((p) => p.path === projectDir);
			expect(matches.length).toBe(1);

			// Cleanup
			unregisterProject(projectDir);
		});

		test("derives kebab-case id from directory name", () => {
			const projectDir = join(tempDir, "My Cool Project");
			mkdirSync(join(projectDir, ".clens"), { recursive: true });

			const entry = registerProject(projectDir);
			expect(entry.id).toBe("my-cool-project");

			// Cleanup
			unregisterProject(projectDir);
		});

		test("handles directory names with special characters", () => {
			const projectDir = join(tempDir, "project_v2.0--beta");
			mkdirSync(join(projectDir, ".clens"), { recursive: true });

			const entry = registerProject(projectDir);
			// Special chars become hyphens, leading/trailing hyphens stripped
			expect(entry.id).toBe("project-v2-0-beta");

			// Cleanup
			unregisterProject(projectDir);
		});
	});

	describe("unregisterProject", () => {
		test("removes a registered project", () => {
			const projectDir = join(tempDir, "remove-me");
			mkdirSync(join(projectDir, ".clens"), { recursive: true });

			registerProject(projectDir);
			const removed = unregisterProject(projectDir);
			expect(removed).toBe(true);

			const registry = readRegistry();
			expect(registry.projects.find((p) => p.path === projectDir)).toBeUndefined();
		});

		test("returns false for unknown project path", () => {
			const result = unregisterProject(`/nonexistent/path/${Date.now()}`);
			expect(result).toBe(false);
		});
	});

	describe("resolveProjectEntries", () => {
		test("keeps repository-mode entries whose .clens is nested below the git root", () => {
			// Repository mode registers path=gitRoot, but a monorepo may capture into a
			// nested package (gitRoot/packages/web/.clens/sessions). The old existsSync
			// check on `${path}/.clens` dropped these (bug repo-mode-nested-clens-projects-dropped).
			const gitRoot = join(tempDir, "nested-repo");
			const nestedClens = join(gitRoot, "packages", "web", ".clens", "sessions");
			mkdirSync(nestedClens, { recursive: true });
			// Deliberately NO `.clens` directly at gitRoot.
			expect(existsSync(join(gitRoot, ".clens"))).toBe(false);

			const registry = readRegistry();
			writeRegistry({
				...registry,
				projects: [
					...registry.projects,
					{ id: "nested-repo", path: gitRoot, name: "nested-repo", added_at: Date.now() },
				],
			});

			const entries = resolveProjectEntries();
			expect(entries.find((e) => e.path === gitRoot)).toBeDefined();

			// Cleanup
			unregisterProject(gitRoot);
		});

		test("filters out entries whose .clens dir no longer exists", () => {
			const goodProject = join(tempDir, "good-project");
			mkdirSync(join(goodProject, ".clens"), { recursive: true });
			registerProject(goodProject);

			const badProject = join(tempDir, "bad-project");
			mkdirSync(badProject, { recursive: true });
			// Manually insert an entry without .clens dir
			const registry = readRegistry();
			writeRegistry({
				...registry,
				projects: [
					...registry.projects,
					{
						id: "bad-project",
						path: badProject,
						name: "bad-project",
						added_at: Date.now(),
					},
				],
			});

			const entries = resolveProjectEntries();
			const goodEntry = entries.find((e) => e.path === goodProject);
			const badEntry = entries.find((e) => e.path === badProject);

			expect(goodEntry).toBeDefined();
			expect(badEntry).toBeUndefined();

			// Cleanup
			unregisterProject(goodProject);
			unregisterProject(badProject);
		});
	});
});

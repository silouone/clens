import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";


// --- Types ---

export type PluginInstallResult = {
	readonly installed_to: string;
	readonly files_copied: number;
	readonly symlinks_created: number;
	readonly version: string;
};

// --- Constants ---

const PLUGIN_INSTALL_DIR = join(homedir(), ".clens", "plugin", "clens");
const CLAUDE_USER_DIR = join(homedir(), ".claude");

// Mapping from plugin subdirectories to ~/.claude/ subdirectories
const SYMLINK_DIRS = ["agents", "commands", "skills"] as const;

// In compiled Bun binaries, import.meta.dir resolves to /$bunfs/root (virtual FS).
// In that case, use process.execPath (the compiled binary) to find the project root.
// In dev/test mode, import.meta.dir points to the real source directory.
const resolveProjectRoot = (): string => {
	if (!import.meta.dir.startsWith("/$bunfs")) {
		return join(import.meta.dir, "..", "..");
	}
	const realExecPath = realpathSync(process.execPath);
	return join(dirname(realExecPath), "..");
};

const resolvePluginSrcDir = (): string => join(resolveProjectRoot(), "agentic");

// --- Pure helpers ---

const readPackageVersion = (): string => {
	const pkgPath = join(resolveProjectRoot(), "package.json");
	try {
		const raw = readFileSync(pkgPath, "utf-8");
		const pkg: unknown = JSON.parse(raw);
		return typeof pkg === "object" &&
			pkg !== null &&
			"version" in pkg &&
			typeof (pkg as Record<string, unknown>).version === "string"
			? ((pkg as Record<string, unknown>).version as string)
			: "0.0.0";
	} catch {
		return "0.0.0";
	}
};

const collectFiles = (dir: string, base: string): readonly string[] =>
	readdirSync(dir).flatMap((entry): readonly string[] => {
		const fullPath = join(dir, entry);
		const relPath = join(base, entry);
		return statSync(fullPath).isDirectory() ? collectFiles(fullPath, relPath) : [relPath];
	});

// Collect top-level entries (files and dirs) within a directory
const collectTopLevelEntries = (dir: string): readonly string[] =>
	existsSync(dir) ? readdirSync(dir) : [];

// existsSync follows symlinks and returns false for broken symlinks.
// lstatExists checks if the path entry itself exists (even broken symlinks).
const lstatExists = (path: string): boolean => {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
};

const isSymlinkTo = (linkPath: string, targetPath: string): boolean => {
	try {
		return (
			lstatSync(linkPath).isSymbolicLink() && realpathSync(linkPath) === realpathSync(targetPath)
		);
	} catch {
		return false;
	}
};

// --- I/O functions ---

const createSymlinks = (installDir: string): number =>
	SYMLINK_DIRS.filter((subdir) => existsSync(join(installDir, subdir))).reduce((count, subdir) => {
		const srcSubdir = join(installDir, subdir);
		const claudeSubdir = join(CLAUDE_USER_DIR, subdir);
		mkdirSync(claudeSubdir, { recursive: true });

		return (
			count +
			collectTopLevelEntries(srcSubdir)
				.filter((entry) => {
					const linkPath = join(claudeSubdir, entry);
					const linkExists = existsSync(linkPath) || lstatExists(linkPath);
					// Skip if a non-symlink file already exists (don't overwrite user files)
					return !linkExists || lstatSync(linkPath).isSymbolicLink();
				})
				.reduce((innerCount, entry) => {
					const srcPath = join(srcSubdir, entry);
					const linkPath = join(claudeSubdir, entry);
					const linkExists = existsSync(linkPath) || lstatExists(linkPath);

					// Remove stale symlink if it points elsewhere
					if (linkExists && lstatSync(linkPath).isSymbolicLink()) {
						unlinkSync(linkPath);
					}

					symlinkSync(srcPath, linkPath);
					return innerCount + 1;
				}, 0)
		);
	}, 0);

const removeSymlinks = (installDir: string): number =>
	SYMLINK_DIRS.filter(
		(subdir) => existsSync(join(installDir, subdir)) && existsSync(join(CLAUDE_USER_DIR, subdir)),
	).reduce((count, subdir) => {
		const srcSubdir = join(installDir, subdir);
		const claudeSubdir = join(CLAUDE_USER_DIR, subdir);

		return (
			count +
			collectTopLevelEntries(srcSubdir)
				.filter((entry) => isSymlinkTo(join(claudeSubdir, entry), join(srcSubdir, entry)))
				.reduce((innerCount, entry) => {
					unlinkSync(join(claudeSubdir, entry));
					return innerCount + 1;
				}, 0)
		);
	}, 0);

export const installPlugin = (installDir?: string): PluginInstallResult => {
	const srcDir = resolvePluginSrcDir();
	const targetDir = installDir ?? PLUGIN_INSTALL_DIR;
	const version = readPackageVersion();

	const files = collectFiles(srcDir, "");

	// Copy plugin files to install directory
	const copiedCount = files.reduce((count, relPath) => {
		const src = join(srcDir, relPath);
		const dest = join(targetDir, relPath);
		mkdirSync(join(dest, ".."), { recursive: true });
		copyFileSync(src, dest);
		return count + 1;
	}, 0);

	// Create symlinks from ~/.claude/ to installed plugin
	const symlinksCreated = createSymlinks(targetDir);

	return {
		installed_to: targetDir,
		files_copied: copiedCount,
		symlinks_created: symlinksCreated,
		version,
	};
};

export const uninstallPlugin = (installDir?: string): boolean => {
	const targetDir = installDir ?? PLUGIN_INSTALL_DIR;

	if (!existsSync(targetDir)) {
		return false;
	}

	// Remove symlinks from ~/.claude/ first
	removeSymlinks(targetDir);

	// Remove plugin install directory
	rmSync(targetDir, { recursive: true });
	return true;
};

export const isPluginInstalled = (installDir?: string): boolean => {
	const targetDir = installDir ?? PLUGIN_INSTALL_DIR;
	if (!existsSync(targetDir)) return false;

	// Check that symlinks exist in ~/.claude/
	return SYMLINK_DIRS.filter((subdir) => existsSync(join(targetDir, subdir))).every((subdir) => {
		const srcSubdir = join(targetDir, subdir);
		const claudeSubdir = join(CLAUDE_USER_DIR, subdir);
		return collectTopLevelEntries(srcSubdir).every((entry) =>
			isSymlinkTo(join(claudeSubdir, entry), join(srcSubdir, entry)),
		);
	});
};

export const getPluginDir = (): string => resolvePluginSrcDir();

export const validatePluginStructure = (): {
	readonly valid: boolean;
	readonly errors: readonly string[];
} => {
	const srcDir = resolvePluginSrcDir();

	const required = [".claude-plugin/plugin.json", "commands", "skills", "agents"] as const;

	const errors = required.flatMap((entry): readonly string[] =>
		existsSync(join(srcDir, entry)) ? [] : [`Missing required: ${entry}`],
	);

	return {
		valid: errors.length === 0,
		errors,
	};
};


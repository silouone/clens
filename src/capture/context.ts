import type { SessionStartContext } from "../types";

export const enrichSessionStart = (input: Record<string, unknown>): SessionStartContext => {
	const cwd = (input.cwd as string) || process.cwd();
	const projectDir = (input.project_dir as string) || cwd;

	const source = input.source as string | undefined;
	const trigger = input.trigger as string | undefined;
	const validSources = new Set(["startup", "resume", "clear", "compact"]);
	const validTriggers = new Set(["manual", "auto"]);

	return {
		project_dir: projectDir,
		cwd,
		git_branch: getGitBranch(cwd),
		git_remote: getGitRemote(cwd),
		git_commit: getGitCommit(cwd),
		git_worktree: getGitWorktree(cwd),
		team_name: getTeamName(),
		task_list_dir: getTaskListDir(),
		claude_entrypoint: getEnv("CLAUDE_CODE_ENTRYPOINT"),
		model: (input.model as string) || null,
		agent_type: (input.agent_type as string) || null,
		source: source && validSources.has(source)
			? (source as "startup" | "resume" | "clear" | "compact")
			: undefined,
		trigger: trigger && validTriggers.has(trigger)
			? (trigger as "manual" | "auto")
			: undefined,
	};
};

const getGitBranch = (cwd: string): string | null => {
	return runGitSync(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
};

const getGitRemote = (cwd: string): string | null => {
	return runGitSync(cwd, ["remote", "get-url", "origin"]);
};

const getGitCommit = (cwd: string): string | null => {
	return runGitSync(cwd, ["rev-parse", "--verify", "HEAD"]);
};

const getGitWorktree = (cwd: string): string | null => {
	const output = runGitSync(cwd, ["worktree", "list", "--porcelain"]);
	if (!output) return null;
	const entries = output.split("\n\n").filter(Boolean);
	return entries.length > 1 ? cwd : null;
};

const getTeamName = (): string | null => {
	const teamsEnv = getEnv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
	if (teamsEnv) return teamsEnv;

	try {
		const homedir = process.env.HOME || process.env.USERPROFILE || "";
		const teamsDir = `${homedir}/.claude/teams`;
		const { exitCode, stdout } = Bun.spawnSync(["ls", teamsDir], { stderr: "pipe" });
		if (exitCode === 0) {
			const teams = stdout.toString().trim().split("\n").filter(Boolean);
			return teams.length > 0 ? teams[0] : null;
		}
	} catch {
		// Graceful fallback
	}
	return null;
};

const getTaskListDir = (): string | null => {
	const homedir = process.env.HOME || process.env.USERPROFILE || "";
	const teamName = getTeamName();
	if (!teamName) return null;
	return `${homedir}/.claude/tasks/${teamName}`;
};

const getEnv = (name: string): string | null => {
	return process.env[name] || null;
};

const runGitSync = (cwd: string, args: string[]): string | null => {
	try {
		const result = Bun.spawnSync(["git", ...args], {
			cwd,
			stderr: "pipe",
		});
		if (result.exitCode !== 0) return null;
		const output = result.stdout.toString().trim();
		return output || null;
	} catch {
		return null;
	}
};

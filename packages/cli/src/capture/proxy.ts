import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import type { DelegatedHooks } from "../types";

export interface HookOutput {
	permissionDecision?: "allow" | "deny";
	hookSpecificOutput?: Record<string, unknown>;
}

const TIMEOUT_MS = 30_000;

const logError = (projectDir: string, context: string, cmd: string, err: unknown): void => {
	try {
		mkdirSync(`${projectDir}/.clens`, { recursive: true });
		const msg = err instanceof Error ? err.message : String(err);
		const line = `${new Date().toISOString()} [${context}] ${cmd}: ${msg}\n`;
		appendFileSync(`${projectDir}/.clens/errors.log`, line);
	} catch {
		// Even logging failed — truly silent
	}
};

const runHookCommand = async (
	cmd: string,
	stdin: string,
	projectDir: string,
): Promise<HookOutput> => {
	const proc = Bun.spawn(["sh", "-c", cmd], {
		stdin: new Response(stdin),
		stdout: "pipe",
		stderr: "pipe",
		cwd: projectDir,
	});

	const timeoutPromise = new Promise<never>((_, reject) => {
		const id = setTimeout(() => {
			proc.kill();
			reject(new Error(`Hook timed out after ${TIMEOUT_MS}ms: ${cmd}`));
		}, TIMEOUT_MS);
		// Allow process to resolve without keeping timer alive
		proc.exited.then(
			() => clearTimeout(id),
			() => clearTimeout(id),
		);
	});

	const exitCode = await Promise.race([proc.exited, timeoutPromise]);

	if (exitCode !== 0) {
		throw new Error(`Hook exited with code ${exitCode}: ${cmd}`);
	}

	const stdout = await new Response(proc.stdout).text();
	if (!stdout.trim()) return {};

	try {
		const parsed = JSON.parse(stdout);
		return {
			permissionDecision: parsed.permissionDecision,
			hookSpecificOutput: parsed.hookSpecificOutput,
		};
	} catch {
		logError(projectDir, "parse", cmd, new Error(`Malformed hook output: ${stdout.slice(0, 200)}`));
		return {};
	}
};

export const delegateToUserHooks = async (
	eventType: string,
	stdin: string,
	projectDir: string,
): Promise<HookOutput | null> => {
	const delegatedPath = `${projectDir}/.clens/delegated-hooks.json`;

	let delegated: DelegatedHooks;
	try {
		delegated = JSON.parse(readFileSync(delegatedPath, "utf-8"));
	} catch {
		return null;
	}

	const commands = delegated[eventType];
	if (!commands || commands.length === 0) return null;

	let mergedDecision: "allow" | "deny" | undefined;
	let mergedOutput: Record<string, unknown> = {};

	for (const cmd of commands) {
		try {
			const result = await runHookCommand(cmd, stdin, projectDir);

			if (result.permissionDecision) {
				// Most restrictive wins: deny > allow
				if (result.permissionDecision === "deny") {
					mergedDecision = "deny";
				} else if (!mergedDecision) {
					mergedDecision = "allow";
				}
			}

			if (result.hookSpecificOutput) {
				mergedOutput = { ...mergedOutput, ...result.hookSpecificOutput };
			}
		} catch (err) {
			logError(projectDir, eventType, cmd, err);
		}
	}

	if (!mergedDecision && Object.keys(mergedOutput).length === 0) {
		return null;
	}

	return {
		...(mergedDecision ? { permissionDecision: mergedDecision } : {}),
		...(Object.keys(mergedOutput).length > 0 ? { hookSpecificOutput: mergedOutput } : {}),
	};
};

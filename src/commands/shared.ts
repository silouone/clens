import { readdirSync, statSync } from "node:fs";

export type Flags = {
	readonly last: boolean;
	readonly force: boolean;
	readonly otel: boolean;
	readonly deep: boolean;
	readonly json: boolean;
	readonly help: boolean;
	readonly version: boolean;
	readonly detail: boolean;
	readonly full: boolean;
	readonly all: boolean;
	readonly remove: boolean;
	readonly status: boolean;
	readonly dev: boolean;
	readonly comms: boolean;
	readonly global: boolean;
	readonly legacy: boolean;
};

// ANSI color helpers
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export const getProjectDir = (): string => process.cwd();

export const resolveSessionId = (
	input: string | undefined,
	last: boolean,
	projectDir: string,
): string => {
	const sessionsDir = `${projectDir}/.clens/sessions`;

	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl");
		} catch {
			throw new Error("No sessions found. Is clens initialized? Run: clens init");
		}
	})();

	if (files.length === 0) {
		throw new Error("No sessions found.");
	}

	if (last) {
		const latest = files.reduce((best, f) => {
			const stat = statSync(`${sessionsDir}/${f}`);
			const bestStat = statSync(`${sessionsDir}/${best}`);
			return stat.mtimeMs > bestStat.mtimeMs ? f : best;
		});
		return latest.replace(".jsonl", "");
	}

	if (!input) {
		throw new Error(
			"Session ID required. Use --last for most recent, or provide a session ID (partial match supported).",
		);
	}

	// Partial UUID match
	const matches = files.filter((f) => f.startsWith(input));
	if (matches.length === 0) {
		throw new Error(
			`No session matching "${input}". Run 'clens list' to see available sessions.`,
		);
	}
	if (matches.length > 1) {
		throw new Error(
			`Ambiguous session ID "${input}". Matches: ${matches.map((f) => f.replace(".jsonl", "")).join(", ")}`,
		);
	}
	return matches[0].replace(".jsonl", "");
};

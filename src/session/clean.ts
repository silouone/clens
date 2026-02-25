import { existsSync, statSync, unlinkSync } from "node:fs";
import { logError } from "../utils";
import { listSessions } from "./read";

export const cleanSession = (
	sessionId: string,
	projectDir: string,
	options?: { force?: boolean },
): { session_id: string; freed_bytes: number } => {
	const sessionPath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`;
	const distilledPath = `${projectDir}/.clens/distilled/${sessionId}.json`;

	if (!existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found.`);
	}

	if (!options?.force && !existsSync(distilledPath)) {
		throw new Error(
			`Session ${sessionId} has not been distilled. Run 'clens distill ${sessionId}' first, or use --force.`,
		);
	}

	const stat = statSync(sessionPath);
	unlinkSync(sessionPath);

	return { session_id: sessionId, freed_bytes: stat.size };
};

export const cleanAll = (
	projectDir: string,
	options?: { force?: boolean },
): { cleaned: number; freed_bytes: number; skipped: readonly string[] } => {
	const sessions = listSessions(projectDir);

	const isDistilled = (sessionId: string): boolean =>
		existsSync(`${projectDir}/.clens/distilled/${sessionId}.json`);

	const skipped = options?.force
		? []
		: sessions.filter((s) => !isDistilled(s.session_id)).map((s) => s.session_id);

	const deletable = options?.force
		? sessions
		: sessions.filter((s) => isDistilled(s.session_id));

	const deleted = deletable.flatMap((session) => {
		const sessionPath = `${projectDir}/.clens/sessions/${session.session_id}.jsonl`;
		try {
			unlinkSync(sessionPath);
			return [session.file_size_bytes];
		} catch (err) {
			logError(projectDir, `cleanAll:${session.session_id}`, err);
			return [];
		}
	});

	return {
		cleaned: deleted.length,
		freed_bytes: deleted.reduce((sum, bytes) => sum + bytes, 0),
		skipped,
	};
};

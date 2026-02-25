import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { DistilledSession, LinkEvent, SessionSummary, SpawnLink, StoredEvent } from "../types";
import { BROADCAST_EVENTS } from "../types";
import { computeEffectiveDuration, isGhostSession, logError } from "../utils";
import { parseDistilledSession, parseLinkEvent } from "./parsers";
import { readSessionName } from "./transcript";

/** Parse a JSON line into a StoredEvent, returning undefined for invalid data. */
const parseEvent = (line: string): StoredEvent | undefined => {
	try {
		const parsed: unknown = JSON.parse(line);
		if (parsed && typeof parsed === "object" && "event" in parsed) return parsed as StoredEvent;
		return undefined;
	} catch {
		return undefined;
	}
};

export const listSessions = (projectDir: string): SessionSummary[] => {
	const sessionsDir = `${projectDir}/.clens/sessions`;

	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl");
		} catch {
			return [];
		}
	})();

	if (files.length === 0) return [];

	const sessions = files
		.flatMap((file): SessionSummary[] => {
			const filePath = `${sessionsDir}/${file}`;
			const sessionId = file.replace(".jsonl", "");

			try {
				const stat = statSync(filePath);
				const content = readFileSync(filePath, "utf-8").trim();
				const lines = content.split("\n").filter(Boolean);

				if (lines.length === 0) return [];

				const firstEvent = parseEvent(lines[0]);
				if (!firstEvent) return [];

				// Ghost session filtering: if first event is broadcast, check all events
				if (BROADCAST_EVENTS.has(firstEvent.event)) {
					const allEvents: readonly StoredEvent[] = lines.flatMap((l): readonly StoredEvent[] => {
						const e = parseEvent(l);
						return e ? [e] : [];
					});
					if (isGhostSession(allEvents)) return [];
				}

				// Performance-optimized backward scan: parse only trailing broadcast events
				const parsedLines: readonly (StoredEvent | undefined)[] = lines.map(parseEvent);
				const meaningfulLast: StoredEvent | undefined =
					parsedLines.findLast((e): e is StoredEvent => e !== undefined && !BROADCAST_EVENTS.has(e.event))
					?? parsedLines.findLast((e): e is StoredEvent => e !== undefined);

				if (!meaningfulLast) return [];
				const startTime = firstEvent.t;
				const endTime = meaningfulLast.t;
				const timestamps = parsedLines.filter((e): e is StoredEvent => e !== undefined).map((e) => e.t);
				const effectiveDuration = computeEffectiveDuration(timestamps);
				const isComplete = meaningfulLast.event === "SessionEnd" || meaningfulLast.event === "Stop";

				const source =
					typeof firstEvent.data.source === "string" ? firstEvent.data.source : undefined;
				const endReason =
					typeof meaningfulLast.data.reason === "string" ? meaningfulLast.data.reason : undefined;

				return [
					{
						session_id: sessionId,
						start_time: startTime,
						end_time: isComplete ? endTime : undefined,
						duration_ms: effectiveDuration.effective_duration_ms,
						event_count: lines.length,
						git_branch: firstEvent.context?.git_branch || undefined,
						team_name: firstEvent.context?.team_name || undefined,
						source,
						end_reason: endReason,
						status: isComplete ? "complete" : "incomplete",
						file_size_bytes: stat.size,
					},
				];
			} catch (err) {
				logError(projectDir, `listSessions:${sessionId}`, err);
				return [];
			}
		})
		.sort((a, b) => b.start_time - a.start_time);

	return sessions;
};

export const readSessionEvents = (sessionId: string, projectDir: string): StoredEvent[] => {
	const filePath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`;
	if (!existsSync(filePath)) {
		throw new Error(`Session file not found: ${sessionId}. Run 'clens list' to see available sessions.`);
	}
	const content = readFileSync(filePath, "utf-8").trim();
	return content
		.split("\n")
		.filter(Boolean)
		.flatMap((line): StoredEvent[] => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
};

/**
 * Read and parse link events from _links.jsonl.
 * Returns an empty array if the file does not exist or cannot be parsed.
 */
export const readLinks = (projectDir: string): readonly LinkEvent[] => {
	const linksPath = `${projectDir}/.clens/sessions/_links.jsonl`;
	if (!existsSync(linksPath)) return [];
	try {
		const content = readFileSync(linksPath, "utf-8").trim();
		if (!content) return [];
		return content
			.split("\n")
			.filter(Boolean)
			.flatMap((line): readonly LinkEvent[] => {
				const parsed = parseLinkEvent(line);
				return parsed ? [parsed] : [];
			});
	} catch (err) {
		logError(projectDir, "readLinks", err);
		return [];
	}
};

/**
 * Read and parse a distilled session JSON file.
 * Returns undefined if the file does not exist or cannot be parsed.
 */
export const readDistilled = (
	sessionId: string,
	projectDir: string,
): DistilledSession | undefined => {
	const distilledPath = `${projectDir}/.clens/distilled/${sessionId}.json`;
	if (!existsSync(distilledPath)) return undefined;
	try {
		const content = readFileSync(distilledPath, "utf-8");
		return parseDistilledSession(content);
	} catch (err) {
		logError(projectDir, `readDistilled:${sessionId}`, err);
		return undefined;
	}
};

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

/**
 * Extract transcript_path from the first event of a session JSONL file that has one.
 * Reads the file content and scans events until it finds one with `data.transcript_path`.
 * Returns null if the file doesn't exist, is empty, or no event has transcript_path.
 */
const resolveTranscriptPathFromSession = (sessionId: string, projectDir: string): string | null => {
	const filePath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`;
	try {
		if (!existsSync(filePath)) return null;
		const content = readFileSync(filePath, "utf-8").trim();
		if (!content) return null;
		const lines = content.split("\n").filter(Boolean);
		const match = lines.reduce<string | null>((acc, line) => {
			if (acc) return acc;
			const event = parseEvent(line);
			const tPath = event?.data?.transcript_path;
			return typeof tPath === "string" ? tPath : null;
		}, null);
		return match;
	} catch {
		return null;
	}
};

/**
 * Enrich session summaries with agent count, distill status, spec presence, and session name.
 * Reads links once and scans the distilled directory to annotate each session.
 */
export const enrichSessionSummaries = (
	sessions: readonly SessionSummary[],
	projectDir: string,
): readonly SessionSummary[] => {
	const links = readLinks(projectDir);
	const spawns = links.filter(isSpawnLink);

	// Count spawn links per parent_session
	const spawnCountByParent: ReadonlyMap<string, number> = spawns.reduce<ReadonlyMap<string, number>>(
		(acc, spawn) => {
			const current = acc.get(spawn.parent_session) ?? 0;
			return new Map([...acc, [spawn.parent_session, current + 1]]);
		},
		new Map(),
	);

	// Fallback: count unique msg_send recipients per session when no spawns exist
	const msgRecipientsBySession: ReadonlyMap<string, number> = (() => {
		const msgSends = links.filter((l): l is Extract<LinkEvent, { type: "msg_send" }> => l.type === "msg_send");
		const bySession = msgSends.reduce<ReadonlyMap<string, ReadonlySet<string>>>(
			(acc, msg) => {
				const sid = msg.session_id ?? msg.from;
				const existing = acc.get(sid) ?? new Set<string>();
				return new Map([...acc, [sid, new Set([...existing, msg.to])]]);
			},
			new Map(),
		);
		return new Map([...bySession].map(([sid, recipients]) => [sid, recipients.size]));
	})();

	return sessions.map((session): SessionSummary => {
		const spawnCount = spawnCountByParent.get(session.session_id) ?? 0;
		const agentCount = spawnCount > 0
			? spawnCount
			: msgRecipientsBySession.get(session.session_id) ?? 0;
		const distilledPath = `${projectDir}/.clens/distilled/${session.session_id}.json`;
		const isDistilled = existsSync(distilledPath);

		const hasSpec = isDistilled
			? (() => {
					try {
						const content = readFileSync(distilledPath, "utf-8");
						return content.includes('"plan_drift"');
					} catch (err) {
						logError(projectDir, `enrichSessionSummaries:${session.session_id}`, err);
						return false;
					}
				})()
			: false;

		// Resolve session name from transcript custom-title event
		const session_name = (() => {
			const tPath = resolveTranscriptPathFromSession(session.session_id, projectDir);
			return tPath ? readSessionName(tPath) ?? undefined : undefined;
		})();

		return {
			...session,
			...(session_name ? { session_name } : {}),
			agent_count: agentCount,
			is_distilled: isDistilled,
			has_spec: hasSpec,
		};
	});
};

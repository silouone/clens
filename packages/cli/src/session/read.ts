import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { repriceCostEstimate } from "../distill/stats";
import type {
	AgentNode,
	CostEstimate,
	DistilledSession,
	LinkEvent,
	SessionSummary,
	SpawnLink,
	StoredEvent,
} from "../types";
import { BROADCAST_EVENTS, deriveSessionStatus } from "../types";
import { computeEffectiveDuration, deduplicateSpawns, isGhostSession, logError } from "../utils";
import { parseDistilledSession, parseLinkEvent } from "./parsers";
import { readSessionMeta } from "./session-meta";
import { computeSessionName, resolveDisplayName } from "./session-name";
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
					parsedLines.findLast(
						(e): e is StoredEvent => e !== undefined && !BROADCAST_EVENTS.has(e.event),
					) ?? parsedLines.findLast((e): e is StoredEvent => e !== undefined);

				if (!meaningfulLast) return [];
				const startTime = firstEvent.t;
				const endTime = meaningfulLast.t;
				const timestamps = parsedLines
					.filter((e): e is StoredEvent => e !== undefined)
					.map((e) => e.t);
				const effectiveDuration = computeEffectiveDuration(timestamps);
				// A clean SessionEnd marks completion. A trailing Stop no longer does
				// (it fires after every turn — bug B6). Non-ended sessions are active
				// only while their last event is recent, else idle.
				const isSessionEnd = meaningfulLast.event === "SessionEnd";
				const status = deriveSessionStatus(isSessionEnd, endTime);

				const source =
					typeof firstEvent.data.source === "string" ? firstEvent.data.source : undefined;
				const endReason =
					typeof meaningfulLast.data.reason === "string" ? meaningfulLast.data.reason : undefined;

				return [
					{
						session_id: sessionId,
						start_time: startTime,
						end_time: isSessionEnd ? endTime : undefined,
						// Wall-clock span — must agree with the web list (bug B2: same field
						// carried wall in the API but idle-trimmed here, so list views disagreed)
						duration_ms: effectiveDuration.wall_duration_ms,
						event_count: lines.length,
						git_branch: firstEvent.context?.git_branch || undefined,
						team_name: firstEvent.context?.team_name || undefined,
						source,
						end_reason: endReason,
						status,
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
		throw new Error(
			`Session file not found: ${sessionId}. Run 'clens list' to see available sessions.`,
		);
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
 * Read an arbitrary UTF-8 text file, returning undefined when it is missing or
 * unreadable. The fs-backed default for the distill layer's injected `readTextFile`
 * seam (config + plan-drift spec reads) — callers that need in-memory fakes for
 * tests supply their own function instead of this one.
 */
export const readTextFileOrUndefined = (path: string): string | undefined => {
	if (!existsSync(path)) return undefined;
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return undefined;
	}
};

/**
 * Re-price an agent node (and its children) at the current pricing table.
 * `children` is typed non-optional, but the parse guard (parsers.ts) never
 * validates it, so a legacy/partial on-disk distill can omit it — guard with
 * `?? []` so re-pricing never throws and silently drops the whole session.
 */
const repriceAgent = (a: AgentNode): AgentNode => ({
	...a,
	cost_estimate: a.cost_estimate ? repriceCostEstimate(a.cost_estimate) : a.cost_estimate,
	children: (a.children ?? []).map(repriceAgent),
});

/**
 * Re-price a distilled session's frozen cost estimates against the CURRENT pricing
 * table, for DISPLAY only. Distilled `cost_estimate` values are frozen at
 * distill-time rates; when the API price table changes (e.g. Opus 4.5+ dropping
 * ~3x) those numbers become stale. The on-disk JSON stays the frozen record — this
 * only transforms the in-memory object returned to callers. Covers the
 * session-level estimate (top-level + `stats`) and every (nested) agent estimate.
 * Verbatim measured costs are left unchanged by `repriceCostEstimate`.
 */
const repriceDistilled = (d: DistilledSession): DistilledSession => {
	const reprice = (ce: CostEstimate | undefined): CostEstimate | undefined =>
		ce ? repriceCostEstimate(ce) : ce;
	return {
		...d,
		cost_estimate: reprice(d.cost_estimate),
		stats: { ...d.stats, cost_estimate: reprice(d.stats.cost_estimate) },
		agents: d.agents?.map(repriceAgent),
	};
};

/**
 * Read and parse a distilled session JSON file.
 * Returns undefined if the file does not exist or cannot be parsed.
 * Cost estimates are re-priced against the current table for display; the
 * on-disk file remains the frozen distill-time record.
 */
export const readDistilled = (
	sessionId: string,
	projectDir: string,
): DistilledSession | undefined => {
	const distilledPath = `${projectDir}/.clens/distilled/${sessionId}.json`;
	if (!existsSync(distilledPath)) return undefined;
	try {
		const content = readFileSync(distilledPath, "utf-8");
		const parsed = parseDistilledSession(content);
		return parsed ? repriceDistilled(parsed) : parsed;
	} catch (err) {
		logError(projectDir, `readDistilled:${sessionId}`, err);
		return undefined;
	}
};

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

/**
 * Count agents in a distilled JSON file recursively (children at every depth).
 * Returns 0 if the file is missing or cannot be parsed. Used as the authoritative
 * agent count when a session has been distilled (bug B15 — one source of truth).
 */
const countDistilledAgents = (distilledPath: string): number => {
	try {
		const parsed: unknown = JSON.parse(readFileSync(distilledPath, "utf-8"));
		const agents =
			parsed && typeof parsed === "object" ? (parsed as { agents?: unknown }).agents : undefined;
		const countRecursive = (nodes: readonly { children?: readonly unknown[] }[]): number =>
			nodes.reduce(
				(sum, n) =>
					sum +
					1 +
					countRecursive((n.children ?? []) as readonly { children?: readonly unknown[] }[]),
				0,
			);
		return Array.isArray(agents)
			? countRecursive(agents as readonly { children?: readonly unknown[] }[])
			: 0;
	} catch {
		return 0;
	}
};

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
 * Extract the first substantive user prompt from a session JSONL file.
 * Scans for the first `UserPromptSubmit` event with a string `data.prompt`.
 * Returns null if the file is missing/empty or no such event exists. The raw
 * prompt is returned verbatim; cleaning/truncation is done by computeSessionName.
 */
const readFirstPrompt = (sessionId: string, projectDir: string): string | null => {
	const filePath = `${projectDir}/.clens/sessions/${sessionId}.jsonl`;
	try {
		if (!existsSync(filePath)) return null;
		const content = readFileSync(filePath, "utf-8").trim();
		if (!content) return null;
		const lines = content.split("\n").filter(Boolean);
		return lines.reduce<string | null>((acc, line) => {
			if (acc !== null) return acc;
			const event = parseEvent(line);
			if (event?.event !== "UserPromptSubmit") return null;
			const prompt = event.data?.prompt;
			return typeof prompt === "string" ? prompt : null;
		}, null);
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
	// Load the cLens sidecar ONCE per listing, not per session (R16).
	const sessionMeta = readSessionMeta(projectDir);
	// Deduplicate by agent_id so resumed agents (which emit multiple spawn events)
	// count once. This must match the web list route exactly (bug B15 — CLI counted
	// raw spawn links while the API counted distinct agents, so they disagreed).
	const spawns = deduplicateSpawns(links.filter(isSpawnLink));

	// Count deduplicated spawn links per parent_session
	const spawnCountByParent: ReadonlyMap<string, number> = spawns.reduce<Map<string, number>>(
		(acc, spawn) => {
			const current = acc.get(spawn.parent_session) ?? 0;
			acc.set(spawn.parent_session, current + 1);
			return acc;
		},
		new Map(),
	);

	// Fallback: count unique msg_send recipients per session when no spawns exist
	const msgRecipientsBySession: ReadonlyMap<string, number> = (() => {
		const msgSends = links.filter(
			(l): l is Extract<LinkEvent, { type: "msg_send" }> => l.type === "msg_send",
		);
		const bySession = msgSends.reduce<Map<string, Set<string>>>((acc, msg) => {
			const sid = msg.session_id ?? msg.from;
			const existing = acc.get(sid);
			if (existing) existing.add(msg.to);
			else acc.set(sid, new Set([msg.to]));
			return acc;
		}, new Map());
		return new Map([...bySession].map(([sid, recipients]) => [sid, recipients.size]));
	})();

	return sessions.map((session): SessionSummary => {
		const distilledPath = `${projectDir}/.clens/distilled/${session.session_id}.json`;
		const isDistilled = existsSync(distilledPath);

		// Single source of truth (bug B15): distilled agent count when distilled,
		// else deduplicated spawn links, else unique msg_send recipients.
		const distilledCount = isDistilled ? countDistilledAgents(distilledPath) : 0;
		const spawnCount = spawnCountByParent.get(session.session_id) ?? 0;
		const agentCount =
			distilledCount > 0
				? distilledCount
				: spawnCount > 0
					? spawnCount
					: (msgRecipientsBySession.get(session.session_id) ?? 0);

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

		// Resolve session name from transcript custom-title event (legacy field kept).
		const customTitle = (() => {
			const tPath = resolveTranscriptPathFromSession(session.session_id, projectDir);
			return tPath ? (readSessionName(tPath) ?? undefined) : undefined;
		})();

		// Resolve the display name by precedence: sidecar label > CC custom-title >
		// computed first-prompt > short id (R1/R5). Sidecar carries label + color.
		const meta = sessionMeta[session.session_id];
		const computed = computeSessionName(readFirstPrompt(session.session_id, projectDir));
		const { display_name, name_source } = resolveDisplayName({
			label: meta?.label ?? null,
			customTitle: customTitle ?? null,
			computed,
			id: session.session_id,
		});

		return {
			...session,
			...(customTitle ? { session_name: customTitle } : {}),
			display_name,
			name_source,
			...(meta?.label ? { label: meta.label } : {}),
			...(meta?.color ? { color: meta.color } : {}),
			agent_count: agentCount,
			is_distilled: isDistilled,
			has_spec: hasSpec,
		};
	});
};

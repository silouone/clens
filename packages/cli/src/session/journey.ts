import { existsSync, readFileSync } from "node:fs";
import type { SessionChainInput } from "../distill/journey";
import { chainSessions, composeJourney } from "../distill/journey";
import { computePlanDrift } from "../distill/plan-drift";
import type { Journey, StatsResult, StoredEvent } from "../types";
import { listSessions, readDistilled, readSessionEvents } from "./read";

// --- Helpers ---

const extractSource = (
	summarySource: string | undefined,
	events: readonly StoredEvent[],
): string | undefined =>
	summarySource ?? (typeof events[0]?.data.source === "string" ? events[0].data.source : undefined);

const extractCwd = (events: readonly StoredEvent[]): string | undefined => {
	const first = events[0];
	if (!first) return undefined;
	if (typeof first.data.cwd === "string") return first.data.cwd;
	if (typeof first.context?.cwd === "string") return first.context.cwd;
	return undefined;
};

const extractGitCommit = (events: readonly StoredEvent[]): string | undefined =>
	events[0]?.context?.git_commit ?? undefined;

const extractFirstPrompt = (events: readonly StoredEvent[]): string | undefined => {
	const promptEvent = events.find((e) => e.event === "UserPromptSubmit");
	return typeof promptEvent?.data.prompt === "string" ? promptEvent.data.prompt : undefined;
};

const extractToolsByName = (
	sessionId: string,
	projectDir: string,
): Readonly<Record<string, number>> | undefined => {
	try {
		const distilled = readDistilled(sessionId, projectDir);
		return distilled?.stats.tools_by_name;
	} catch {
		return undefined;
	}
};

// --- Function 1: buildSessionChainInputs ---

export const buildSessionChainInputs = (projectDir: string): readonly SessionChainInput[] => {
	const sessions = listSessions(projectDir);

	return sessions.flatMap((session): readonly SessionChainInput[] => {
		try {
			const allEvents = readSessionEvents(session.session_id, projectDir);
			const headEvents = allEvents.slice(0, 10);

			const source = extractSource(session.source, headEvents);
			const cwd = extractCwd(headEvents);
			const git_commit = extractGitCommit(headEvents);
			const first_prompt = extractFirstPrompt(headEvents);
			const tools_by_name = extractToolsByName(session.session_id, projectDir);

			return [
				{
					session_id: session.session_id,
					start_time: session.start_time,
					end_time: session.end_time,
					cwd,
					source,
					end_reason: session.end_reason,
					event_count: session.event_count,
					duration_ms: session.duration_ms,
					git_commit,
					first_prompt,
					tools_by_name,
				},
			];
		} catch {
			return [];
		}
	});
};

// --- Function 2: loadStatsMap ---

export const loadStatsMap = (
	sessionIds: readonly string[],
	projectDir: string,
): ReadonlyMap<string, StatsResult> =>
	new Map(
		sessionIds.flatMap((sid): readonly [string, StatsResult][] => {
			try {
				const distilled = readDistilled(sid, projectDir);
				return distilled ? [[sid, distilled.stats]] : [];
			} catch {
				return [];
			}
		}),
	);

// --- Function 3: listJourneys ---

export const listJourneys = (projectDir: string): readonly Journey[] => {
	const chainInputs = buildSessionChainInputs(projectDir);

	if (chainInputs.length === 0) return [];

	const groups = chainSessions(chainInputs);

	const inputMap: ReadonlyMap<string, SessionChainInput> = new Map(
		chainInputs.map((input) => [input.session_id, input]),
	);

	const journeys = groups.map((group) => {
		const statsMap = loadStatsMap(group, projectDir);
		const journey = composeJourney(group, inputMap, statsMap);

		if (!journey.spec_ref) return journey;

		try {
			const specPath = `${projectDir}/${journey.spec_ref}`;
			if (!existsSync(specPath)) return journey;

			const specContent = readFileSync(specPath, "utf-8");
			const fileMaps = group.flatMap((sid) => {
				const distilled = readDistilled(sid, projectDir);
				return distilled?.file_map ? [distilled.file_map] : [];
			});

			const drift = computePlanDrift(journey.spec_ref, specContent, fileMaps, projectDir);
			return { ...journey, plan_drift: drift };
		} catch {
			return journey;
		}
	});

	return [...journeys].sort((a, b) => {
		const aTime = inputMap.get(a.phases[0]?.session_id ?? "")?.start_time ?? 0;
		const bTime = inputMap.get(b.phases[0]?.session_id ?? "")?.start_time ?? 0;
		return bTime - aTime;
	});
};

// --- Function 4: resolveJourneyId ---

export const resolveJourneyId = (
	input: string | undefined,
	last: boolean,
	projectDir: string,
): Journey => {
	const journeys = listJourneys(projectDir);

	if (journeys.length === 0) {
		throw new Error("No journeys found. Run 'clens distill' on some sessions first.");
	}

	if (last) return journeys[0];

	if (input === undefined) {
		throw new Error("No journey ID provided. Use --last or specify a journey ID prefix.");
	}

	const matches = journeys.filter((j) => j.id.startsWith(input));

	if (matches.length === 0) {
		// Try matching by session ID within journey phases
		const sessionMatches = journeys.filter((j) =>
			j.phases.some((p) => p.session_id.startsWith(input)),
		);
		if (sessionMatches.length === 1) return sessionMatches[0];
		if (sessionMatches.length > 1) {
			throw new Error(
				`Ambiguous session ID "${input}" matches ${sessionMatches.length} journeys. Provide a longer prefix.`,
			);
		}
		throw new Error(
			`No journey matching "${input}". Run 'clens journey list' to see available journeys.`,
		);
	}

	if (matches.length > 1) {
		throw new Error(
			`Ambiguous journey ID "${input}" matches ${matches.length} journeys: ${matches.map((j) => j.id).join(", ")}. Provide a longer prefix.`,
		);
	}

	return matches[0];
};

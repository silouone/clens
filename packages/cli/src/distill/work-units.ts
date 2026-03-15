import type {
	FileMapResult,
	PhaseInfo,
	PhaseType,
	PlanDriftReport,
	WorkUnit,
	WorkUnitIndex,
	WorkUnitSession,
	WorkUnitSessionRole,
} from "../types";
import type { TranscriptUserMessage } from "../types/transcript";

// --- Module-internal types ---

export interface WorkUnitSessionMeta {
	readonly session_id: string;
	readonly session_name?: string;
	readonly start_time: number;
	readonly duration_ms: number;
	readonly phase: PhaseType | "other";
	readonly git_branch?: string;
}

export interface DistilledSessionSummary {
	readonly session_id: string;
	readonly session_name?: string;
	readonly start_time: number;
	readonly file_map: FileMapResult;
	readonly plan_drift?: PlanDriftReport;
	readonly user_messages: readonly TranscriptUserMessage[];
	readonly duration_ms: number;
	readonly git_branch?: string;
	readonly tool_call_count: number;
	readonly summary_phases?: readonly PhaseInfo[];
}

// --- Spec path pattern ---

const SPEC_PATH_RE = /specs\/[^\s]+\.md/;

const EXCLUDED_BRANCHES = new Set(["main", "master", "develop"]);

const DEFAULT_GAP_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

// --- Phase inference ---

/**
 * Map a distilled summary phase name (e.g. "Build", "File Exploration") to a PhaseType.
 */
const mapSummaryPhaseToPhaseType = (name: string): PhaseType | undefined => {
	const lower = name.toLowerCase();
	if (lower === "build" || lower === "code modification" || lower === "implementation") return "build";
	if (lower === "planning" || lower === "plan") return "plan";
	if (lower === "file exploration" || lower === "exploration" || lower === "prime" || lower === "priming") return "prime";
	if (lower === "review" || lower === "code review" || lower === "validation") return "review";
	if (lower === "testing" || lower === "test") return "test";
	return undefined;
};

/**
 * Infer the phase of a distilled session from its content.
 * Priority: user message pattern -> plan_drift -> summary.phases[0] -> tool count heuristic -> "other"
 *
 * User-explicit intent (slash commands, headings) is the strongest signal — always wins.
 * plan_drift.spec_path is a derived signal that only kicks in as fallback.
 */
export const inferPhase = (s: DistilledSessionSummary): PhaseType | "other" => {
	// 1. User message pattern matching — explicit intent is the strongest signal
	const messages = s.user_messages.slice(0, 3);
	const PHASE_PATTERNS: readonly [RegExp, PhaseType][] = [
		[/\/prime\b|^#\s*Prime\b|<command-message>prime<\/command-message>/im, "prime"],
		[/\/plan\b|^#\s*Plan\b|<command-message>plan<\/command-message>/im, "plan"],
		[/\/build\b|^#\s*Build\b|<command-message>build<\/command-message>/im, "build"],
		[/\/review\b|^#\s*Review\b|<command-message>review<\/command-message>/im, "review"],
	];
	const matchedPhase = messages.reduce<PhaseType | undefined>(
		(found, msg) => found ?? PHASE_PATTERNS.find(([re]) => re.test(msg.content))?.[1],
		undefined,
	);
	if (matchedPhase) return matchedPhase;

	// 2. plan_drift.spec_path → session was tracking against a spec (likely build)
	if (s.plan_drift?.spec_path) return "build";

	// 3. Fall back to distilled summary phases (already analyzed during distillation)
	const firstSummaryPhase = s.summary_phases?.[0];
	if (firstSummaryPhase) {
		const mapped = mapSummaryPhaseToPhaseType(firstSummaryPhase.name);
		if (mapped) return mapped;
	}

	// 4. Heuristic: sessions with significant tool usage are likely build work
	if (s.tool_call_count >= 10) return "build";

	return "other";
};

// --- Spec path normalization ---

/**
 * Strip absolute path prefix from spec paths, keeping only from `specs/` onward.
 */
export const normalizeSpecPath = (path: string): string => {
	const idx = path.indexOf("specs/");
	return idx >= 0 ? path.slice(idx) : path;
};

// --- Hash utility ---

const simpleHash = (input: string): string => {
	const hash = [...input].reduce(
		(acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0,
		0,
	);
	return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8);
};

// --- detectSpecCreators ---

/**
 * Scan sessions to find those that WROTE spec files.
 * Returns Map: spec_path -> session_ids[] (all writers, sorted by start_time ascending).
 * Downstream logic picks the best creator using phase context.
 */
export const detectSpecCreators = (
	sessions: readonly DistilledSessionSummary[],
): ReadonlyMap<string, readonly string[]> => {
	const pairs = sessions.flatMap((session) =>
		session.file_map.files
			.filter(
				(f) =>
					SPEC_PATH_RE.test(f.file_path) &&
					(f.writes > 0 || f.edits > 0),
			)
			.map((f) => ({
				spec_path: normalizeSpecPath(f.file_path),
				session_id: session.session_id,
				start_time: session.start_time,
			})),
	);

	// Group by spec_path, collect all writers sorted by start_time
	const grouped = pairs.reduce<
		Readonly<Record<string, readonly { readonly session_id: string; readonly start_time: number }[]>>
	>(
		(acc, pair) => {
			const existing = acc[pair.spec_path] ?? [];
			return { ...acc, [pair.spec_path]: [...existing, { session_id: pair.session_id, start_time: pair.start_time }] };
		},
		{},
	);

	return new Map(
		Object.entries(grouped).map(([spec, writers]) => [
			spec,
			[...writers].sort((a, b) => a.start_time - b.start_time).map((w) => w.session_id),
		]),
	);
};

// --- detectSpecConsumers ---

/**
 * Check plan_drift.spec_path, scan first 5 user_messages, and fall back to
 * file_map spec reads for spec path references.
 * Returns Map: spec_path -> session_id[] (deduplicated).
 */
export const detectSpecConsumers = (
	sessions: readonly DistilledSessionSummary[],
): ReadonlyMap<string, readonly string[]> => {
	const pairs = sessions.flatMap((session) => {
		const fromDrift: readonly string[] = session.plan_drift?.spec_path
			? [normalizeSpecPath(session.plan_drift.spec_path)]
			: [];

		const fromMessages: readonly string[] = session.user_messages
			.slice(0, 5)
			.flatMap((msg) => {
				const match = msg.content.match(SPEC_PATH_RE);
				return match ? [normalizeSpecPath(match[0])] : [];
			});

		// Fallback: detect spec consumption via file_map reads
		const fromFileMap: readonly string[] = (fromDrift.length === 0 && fromMessages.length === 0)
			? session.file_map.files
				.filter((f) => SPEC_PATH_RE.test(f.file_path) && f.reads > 0)
				.map((f) => normalizeSpecPath(f.file_path))
			: [];

		const specPaths = [...new Set([...fromDrift, ...fromMessages, ...fromFileMap])];
		return specPaths.map((spec_path) => ({
			spec_path,
			session_id: session.session_id,
		}));
	});

	return pairs.reduce<ReadonlyMap<string, readonly string[]>>(
		(acc, pair) => {
			const existing = acc.get(pair.spec_path) ?? [];
			const deduped = existing.includes(pair.session_id)
				? existing
				: [...existing, pair.session_id];
			return new Map([...acc, [pair.spec_path, deduped]]);
		},
		new Map(),
	);
};

// --- classifyLifecycle ---

/**
 * Classify the lifecycle of a work unit based on session phases AND temporal order.
 * Sessions must be sorted by start_time. Only labels "X > Y" if X temporally precedes Y.
 */
const classifyLifecycle = (
	sessions: readonly WorkUnitSession[],
): WorkUnit["lifecycle"] => {
	// Sessions should already be sorted by start_time
	const sorted = [...sessions].sort((a, b) => a.start_time - b.start_time);

	// Find temporal index of first occurrence of each phase category
	const firstPlanningIdx = sorted.findIndex((s) => s.phase === "prime" || s.phase === "plan");
	const firstBuildIdx = sorted.findIndex((s) => s.phase === "build" || s.phase === "orchestrated_build");
	const firstReviewIdx = sorted.findIndex((s) => s.phase === "review" || s.phase === "test");

	const hasPlanning = firstPlanningIdx >= 0;
	const hasBuild = firstBuildIdx >= 0;
	const hasReview = firstReviewIdx >= 0;

	// Temporal order checks: "X > Y" only if X came before Y
	const planningBeforeBuild = hasPlanning && hasBuild && firstPlanningIdx < firstBuildIdx;
	const buildBeforeReview = hasBuild && hasReview && firstBuildIdx < firstReviewIdx;
	const planningBeforeReview = hasPlanning && hasReview && firstPlanningIdx < firstReviewIdx;

	const hasPrime = sorted.some((s) => s.phase === "prime");
	const hasPlan = sorted.some((s) => s.phase === "plan");
	const consumerCount = sorted.filter((s) => s.role === "consumer").length;

	// Lifecycle requires correct temporal ordering
	if (planningBeforeBuild && buildBeforeReview) return "plan-build-review";
	if (hasPrime && hasPlan && planningBeforeBuild) return "prime-plan-build";
	if (hasPrime && planningBeforeBuild) return "prime-build";
	if (planningBeforeBuild) return "plan-build";
	if (consumerCount > 1) return "multi-build";
	return "ad-hoc";
};

// --- Phase-aware creator selection ---

const PLANNING_PHASES = new Set<string>(["plan", "prime"]);

/**
 * Pick the best creator from a list of spec writers using phase context.
 * Prefers planning-phase writers (plan/prime) over build-phase writers.
 * Falls back to earliest writer if no planning-phase writer exists.
 */
const pickBestCreator = (
	writerIds: readonly string[],
	sessionMeta: ReadonlyMap<string, WorkUnitSessionMeta>,
): string | undefined => {
	if (writerIds.length === 0) return undefined;

	const withMeta = writerIds.flatMap((id) => {
		const meta = sessionMeta.get(id);
		return meta ? [meta] : [];
	});
	if (withMeta.length === 0) return undefined;

	// Prefer writers with planning phases (plan, prime)
	const planningWriter = withMeta.find((m) => PLANNING_PHASES.has(m.phase));
	if (planningWriter) return planningWriter.session_id;

	// Fall back to earliest writer (writerIds already sorted by start_time)
	return withMeta[0].session_id;
};

// --- buildSpecWorkUnits ---

/**
 * Build WorkUnit[] from writers + consumers + session metadata.
 * Uses phase-aware creator selection: prefers planning-phase writers over build-phase writers.
 */
export const buildSpecWorkUnits = (
	writers: ReadonlyMap<string, readonly string[]>,
	consumers: ReadonlyMap<string, readonly string[]>,
	sessionMeta: ReadonlyMap<string, WorkUnitSessionMeta>,
): readonly WorkUnit[] => {
	const allSpecPaths = [
		...new Set([...writers.keys(), ...consumers.keys()]),
	];

	return allSpecPaths.map((specPath) => {
		const writerIds = writers.get(specPath) ?? [];
		const consumerIds = consumers.get(specPath) ?? [];
		const creatorId = pickBestCreator(writerIds, sessionMeta);

		// All unique session IDs involved (writers + consumers, deduplicated)
		const allIds = [...new Set([...writerIds, ...consumerIds])];

		const toSession = (id: string, role: WorkUnitSessionRole): WorkUnitSession | undefined => {
			const meta = sessionMeta.get(id);
			return meta ? {
				session_id: meta.session_id,
				session_name: meta.session_name,
				phase: meta.phase,
				role,
				start_time: meta.start_time,
				duration_ms: meta.duration_ms,
				git_branch: meta.git_branch,
			} : undefined;
		};

		const allSessions = allIds
			.flatMap((id) => {
				const role: WorkUnitSessionRole = id === creatorId ? "creator" : "consumer";
				const session = toSession(id, role);
				return session ? [session] : [];
			})
			.sort((a, b) => a.start_time - b.start_time);

		const startTimes = allSessions.map((s) => s.start_time);
		const endTimes = allSessions.map((s) => s.start_time + s.duration_ms);

		const dateRange = {
			start: Math.min(...startTimes),
			end: Math.max(...endTimes),
		};

		const totalDuration = allSessions.reduce(
			(sum, s) => sum + s.duration_ms,
			0,
		);

		return {
			id: simpleHash(specPath),
			link_type: "spec" as const,
			spec_path: specPath,
			sessions: allSessions,
			lifecycle: classifyLifecycle(allSessions),
			total_duration_ms: totalDuration,
			date_range: dateRange,
		};
	});
};

// --- groupByBranchTime ---

/**
 * Group ungrouped sessions by (git_branch, date) with gap threshold.
 * Excludes main/master/develop branches and already-grouped sessions.
 */
export const groupByBranchTime = (
	sessions: readonly DistilledSessionSummary[],
	alreadyGroupedIds: ReadonlySet<string>,
	gapThresholdMs: number = DEFAULT_GAP_THRESHOLD_MS,
): readonly WorkUnit[] => {
	const ungrouped = sessions.filter(
		(s) =>
			!alreadyGroupedIds.has(s.session_id) &&
			s.git_branch !== undefined &&
			!EXCLUDED_BRANCHES.has(s.git_branch),
	);

	// Group by branch
	const byBranch = ungrouped.reduce<
		Readonly<Record<string, readonly DistilledSessionSummary[]>>
	>(
		(acc, session) => {
			const branch = session.git_branch ?? "";
			const existing = acc[branch] ?? [];
			return { ...acc, [branch]: [...existing, session] };
		},
		{},
	);

	return Object.entries(byBranch).flatMap(([branch, branchSessions]) => {
		const sorted = [...branchSessions].sort(
			(a, b) => a.start_time - b.start_time,
		);

		// Split into time-adjacent groups
		const groups = sorted.reduce<readonly (readonly DistilledSessionSummary[])[]>(
			(acc, session) => {
				if (acc.length === 0) return [[session]];
				const lastGroup = acc[acc.length - 1];
				const lastSession = lastGroup[lastGroup.length - 1];
				const lastEnd = lastSession.start_time + lastSession.duration_ms;
				const gap = session.start_time - lastEnd;

				if (gap <= gapThresholdMs) {
					return [
						...acc.slice(0, -1),
						[...lastGroup, session],
					];
				}
				return [...acc, [session]];
			},
			[],
		);

		return groups.map((group) => {
			const unitSessions: readonly WorkUnitSession[] = group.map((s, idx) => ({
				session_id: s.session_id,
				session_name: s.session_name,
				phase: inferPhase(s),
				role: (idx === 0 ? "creator" : "modifier") as WorkUnitSessionRole,
				start_time: s.start_time,
				duration_ms: s.duration_ms,
				git_branch: s.git_branch,
			}));

			const startTimes = unitSessions.map((s) => s.start_time);
			const endTimes = unitSessions.map(
				(s) => s.start_time + s.duration_ms,
			);
			const totalDuration = unitSessions.reduce(
				(sum, s) => sum + s.duration_ms,
				0,
			);

			return {
				id: simpleHash(`${branch}-${group[0].start_time}`),
				link_type: "branch_time" as const,
				git_branch: branch,
				sessions: unitSessions,
				lifecycle: classifyLifecycle(unitSessions) as WorkUnit["lifecycle"],
				total_duration_ms: totalDuration,
				date_range: {
					start: Math.min(...startTimes),
					end: Math.max(...endTimes),
				},
			};
		});
	});
};

// --- buildWorkUnitIndex ---

/**
 * Orchestrator: builds the complete WorkUnitIndex from distilled sessions.
 */
export const buildWorkUnitIndex = (
	sessions: readonly DistilledSessionSummary[],
	subagentIds: ReadonlySet<string> = new Set(),
): WorkUnitIndex => {
	const topLevelSessions = sessions.filter((s) => !subagentIds.has(s.session_id));
	const writers = detectSpecCreators(topLevelSessions);
	const consumers = detectSpecConsumers(topLevelSessions);

	// Build session meta map (phases must be computed before buildSpecWorkUnits for creator selection)
	const sessionMeta: ReadonlyMap<string, WorkUnitSessionMeta> = new Map(
		topLevelSessions.map((s) => [
			s.session_id,
			{
				session_id: s.session_id,
				session_name: s.session_name,
				start_time: s.start_time,
				duration_ms: s.duration_ms,
				phase: inferPhase(s),
				git_branch: s.git_branch,
			},
		]),
	);

	const specUnits = buildSpecWorkUnits(writers, consumers, sessionMeta);

	// Collect already-grouped session IDs
	const groupedIds = new Set(
		specUnits.flatMap((u) => u.sessions.map((s) => s.session_id)),
	);

	const branchUnits = groupByBranchTime(topLevelSessions, groupedIds);

	const allUnits = [...specUnits, ...branchUnits].sort(
		(a, b) => b.date_range.start - a.date_range.start,
	);

	return {
		version: 1,
		updated_at: Date.now(),
		units: allUnits,
	};
};

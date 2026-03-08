import type {
	CumulativeStats,
	Journey,
	JourneyPhase,
	LifecycleType,
	PhaseTransition,
	PhaseType,
	StatsResult,
	TransitionTrigger,
} from "../types";

// --- Local input type (not in types/ — this is a pure module boundary) ---

export interface SessionChainInput {
	readonly session_id: string;
	readonly start_time: number;
	readonly end_time: number | undefined;
	readonly cwd: string | undefined;
	readonly source: string | undefined;
	readonly end_reason: string | undefined;
	readonly event_count: number;
	readonly duration_ms: number;
	readonly git_commit?: string;
	readonly first_prompt?: string;
	readonly tools_by_name?: Readonly<Record<string, number>>;
}

// --- Constants ---

const CHAIN_GAP_THRESHOLD_MS = 5000;

const SPEC_REF_PATTERN = /specs\/[^\s]+\.md/;

const PLAN_WORD_BOUNDARY = /\/plan(?:\b|$)/;

// --- Function 1: chainSessions ---

export const chainSessions = (
	sessions: readonly SessionChainInput[],
): readonly (readonly string[])[] => {
	if (sessions.length === 0) return [];

	const sorted = [...sessions].sort((a, b) => a.start_time - b.start_time);

	const { groups, current } = sorted.slice(1).reduce(
		(acc, session) => {
			const prev = sorted.find((s) => s.session_id === acc.current[acc.current.length - 1]);
			if (!prev) return acc;

			const prevEnd = prev.end_time ?? prev.start_time;
			const gap = session.start_time - prevEnd;
			const isChainable =
				(session.source === "clear" || session.source === "compact") &&
				gap <= CHAIN_GAP_THRESHOLD_MS &&
				prev.cwd !== undefined &&
				session.cwd !== undefined &&
				prev.cwd === session.cwd;

			return isChainable
				? { groups: acc.groups, current: [...acc.current, session.session_id] }
				: { groups: [...acc.groups, acc.current], current: [session.session_id] };
		},
		{
			groups: [] as readonly (readonly string[])[],
			current: [sorted[0].session_id] as readonly string[],
		},
	);

	return [...groups, current];
};

// --- Function 2: classifyPhase ---

export const classifyPhase = (
	input: SessionChainInput,
): { readonly phase_type: PhaseType; readonly spec_ref?: string } => {
	const prompt = input.first_prompt ?? "";

	if (prompt.includes("/prime")) return { phase_type: "prime" };
	if (prompt.includes("/brainstorm")) return { phase_type: "brainstorm" };
	if (prompt.includes("/plan_w_team") || PLAN_WORD_BOUNDARY.test(prompt))
		return { phase_type: "plan" };
	if (prompt.includes("/build")) {
		const specMatch = prompt.match(SPEC_REF_PATTERN);
		return { phase_type: "build", spec_ref: specMatch?.[0] };
	}
	if (prompt.includes("/review")) return { phase_type: "review" };
	if (prompt.includes("/test")) return { phase_type: "test" };
	if (prompt.includes("commit")) return { phase_type: "commit" };

	if (input.tools_by_name) {
		const readOps =
			(input.tools_by_name.Read ?? 0) +
			(input.tools_by_name.Glob ?? 0) +
			(input.tools_by_name.Grep ?? 0);
		const writeOps = (input.tools_by_name.Edit ?? 0) + (input.tools_by_name.Write ?? 0);
		const ratio = readOps / Math.max(writeOps, 1);
		if (ratio > 3.0) return { phase_type: "exploration" };

		if ((input.tools_by_name.TaskCreate ?? 0) > 3) return { phase_type: "orchestrated_build" };
	}

	if (input.duration_ms < 30000 && input.event_count < 15) return { phase_type: "abort" };

	return { phase_type: "freeform" };
};

// --- Function 3: buildTransition ---

export const buildTransition = (
	from: SessionChainInput,
	to: SessionChainInput,
): PhaseTransition => {
	const gap_ms = to.start_time - (from.end_time ?? from.start_time);
	const trigger: TransitionTrigger = to.source === "compact" ? "compact_auto" : "clear";
	const git_changed =
		from.git_commit !== to.git_commit &&
		from.git_commit !== undefined &&
		to.git_commit !== undefined;
	const prompt_shift = (to.first_prompt ?? "").slice(0, 80);

	return {
		from_session: from.session_id,
		to_session: to.session_id,
		gap_ms,
		trigger,
		git_changed,
		prompt_shift,
	};
};

// --- Function 4: classifyLifecycle ---

export const classifyLifecycle = (phases: readonly JourneyPhase[]): LifecycleType => {
	if (phases.length === 1) return "single-session";

	const phaseTypes = new Set(phases.map((p) => p.phase_type));

	if (phaseTypes.has("prime") && phaseTypes.has("plan") && phaseTypes.has("build"))
		return "prime-plan-build";
	if (phaseTypes.has("prime") && phaseTypes.has("build")) return "prime-build";
	if (phaseTypes.has("build")) return "build-only";

	return "ad-hoc";
};

// --- Function 5: computeCumulativeStats ---

export const computeCumulativeStats = (
	phases: readonly JourneyPhase[],
	statsMap: ReadonlyMap<string, StatsResult>,
): CumulativeStats => {
	const total_duration_ms = phases.reduce((acc, p) => acc + p.duration_ms, 0);
	const total_events = phases.reduce((acc, p) => acc + p.event_count, 0);

	const sessionIds = phases.map((p) => p.session_id);
	const matchedStats = sessionIds
		.map((id) => statsMap.get(id))
		.filter((s): s is StatsResult => s !== undefined);

	const total_tool_calls = matchedStats.reduce((acc, s) => acc + s.tool_call_count, 0);
	const total_failures = matchedStats.reduce((acc, s) => acc + s.failure_count, 0);
	const retry_count = phases.filter((p) => p.phase_type === "abort").length;

	return {
		total_duration_ms,
		total_events,
		total_tool_calls,
		total_failures,
		phase_count: phases.length,
		retry_count,
	};
};

// --- Function 6: composeJourney ---

export const composeJourney = (
	sessionChain: readonly string[],
	inputMap: ReadonlyMap<string, SessionChainInput>,
	statsMap: ReadonlyMap<string, StatsResult>,
): Journey => {
	const phases: readonly JourneyPhase[] = sessionChain.map((sid) => {
		const input = inputMap.get(sid);
		if (!input) {
			return {
				session_id: sid,
				phase_type: "freeform" as PhaseType,
				source: "startup" as const,
				duration_ms: 0,
				event_count: 0,
			};
		}

		const { phase_type, spec_ref } = classifyPhase(input);
		const source: "startup" | "clear" | "compact" =
			input.source === "clear" ? "clear" : input.source === "compact" ? "compact" : "startup";

		return {
			session_id: sid,
			phase_type,
			prompt: input.first_prompt?.slice(0, 200),
			spec_ref,
			source,
			duration_ms: input.duration_ms,
			event_count: input.event_count,
		};
	});

	const transitions: readonly PhaseTransition[] = sessionChain.slice(1).map((sid, i) => {
		const fromInput = inputMap.get(sessionChain[i]);
		const toInput = inputMap.get(sid);

		if (!fromInput || !toInput) {
			return {
				from_session: sessionChain[i],
				to_session: sid,
				gap_ms: 0,
				trigger: "clear" as TransitionTrigger,
				git_changed: false,
				prompt_shift: "",
			};
		}

		return buildTransition(fromInput, toInput);
	});

	const lifecycle_type = classifyLifecycle(phases);
	const cumulative_stats = computeCumulativeStats(phases, statsMap);
	const spec_ref = phases.find((p) => p.phase_type === "build")?.spec_ref;
	const id = sessionChain[0].slice(0, 8);

	return {
		id,
		phases,
		transitions,
		spec_ref,
		lifecycle_type,
		cumulative_stats,
	};
};

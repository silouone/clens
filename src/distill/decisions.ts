import type { DecisionPoint, LinkEvent, PhaseInfo, SpawnLink, StoredEvent, TaskCompleteLink, TaskLink, TimingGapDecision } from "../types";
import { buildTeamPhases, hasTaskLinks } from "./decisions-team";

const TIMING_GAP_THRESHOLD_MS = 30_000; // 30 seconds
const SESSION_PAUSE_THRESHOLD_MS = 300_000; // 5 minutes
const NOISE_THRESHOLD_MS = 60_000; // 1 minute — suppress classified gaps below this
const PHASE_BOUNDARY_GAP_MS = 300_000; // 5 minutes
const PHASE_TOOL_SHIFT_GAP_MS = 120_000; // 2 minutes — tool shift boundary
const LOOKAHEAD_WINDOW = 10;

// --- Helpers ---

const getToolName = (event: StoredEvent): string | undefined => {
	const name = event.data.tool_name;
	return typeof name === "string" ? name : undefined;
};

const isUserPromptSubmit = (event: StoredEvent): boolean => event.event === "UserPromptSubmit";

const isPreToolUse = (event: StoredEvent): boolean => event.event === "PreToolUse";

const isPostToolUseFailure = (event: StoredEvent): boolean => event.event === "PostToolUseFailure";

/** Return timestamps of all UserPromptSubmit events as a sorted array. */
const extractPromptTimestamps = (events: readonly StoredEvent[]): readonly number[] =>
	events.filter(isUserPromptSubmit).map((e) => e.t);

/** Check if a UserPromptSubmit occurs within a gap interval [start, end]. */
const hasPromptInGap = (
	promptTimestamps: readonly number[],
	gapStart: number,
	gapEnd: number,
): boolean => promptTimestamps.some((pt) => pt > gapStart && pt <= gapEnd);

/** Classify a timing gap based on duration and prompt activity. */
const classifyGap = (
	gapMs: number,
	gapStart: number,
	gapEnd: number,
	promptTimestamps: readonly number[],
): "user_idle" | "session_pause" | "agent_thinking" => {
	if (hasPromptInGap(promptTimestamps, gapStart, gapEnd)) {
		return "user_idle";
	}
	if (gapMs > SESSION_PAUSE_THRESHOLD_MS) {
		return "session_pause";
	}
	return "agent_thinking";
};

/** Determine the top tool by count in a slice of events. */
const topToolInSlice = (
	events: readonly StoredEvent[],
	start: number,
	end: number,
): string | undefined => {
	const slice = events.slice(Math.max(0, start), Math.min(events.length, end));
	const toolCounts = slice.reduce(
		(acc, ev) => {
			const tool = getToolName(ev);
			if (tool) return { ...acc, [tool]: (acc[tool] ?? 0) + 1 };
			return acc;
		},
		{} as Record<string, number>,
	);
	const entries = Object.entries(toolCounts);
	return entries.length === 0
		? undefined
		: entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best), entries[0])[0];
};

/** Map a dominant tool name to a phase name. */
const phaseNameFromTool = (tool: string | undefined, hasFailures: boolean): string => {
	if (!tool) return "General";
	const readTools = new Set(["Read", "Glob", "Grep"]);
	const editTools = new Set(["Edit", "Write"]);
	const researchTools = new Set(["WebSearch", "WebFetch"]);
	if (readTools.has(tool)) return "File Exploration";
	if (editTools.has(tool)) return "Code Modification";
	if (researchTools.has(tool)) return "Research";
	if (tool === "Bash" && hasFailures) return "Debugging";
	return "General";
};

// --- Gap Classification ---

/** Extract ALL timing gaps >= 30s with classification. Used by active duration calculator. */
export const extractRawTimingGaps = (events: readonly StoredEvent[]): readonly TimingGapDecision[] => {
	if (events.length < 2) return [];

	const promptTimestamps = extractPromptTimestamps(events);

	return events.slice(1).flatMap((event, idx): readonly TimingGapDecision[] => {
		const prev = events[idx]; // idx is offset by 1 due to slice(1)
		const gapMs = event.t - prev.t;

		if (gapMs <= TIMING_GAP_THRESHOLD_MS) return [];

		const classification = classifyGap(gapMs, prev.t, event.t, promptTimestamps);

		return [
			{
				type: "timing_gap" as const,
				t: event.t,
				gap_ms: gapMs,
				classification,
			},
		];
	});
};

/** Extract timing gap decision points with classification. Suppress noise below 1 min for non-pause gaps. */
const extractTimingGaps = (events: readonly StoredEvent[]): readonly DecisionPoint[] =>
	extractRawTimingGaps(events).filter(
		(gap) => gap.gap_ms >= NOISE_THRESHOLD_MS || gap.classification === "session_pause",
	);

// --- Wider Tool Pivot Detection ---

/** Detect tool pivots: after a failure, look ahead up to LOOKAHEAD_WINDOW events for a PreToolUse with a different tool. */
const extractToolPivots = (events: readonly StoredEvent[]): readonly DecisionPoint[] =>
	events.flatMap((event, idx): readonly DecisionPoint[] => {
		if (!isPostToolUseFailure(event)) return [];

		const failedTool = getToolName(event);
		if (!failedTool) return [];

		// Look ahead up to LOOKAHEAD_WINDOW events for a PreToolUse with a different tool
		const lookaheadEnd = Math.min(events.length, idx + 1 + LOOKAHEAD_WINDOW);
		const nextPreToolUse = events
			.slice(idx + 1, lookaheadEnd)
			.find((e) => isPreToolUse(e) && getToolName(e) !== undefined);

		if (!nextPreToolUse) return [];

		const nextTool = getToolName(nextPreToolUse);
		if (!nextTool || nextTool === failedTool) return [];

		return [
			{
				type: "tool_pivot" as const,
				t: nextPreToolUse.t,
				from_tool: failedTool,
				to_tool: nextTool,
				after_failure: true,
			},
		];
	});

// --- Phase Detection ---

/** Determine if index i is a phase boundary (gap > 5 min, or gap > 2 min with tool shift). */
const isPhaseBoundary = (events: readonly StoredEvent[], i: number): boolean => {
	if (i === 0) return false;

	const gapMs = events[i].t - events[i - 1].t;

	if (gapMs > PHASE_BOUNDARY_GAP_MS) return true;

	if (gapMs > PHASE_TOOL_SHIFT_GAP_MS) {
		// Check if the top tool in the next 10 events differs from the previous 10
		const prevTop = topToolInSlice(events, i - LOOKAHEAD_WINDOW, i);
		const nextTop = topToolInSlice(events, i, i + LOOKAHEAD_WINDOW);
		// Only a boundary if both have tools and they differ
		return prevTop !== undefined && nextTop !== undefined && prevTop !== nextTop;
	}

	return false;
};

/** Find all boundary indices in the event array. Returns indices where new phases start. */
const findBoundaryIndices = (events: readonly StoredEvent[]): readonly number[] =>
	events.length === 0
		? []
		: [0, ...events.flatMap((_, i) => (isPhaseBoundary(events, i) ? [i] : []))];

/** Build a single PhaseInfo from a slice of events. */
const buildPhaseInfo = (
	events: readonly StoredEvent[],
	startIdx: number,
	endIdx: number,
): PhaseInfo => {
	const phaseEvents = events.slice(startIdx, endIdx);
	const toolCounts = phaseEvents.reduce(
		(acc, ev) => {
			const tool = getToolName(ev);
			if (tool) return { ...acc, [tool]: (acc[tool] ?? 0) + 1 };
			return acc;
		},
		{} as Record<string, number>,
	);
	const toolTypes = Object.entries(toolCounts)
		.sort((a, b) => b[1] - a[1])
		.map(([name]) => name);

	const topTool = toolTypes[0] ?? undefined;
	const hasFailures = phaseEvents.some(isPostToolUseFailure);
	const name = phaseNameFromTool(topTool, hasFailures);

	return {
		name,
		start_t: phaseEvents.length > 0 ? phaseEvents[0].t : 0,
		end_t: phaseEvents.length > 0 ? phaseEvents[phaseEvents.length - 1].t : 0,
		tool_types: toolTypes,
		description: `${name} phase with ${phaseEvents.length} events`,
	};
};

/** Extract phases as a standalone pure function. Called once and passed to summary/timeline. */
export const extractPhases = (
	events: readonly StoredEvent[],
	links?: readonly LinkEvent[],
): readonly PhaseInfo[] => {
	if (events.length === 0) return [];

	// Team-aware phase detection when task links exist
	if (links && hasTaskLinks(links)) {
		return buildTeamPhases(events, links);
	}

	// Fallback: gap-based algorithm for single-agent sessions
	const boundaries = findBoundaryIndices(events);

	// Each boundary starts a phase; the phase ends at the next boundary (or end of events)
	return boundaries.map((startIdx, i) => {
		const endIdx = i < boundaries.length - 1 ? boundaries[i + 1] : events.length;
		return buildPhaseInfo(events, startIdx, endIdx);
	});
};

/** Generate phase_boundary decision points from phases. */
const phaseBoundaryDecisions = (phases: readonly PhaseInfo[]): readonly DecisionPoint[] =>
	phases.slice(1).map((phase, i) => ({
		type: "phase_boundary" as const,
		t: phase.start_t,
		phase_name: phase.name,
		phase_index: i + 1,
	}));

// --- Agent Decision Extraction ---

const isSpawnLink = (link: LinkEvent): link is SpawnLink => link.type === "spawn";
const isTaskLink = (link: LinkEvent): link is TaskLink => link.type === "task";
const isTaskCompleteLink = (link: LinkEvent): link is TaskCompleteLink => link.type === "task_complete";

/** Extract agent-level orchestration decisions from link events. */
export const extractAgentDecisions = (links: readonly LinkEvent[]): readonly DecisionPoint[] => {
	const spawnDecisions: readonly DecisionPoint[] = links
		.filter(isSpawnLink)
		.map((spawn) => ({
			type: "agent_spawn" as const,
			t: spawn.t,
			agent_id: spawn.agent_id,
			agent_name: spawn.agent_name ?? spawn.agent_type,
			agent_type: spawn.agent_type,
			parent_session: spawn.parent_session,
		}));

	const delegationDecisions: readonly DecisionPoint[] = links
		.filter(isTaskLink)
		.filter((task) => task.action === "assign")
		.map((task) => ({
			type: "task_delegation" as const,
			t: task.t,
			task_id: task.task_id,
			agent_name: task.owner ?? task.agent ?? "unknown",
			...(task.subject ? { subject: task.subject } : {}),
		}));

	const completionDecisions: readonly DecisionPoint[] = links
		.filter(isTaskCompleteLink)
		.map((task) => ({
			type: "task_completion" as const,
			t: task.t,
			task_id: task.task_id,
			agent_name: task.agent,
			...(task.subject ? { subject: task.subject } : {}),
		}));

	return [...spawnDecisions, ...delegationDecisions, ...completionDecisions];
};

// --- Main Extractor ---

export const extractDecisions = (
	events: readonly StoredEvent[],
	links?: readonly LinkEvent[],
): readonly DecisionPoint[] => {
	const timingGaps = extractTimingGaps(events);
	const toolPivots = extractToolPivots(events);
	const phases = extractPhases(events);
	const phaseBoundaries = phaseBoundaryDecisions(phases);
	const agentDecisions = links && links.length > 0 ? extractAgentDecisions(links) : [];

	return [...timingGaps, ...toolPivots, ...phaseBoundaries, ...agentDecisions].sort((a, b) => a.t - b.t);
};

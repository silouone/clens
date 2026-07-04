import type { LinkEvent, PhaseInfo, StoredEvent, TaskLink } from "../types";

// --- Helpers ---

const uniqueToolTypes = (events: readonly StoredEvent[]): string[] => [
	...new Set(
		events
			.map((ev) => (typeof ev.data.tool_name === "string" ? ev.data.tool_name : undefined))
			.filter((tool): tool is string => tool !== undefined),
	),
];

// --- Type Guards & Predicates ---

const isTaskLink = (link: LinkEvent): link is TaskLink => link.type === "task";

export const hasTaskLinks = (links: readonly LinkEvent[]): boolean => links.some(isTaskLink);

const hasValidatorAgents = (links: readonly LinkEvent[]): boolean =>
	links.some((l) => l.type === "spawn" && l.agent_type === "validator");

// --- Team Phase Builder ---

/** Build phases from task lifecycle events for team sessions. */
export const buildTeamPhases = (
	events: readonly StoredEvent[],
	links: readonly LinkEvent[],
): readonly PhaseInfo[] => {
	const sessionStart = events.length > 0 ? events[0].t : 0;
	const sessionEnd = events.length > 0 ? events[events.length - 1].t : 0;

	// Filter task links to session time range
	const taskLinks = links
		.filter(isTaskLink)
		.filter((tl) => tl.t >= sessionStart && tl.t <= sessionEnd);

	const firstAssignment = taskLinks.find((tl) => tl.action === "assign");
	const hasValidator = hasValidatorAgents(links);

	// Planning phase: from session start to first task assignment
	const planningEnd = firstAssignment ? firstAssignment.t : sessionStart;
	const planningEvents = events.filter((e) => e.t >= sessionStart && e.t < planningEnd);
	const planningPhase: PhaseInfo =
		planningEnd > sessionStart
			? {
					name: "Planning",
					start_t: sessionStart,
					end_t: planningEnd,
					tool_types: uniqueToolTypes(planningEvents),
					description: `Planning phase with ${planningEvents.length} events`,
				}
			: {
					name: "Planning",
					start_t: sessionStart,
					end_t: sessionStart,
					tool_types: [],
					description: "Planning phase with 0 events",
				};

	// Build phase(s): from first assignment to validation (or end)
	const buildStart = firstAssignment ? firstAssignment.t : sessionStart;
	const rawBuildEnd = hasValidator
		? links
				.filter((l) => l.type === "spawn" && l.agent_type === "validator")
				.reduce((earliest, l) => (l.t < earliest ? l.t : earliest), sessionEnd)
		: sessionEnd;
	const buildEnd = Math.min(Math.max(rawBuildEnd, buildStart), sessionEnd);

	const buildEvents = events.filter((e) => e.t >= buildStart && e.t < buildEnd);
	const buildPhase: PhaseInfo = {
		name: "Build",
		start_t: buildStart,
		end_t: buildEnd,
		tool_types: uniqueToolTypes(buildEvents),
		description: `Build phase with ${buildEvents.length} events`,
	};

	// Validation phase: if validator agents appear
	const validationEvents = events.filter((e) => e.t >= buildEnd);
	const validationPhase: PhaseInfo | undefined = hasValidator
		? {
				name: "Validation",
				start_t: buildEnd,
				end_t: sessionEnd,
				tool_types: uniqueToolTypes(validationEvents),
				description: `Validation phase with ${validationEvents.length} events`,
			}
		: undefined;

	const phases = [
		...(planningEnd > sessionStart ? [planningPhase] : []),
		buildPhase,
		...(validationPhase ? [validationPhase] : []),
	];

	// Clamp all phases to session time range
	return phases.map((p) => {
		const clampedStart = Math.max(p.start_t, sessionStart);
		const clampedEnd = Math.max(Math.min(p.end_t, sessionEnd), clampedStart);
		return { ...p, start_t: clampedStart, end_t: clampedEnd };
	});
};

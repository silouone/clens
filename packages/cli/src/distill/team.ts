import type {
	LinkEvent,
	MessageLink,
	SpawnLink,
	StopLink,
	TaskCompleteLink,
	TaskLink,
	TeamMetrics,
	TeammateIdleLink,
} from "../types";

const isSpawn = (link: LinkEvent): link is SpawnLink => link.type === "spawn";

const isStop = (link: LinkEvent): link is StopLink => link.type === "stop";

const isTaskComplete = (link: LinkEvent): link is TaskCompleteLink => link.type === "task_complete";

const isTeammateIdle = (link: LinkEvent): link is TeammateIdleLink => link.type === "teammate_idle";

const isMessageLink = (link: LinkEvent): link is MessageLink => link.type === "msg_send";

const isTaskLink = (link: LinkEvent): link is TaskLink => link.type === "task";

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)];

/**
 * Infer agent names from communication links when no spawn links exist.
 * Gathers unique names from msg_send recipients, task owners, task_complete agents, and teammate_idle.
 */
const inferAgentNamesFromComms = (
	links: readonly LinkEvent[],
	sessionId?: string,
): ReadonlySet<string> => {
	return new Set(
		links.flatMap((link): readonly string[] => {
			if (link.type === "msg_send" && sessionId && (link.from === sessionId || link.session_id === sessionId)) return [link.to];
			if (link.type === "task" && link.owner) return [link.owner];
			if (link.type === "task_complete" && link.agent) return [link.agent];
			if (link.type === "teammate_idle" && link.teammate) return [link.teammate];
			return [];
		}),
	);
};

export const extractTeamMetrics = (
	links: readonly LinkEvent[],
	knownAgentIds?: ReadonlySet<string>,
	sessionId?: string,
): TeamMetrics => {
	const spawns = links.filter(isSpawn);
	const agentIds = knownAgentIds ?? new Set(spawns.map((s) => s.agent_id));

	// Build name set from spawns that have agent_name AND are in agentIds
	const agentNames = new Set(
		spawns
			.filter(
				(s): s is SpawnLink & { agent_name: string } =>
					agentIds.has(s.agent_id) && s.agent_name !== undefined,
			)
			.map((s) => s.agent_name),
	);

	// Fallback: infer agent names from comms when no spawns exist
	const inferredNames = spawns.length === 0 && agentIds.size === 0
		? inferAgentNamesFromComms(links, sessionId)
		: new Set<string>();

	// Combined set of names + IDs for matching teammate_idle events
	// When agent_name is undefined, idle.teammate may contain the agent_id
	const nameOrIdSet = new Set([...agentNames, ...agentIds, ...inferredNames]);

	// Match set for task_complete.agent: includes subagent names, IDs, and parent sessionId
	const taskAgentMatchSet = sessionId
		? new Set([...nameOrIdSet, sessionId])
		: nameOrIdSet;

	// Filter task_complete: match by agent name, agent ID, parent sessionId, or session_id field
	const taskCompletes = links
		.filter(isTaskComplete)
		.filter((tc) => taskAgentMatchSet.has(tc.agent) || (sessionId !== undefined && tc.session_id === sessionId));

	// Filter teammate_idle: match by name or ID (handles agent_name=undefined case)
	const idles = links
		.filter(isTeammateIdle)
		.filter((idle) => nameOrIdSet.has(idle.teammate));

	const spawnAgentCount = new Set(spawns.filter((s) => agentIds.has(s.agent_id)).map((s) => s.agent_id)).size;
	const agentCount = spawnAgentCount > 0 ? spawnAgentCount : inferredNames.size;

	const spawnNames = spawns
		.filter((s) => agentIds.has(s.agent_id))
		.map((s) => s.agent_name ?? s.agent_id);
	const taskAgentNames = taskCompletes.map((tc) => tc.agent);
	const idleTeammateNames = idles.map((idle) => idle.teammate);
	const teammateNames = uniqueStrings([...spawnNames, ...inferredNames, ...taskAgentNames, ...idleTeammateNames]);

	// Build comprehensive task list by merging task create/assign/complete links
	const taskLinks = links.filter(isTaskLink);

	// TaskCreate fires at PreToolUse — task_id is empty, but subject is present.
	// Assign ordinal IDs (1-indexed) by creation order for correlation.
	const creates = taskLinks
		.filter((tl) => tl.action === "create" && tl.subject)
		.sort((a, b) => a.t - b.t);
	const subjectMap = new Map(
		creates.map((tl, i) => [tl.task_id || String(i + 1), tl.subject ?? ""] as const),
	);

	const ownerMap = new Map(
		taskLinks
			.filter((tl) => tl.owner)
			.map((tl) => [tl.task_id, tl.owner ?? ""] as const),
	);
	const completedSet = new Set(taskCompletes.map((tc) => tc.task_id));

	// Collect all unique task_ids from update/complete links (skip empty create IDs)
	const allTaskIds = [...new Set([
		...taskLinks.filter((tl) => tl.task_id.length > 0).map((tl) => tl.task_id),
		...taskCompletes.map((tc) => tc.task_id),
	])].filter((id) => id.length > 0);

	const tasks = allTaskIds.map((id) => {
		const complete = taskCompletes.find((tc) => tc.task_id === id);
		return {
			task_id: id,
			agent: ownerMap.get(id) ?? complete?.agent ?? "",
			subject: subjectMap.get(id) ?? complete?.subject,
			status: completedSet.has(id) ? "completed" as const : undefined,
			t: creates[Number(id) - 1]?.t ?? complete?.t ?? 0,
		};
	});

	const idleTransitions = idles.map((idle) => ({
		teammate: idle.teammate,
		t: idle.t,
	}));

	const stopLinks = links.filter(isStop);
	const totalAgentTime = spawns.reduce((sum, spawn) => {
		const matchingStop = stopLinks.find((s) => s.agent_id === spawn.agent_id);
		return matchingStop ? sum + (matchingStop.t - spawn.t) : sum;
	}, 0);

	const totalIdleTime = idles.reduce((sum, idle) => {
		const nextEvent = links.find((l) => l.t > idle.t && l.type !== "teammate_idle");
		return nextEvent ? sum + (nextEvent.t - idle.t) : sum;
	}, 0);

	const utilizationRatio =
		totalAgentTime > 0 ? Math.max(0, Math.min(1, 1 - totalIdleTime / totalAgentTime)) : undefined;

	return {
		agent_count: agentCount,
		task_completed_count: taskCompletes.length,
		idle_event_count: idles.length,
		teammate_names: teammateNames,
		tasks,
		idle_transitions: idleTransitions,
		utilization_ratio: utilizationRatio,
	};
};

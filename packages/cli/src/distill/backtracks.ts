import type { BacktrackResult, StoredEvent } from "../types";

/** Normalized agent key for an event. Parent-session events use "" (no agent_id). */
const agentKeyOf = (event: StoredEvent): string =>
	typeof event.data.agent_id === "string" ? event.data.agent_id : "";

/** Partition events by their agent_id so backtrack sequences never cross agent boundaries. */
const partitionByAgent = (events: readonly StoredEvent[]): readonly (readonly StoredEvent[])[] => {
	const grouped = events.reduce<ReadonlyMap<string, readonly StoredEvent[]>>((acc, event) => {
		const key = agentKeyOf(event);
		const existing = acc.get(key) ?? [];
		return new Map(acc).set(key, [...existing, event]);
	}, new Map());
	return [...grouped.values()];
};

/** Detect all three backtrack patterns within a single agent's event stream. */
const extractAgentBacktracks = (events: readonly StoredEvent[]): BacktrackResult[] => {
	// Pattern 1: failure_retry — PostToolUseFailure followed by PreToolUse with same tool_name
	const failureRetries = events.flatMap((failEvent, i): BacktrackResult[] => {
		if (failEvent.event !== "PostToolUseFailure") return [];
		if (failEvent.data.is_interrupt) return [];

		const failToolName = typeof failEvent.data.tool_name === "string" ? failEvent.data.tool_name : "";
		const failToolId = typeof failEvent.data.tool_use_id === "string" ? failEvent.data.tool_use_id : "";

		const retryEvent = events
			.slice(i + 1, Math.min(i + 10, events.length))
			.find((e) => e.event === "PreToolUse" && e.data.tool_name === failToolName);

		if (!retryEvent) return [];

		const retryToolId = typeof retryEvent.data.tool_use_id === "string" ? retryEvent.data.tool_use_id : "";
		return [
			{
				type: "failure_retry",
				tool_name: failToolName,
				file_path: extractFilePath(failEvent),
				attempts: 2,
				start_t: failEvent.t,
				end_t: retryEvent.t,
				tool_use_ids: [failToolId, retryToolId],
				error_message: extractErrorMessage(failEvent),
				command: extractCommand(failEvent),
			},
		];
	});

	// Pattern 2: iteration_struggle — same file edited 4+ times in 5 minutes
	const editsByFile = events
		.filter(
			(e) =>
				e.event === "PreToolUse" &&
				(e.data.tool_name === "Edit" || e.data.tool_name === "Write"),
		)
		.reduce((acc, event) => {
			const filePath = extractFilePath(event);
			if (!filePath) return acc;

			const existing = acc.get(filePath) ?? [];
			return new Map(acc).set(filePath, [
				...existing,
				{ t: event.t, tool_use_id: typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : "" },
			]);
		}, new Map<string, Array<{ t: number; tool_use_id: string }>>());

	const FIVE_MINUTES = 5 * 60 * 1000;
	const iterationStruggles = Array.from(editsByFile).flatMap(
		([filePath, edits]): BacktrackResult[] => {
			const match = Array.from({ length: Math.max(0, edits.length - 3) }, (_, i) => i).find((i) => {
				const windowEnd = edits[i].t + FIVE_MINUTES;
				const windowEdits = edits.filter((e) => e.t >= edits[i].t && e.t <= windowEnd);
				return windowEdits.length >= 4;
			});

			if (match === undefined) return [];

			const windowEnd = edits[match].t + FIVE_MINUTES;
			const windowEdits = edits.filter((e) => e.t >= edits[match].t && e.t <= windowEnd);

			return [
				{
					type: "iteration_struggle",
					tool_name: "Edit",
					file_path: filePath,
					attempts: windowEdits.length,
					start_t: windowEdits[0].t,
					end_t: windowEdits[windowEdits.length - 1].t,
					tool_use_ids: windowEdits.map((e) => e.tool_use_id),
				},
			];
		},
	);

	// Pattern 3: debugging_loop — Bash error → different Bash command x3+
	const bashEvents = events
		.map((event, index) => ({ event, index }))
		.filter(
			({ event }) =>
				(event.event === "PreToolUse" || event.event === "PostToolUseFailure") &&
				event.data.tool_name === "Bash",
		);

	const debuggingLoops = bashEvents.flatMap((bashEntry, i): BacktrackResult[] => {
		if (bashEntry.event.event !== "PostToolUseFailure") return [];
		if (bashEntry.event.data.is_interrupt) return [];

		// Walk subsequent bash events with termination conditions:
		// 1. Stop when gap between consecutive events > 5 minutes
		// 2. Stop when a non-Bash PreToolUse interleaves (agent moved on)
		// 3. Cap chain length at 50 attempts
		const MAX_CHAIN = 50;
		const MAX_GAP_MS = 5 * 60 * 1000;
		const subsequent = bashEvents.slice(i + 1);
		const walk = subsequent.reduce<{
			readonly items: typeof subsequent;
			readonly stopped: boolean;
			readonly lastT: number;
			readonly lastIndex: number;
			// Timestamp of the most recent in-chain bash event (PreToolUse OR PostToolUseFailure),
			// so a loop that ends in a failure reports its true extent rather than truncating
			// at the last successful retry. (Real loops keep failing — see "requires no subsequent failures".)
			readonly endT: number;
			// Whether any in-chain bash event AFTER the initial failure was itself a
			// PostToolUseFailure. A debugging loop is repeated *failure*; a single failure
			// followed only by succeeding (non-failing) bash commands is recovery, not a loop.
			readonly sawSubsequentFailure: boolean;
		}>(
			(acc, entry) => {
				if (acc.stopped) return acc;
				if (acc.items.length >= MAX_CHAIN) return { ...acc, stopped: true };
				if (entry.event.t - acc.lastT > MAX_GAP_MS) return { ...acc, stopped: true };

				const hasNonBashInterleave = events
					.slice(acc.lastIndex + 1, entry.index)
					.some((e) => e.event === "PreToolUse" && e.data.tool_name !== "Bash");
				if (hasNonBashInterleave) return { ...acc, stopped: true };

				// Each retry is one attempt, counted from its PreToolUse. Subsequent
				// PostToolUseFailure events still belong to the loop (they advance endT and
				// tracking) but are not double-counted as separate attempts.
				return entry.event.event === "PreToolUse"
					? { ...acc, items: [...acc.items, entry], lastT: entry.event.t, lastIndex: entry.index, endT: entry.event.t }
					: { ...acc, lastT: entry.event.t, lastIndex: entry.index, endT: entry.event.t, sawSubsequentFailure: true };
			},
			{ items: [], stopped: false, lastT: bashEntry.event.t, lastIndex: bashEntry.index, endT: bashEntry.event.t, sawSubsequentFailure: false },
		);
		const consecutiveBash = walk.items;

		const debugAttempts = [
			typeof bashEntry.event.data.tool_use_id === "string" ? bashEntry.event.data.tool_use_id : "",
			...consecutiveBash.map((entry) => typeof entry.event.data.tool_use_id === "string" ? entry.event.data.tool_use_id : ""),
		];

		// A debugging loop must be a *loop*: the initial failure plus at least one
		// subsequent bash failure. Without a second failure we only have one failure
		// followed by bash commands that did not fail (e.g. `git status`, `git add`) —
		// that is recovery, not looping, and firing here is a false positive.
		if (!walk.sawSubsequentFailure) return [];

		if (debugAttempts.length < 3) return [];

		const initialFailEvent = bashEntry.event;
		return [
			{
				type: "debugging_loop",
				tool_name: "Bash",
				attempts: debugAttempts.length,
				start_t: initialFailEvent.t,
				end_t: walk.endT,
				tool_use_ids: debugAttempts,
				error_message: extractErrorMessage(initialFailEvent),
				command: extractCommand(initialFailEvent),
			},
		];
	});

	// Dedup overlapping debugging_loops: keep only the earliest (largest) loop when PreToolUse IDs overlap
	const loopSets: readonly ReadonlySet<string>[] = debuggingLoops.map((l) => new Set(l.tool_use_ids));
	const dedupedDebugLoops = debuggingLoops.filter((loop, idx) =>
		!debuggingLoops.some(
			(_, otherIdx) =>
				otherIdx < idx &&
				loop.tool_use_ids.slice(1).every((id) => loopSets[otherIdx].has(id)),
		),
	);

	// Dedup: remove failure_retry entries whose tool_use_ids are a subset of a debugging_loop
	const debuggingLoopIds = new Set(
		dedupedDebugLoops.flatMap((dl) => dl.tool_use_ids),
	);

	const dedupedRetries = failureRetries.filter(
		(fr) => !fr.tool_use_ids.every((id) => debuggingLoopIds.has(id)),
	);

	const dedupedStruggles = iterationStruggles.filter(
		(is) => !is.tool_use_ids.every((id) => debuggingLoopIds.has(id)),
	);

	return [...dedupedRetries, ...dedupedStruggles, ...dedupedDebugLoops];
};

/**
 * Detect backtrack patterns across a session. Events are partitioned by agent_id
 * first so a failure in one agent is never matched against a retry in another
 * (cross-agent false retries). Results are sorted by start time.
 */
export const extractBacktracks = (events: readonly StoredEvent[]): BacktrackResult[] =>
	partitionByAgent(events)
		.flatMap(extractAgentBacktracks)
		.sort((a, b) => a.start_t - b.start_t);

const extractFilePath = (event: StoredEvent): string | undefined => {
	const toolInput = event.data.tool_input;
	if (typeof toolInput !== "object" || toolInput === null) return undefined;
	const input = toolInput as Record<string, unknown>;
	const raw = input.file_path ?? input.path;
	return typeof raw === "string" ? raw : undefined;
};

const extractErrorMessage = (event: StoredEvent): string | undefined => {
	const error = event.data.error;
	return typeof error === "string" ? error.slice(0, 500) : undefined;
};

const extractCommand = (event: StoredEvent): string | undefined => {
	const toolInput = event.data.tool_input as Record<string, unknown> | undefined;
	const command = toolInput?.command;
	return typeof command === "string" ? command.slice(0, 300) : undefined;
};

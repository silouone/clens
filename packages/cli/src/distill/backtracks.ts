import type { BacktrackResult, StoredEvent } from "../types";

export const extractBacktracks = (events: readonly StoredEvent[]): BacktrackResult[] => {
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
		const consecutiveBash = subsequent.reduce<{
			readonly items: typeof subsequent;
			readonly stopped: boolean;
			readonly lastT: number;
			readonly lastIndex: number;
		}>(
			(acc, entry) => {
				if (acc.stopped) return acc;
				if (acc.items.length >= MAX_CHAIN) return { ...acc, stopped: true };
				if (entry.event.t - acc.lastT > MAX_GAP_MS) return { ...acc, stopped: true };

				const hasNonBashInterleave = events
					.slice(acc.lastIndex + 1, entry.index)
					.some((e) => e.event === "PreToolUse" && e.data.tool_name !== "Bash");
				if (hasNonBashInterleave) return { ...acc, stopped: true };

				// Include PreToolUse in chain, skip PostToolUseFailure (update tracking either way)
				return entry.event.event === "PreToolUse"
					? { items: [...acc.items, entry], stopped: false, lastT: entry.event.t, lastIndex: entry.index }
					: { ...acc, lastT: entry.event.t, lastIndex: entry.index };
			},
			{ items: [], stopped: false, lastT: bashEntry.event.t, lastIndex: bashEntry.index },
		).items;

		const debugAttempts = [
			typeof bashEntry.event.data.tool_use_id === "string" ? bashEntry.event.data.tool_use_id : "",
			...consecutiveBash.map((entry) => typeof entry.event.data.tool_use_id === "string" ? entry.event.data.tool_use_id : ""),
		];

		if (debugAttempts.length < 3) return [];

		const initialFailEvent = bashEntry.event;
		return [
			{
				type: "debugging_loop",
				tool_name: "Bash",
				attempts: debugAttempts.length,
				start_t: initialFailEvent.t,
				end_t: consecutiveBash[consecutiveBash.length - 1].event.t,
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

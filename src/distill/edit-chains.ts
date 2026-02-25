import type {
	BacktrackResult,
	EditChain,
	EditChainsResult,
	EditStep,
	StoredEvent,
	TranscriptReasoning,
} from "../types";

// --- Helpers ---

const extractFilePath = (event: StoredEvent): string | undefined => {
	const toolInput = event.data.tool_input as Record<string, unknown> | undefined;
	const raw = toolInput?.file_path ?? toolInput?.path;
	return typeof raw === "string" ? raw : undefined;
};

const countLines = (text: string | undefined): number | undefined =>
	text !== undefined ? text.split("\n").length : undefined;

const preview = (text: unknown, limit: number): string | undefined =>
	typeof text === "string" ? text.slice(0, limit) : undefined;

const isEditOrWrite = (toolName: string): toolName is "Edit" | "Write" =>
	toolName === "Edit" || toolName === "Write";

// --- Types ---

export interface EditLookups {
	readonly reasoningMap: ReadonlyMap<string, TranscriptReasoning>;
	readonly backtrackMap: ReadonlyMap<string, BacktrackResult>;
	readonly failureSet: ReadonlySet<string>;
	readonly failureEventMap: ReadonlyMap<string, StoredEvent>;
}

// --- Decomposed extractors ---

/**
 * Steps 1-4: Build all lookup structures needed for edit chain assembly.
 * Pure function: events + reasoning + backtracks -> lookup maps.
 */
export const buildEditLookups = (
	events: readonly StoredEvent[],
	reasoning: readonly TranscriptReasoning[],
	backtracks: readonly BacktrackResult[],
): EditLookups => {
	// 1. Build reasoning lookup: Map<string, TranscriptReasoning> keyed by tool_use_id
	const reasoningMap = reasoning.reduce<ReadonlyMap<string, TranscriptReasoning>>((acc, entry) => {
		if (entry.tool_use_id === undefined) return acc;
		const next = new Map(acc);
		next.set(entry.tool_use_id, entry);
		return next;
	}, new Map());

	// 2. Build backtrack lookup: Map<string, BacktrackResult> keyed by each tool_use_id in tool_use_ids
	const backtrackMap = backtracks.reduce<ReadonlyMap<string, BacktrackResult>>(
		(acc, bt) =>
			bt.tool_use_ids.reduce<ReadonlyMap<string, BacktrackResult>>((inner, id) => {
				const next = new Map(inner);
				next.set(id, bt);
				return next;
			}, acc),
		new Map(),
	);

	// 3. Build failure set: Set<string> of tool_use_ids from PostToolUseFailure events
	const failureSet = new Set(
		events
			.filter((e) => e.event === "PostToolUseFailure")
			.map((e) => typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined)
			.filter((id): id is string => id !== undefined),
	);

	// 4. Build failure event lookup for error_preview extraction
	const failureEventMap = events
		.filter((e) => e.event === "PostToolUseFailure")
		.reduce<ReadonlyMap<string, StoredEvent>>((acc, e) => {
			const id = typeof e.data.tool_use_id === "string" ? e.data.tool_use_id : undefined;
			if (id === undefined) return acc;
			const next = new Map(acc);
			next.set(id, e);
			return next;
		}, new Map());

	return { reasoningMap, backtrackMap, failureSet, failureEventMap };
};

/**
 * Steps 5-7: Extract edit-relevant events, group by file, filter recovery reads.
 * Pure function: events -> filtered file groups.
 */
export const groupAndFilterEditEvents = (
	events: readonly StoredEvent[],
): readonly (readonly [string, readonly StoredEvent[]])[] => {
	// 5. Extract edit-relevant events (for grouping and filtering)
	const editRelevantEvents = events.filter((e) => {
		const toolName = typeof e.data.tool_name === "string" ? e.data.tool_name : undefined;
		if (e.event === "PreToolUse" && toolName !== undefined) {
			return isEditOrWrite(toolName) || toolName === "Read";
		}
		if (e.event === "PostToolUseFailure" && toolName !== undefined) {
			return isEditOrWrite(toolName);
		}
		return false;
	});

	// 6. Group by file_path
	const groupedByFile = editRelevantEvents.reduce<ReadonlyMap<string, readonly StoredEvent[]>>(
		(acc, event) => {
			const filePath = extractFilePath(event);
			if (filePath === undefined) return acc;
			const existing = acc.get(filePath) ?? [];
			const next = new Map(acc);
			next.set(filePath, [...existing, event]);
			return next;
		},
		new Map(),
	);

	// 7. Filter recovery reads and remove read-only groups
	return Array.from(groupedByFile.entries()).flatMap(
		([filePath, fileEvents]): readonly [string, readonly StoredEvent[]][] => {
			const hasEditOrWrite = fileEvents.some(
				(e) =>
					(e.event === "PreToolUse" || e.event === "PostToolUseFailure") &&
					typeof e.data.tool_name === "string" &&
					isEditOrWrite(e.data.tool_name),
			);
			if (!hasEditOrWrite) return [];

			// Filter Read events: keep only those between Edit/Write events or within 3 events after a failure
			const filtered = fileEvents.filter((e, idx) => {
				const toolName = typeof e.data.tool_name === "string" ? e.data.tool_name : "";
				if (e.event !== "PreToolUse" || toolName !== "Read") return true;

				// Check: between two Edit/Write events on the same file
				const hasPriorEditWrite = fileEvents
					.slice(0, idx)
					.some(
						(prev) =>
							(prev.event === "PreToolUse" || prev.event === "PostToolUseFailure") &&
							typeof prev.data.tool_name === "string" &&
							isEditOrWrite(prev.data.tool_name),
					);
				const hasLaterEditWrite = fileEvents
					.slice(idx + 1)
					.some(
						(next) =>
							(next.event === "PreToolUse" || next.event === "PostToolUseFailure") &&
							typeof next.data.tool_name === "string" &&
							isEditOrWrite(next.data.tool_name),
					);
				if (hasPriorEditWrite && hasLaterEditWrite) return true;

				// Check: within 3 events after a PostToolUseFailure on the same file
				const recentFailure = fileEvents
					.slice(Math.max(0, idx - 3), idx)
					.some((prev) => prev.event === "PostToolUseFailure");
				return recentFailure;
			});

			return [[filePath, filtered]];
		},
	);
};

// --- Main extractor (orchestrator) ---

export const extractEditChains = (
	events: readonly StoredEvent[],
	reasoning: readonly TranscriptReasoning[],
	backtracks: readonly BacktrackResult[],
): EditChainsResult => {
	const { reasoningMap, backtrackMap, failureSet, failureEventMap } = buildEditLookups(
		events,
		reasoning,
		backtracks,
	);

	const filteredByFile = groupAndFilterEditEvents(events);

	// 8. Build EditStep[] per file and assemble EditChain[]
	const chains: readonly EditChain[] = filteredByFile
		.map(([filePath, fileEvents]): EditChain => {
			// Only build steps from PreToolUse events
			const preToolUseEvents = fileEvents.filter((e) => e.event === "PreToolUse");

			const steps: readonly EditStep[] = preToolUseEvents.map((event): EditStep => {
				const toolUseId = typeof event.data.tool_use_id === "string" ? event.data.tool_use_id : "";
				const toolName = typeof event.data.tool_name === "string" ? event.data.tool_name : "";
				const toolInput = event.data.tool_input as Record<string, unknown> | undefined;

				// Determine outcome
				const outcome: EditStep["outcome"] =
					toolName === "Read" ? "info" : failureSet.has(toolUseId) ? "failure" : "success";

				// Content previews
				const oldStringPreview = preview(toolInput?.old_string, 200);
				const newStringPreview = preview(toolInput?.new_string, 200);
				const oldStringLines = countLines(
					typeof toolInput?.old_string === "string" ? toolInput.old_string : undefined,
				);
				const newStringLines = countLines(
					typeof toolInput?.new_string === "string" ? toolInput.new_string : undefined,
				);
				const contentLines = countLines(
					typeof toolInput?.content === "string" ? toolInput.content : undefined,
				);

				// Error preview from matching PostToolUseFailure
				const failureEvent = failureEventMap.get(toolUseId);
				const errorPreview = failureEvent ? preview(failureEvent.data.error, 200) : undefined;

				// Thinking binding from reasoning map
				const reasoningEntry = reasoningMap.get(toolUseId);
				const thinkingPreview = reasoningEntry ? preview(reasoningEntry.thinking, 300) : undefined;
				const thinkingIntent = reasoningEntry?.intent_hint;

				// Backtrack annotation from backtrack map
				const backtrackEntry = backtrackMap.get(toolUseId);
				const backtrackType = backtrackEntry?.type;

				return {
					tool_use_id: toolUseId,
					t: event.t,
					tool_name: toolName as EditStep["tool_name"],
					outcome,
					...(oldStringPreview !== undefined && { old_string_preview: oldStringPreview }),
					...(newStringPreview !== undefined && { new_string_preview: newStringPreview }),
					...(oldStringLines !== undefined && { old_string_lines: oldStringLines }),
					...(newStringLines !== undefined && { new_string_lines: newStringLines }),
					...(contentLines !== undefined && { content_lines: contentLines }),
					...(errorPreview !== undefined && { error_preview: errorPreview }),
					...(thinkingPreview !== undefined && { thinking_preview: thinkingPreview }),
					...(thinkingIntent !== undefined && { thinking_intent: thinkingIntent }),
					...(backtrackType !== undefined && { backtrack_type: backtrackType }),
				};
			});

			// Derived metrics
			const totalEdits = steps.filter(
				(s) => s.tool_name === "Edit" || s.tool_name === "Write",
			).length;
			const totalFailures = steps.filter((s) => s.outcome === "failure").length;
			const totalReads = steps.filter((s) => s.tool_name === "Read").length;
			const effortMs = steps.length > 1 ? steps[steps.length - 1].t - steps[0].t : 0;
			const hasBacktrack = steps.some((s) => s.backtrack_type !== undefined);
			const survivingEditIds = steps
				.filter(
					(s) => (s.tool_name === "Edit" || s.tool_name === "Write") && s.outcome === "success",
				)
				.map((s) => s.tool_use_id);
			const abandonedEditIds = steps
				.filter(
					(s) => (s.tool_name === "Edit" || s.tool_name === "Write") && s.outcome === "failure",
				)
				.map((s) => s.tool_use_id);

			return {
				file_path: filePath,
				steps,
				total_edits: totalEdits,
				total_failures: totalFailures,
				total_reads: totalReads,
				effort_ms: effortMs,
				has_backtrack: hasBacktrack,
				surviving_edit_ids: survivingEditIds,
				abandoned_edit_ids: abandonedEditIds,
			};
		})
		// 9. Sort by (total_failures + total_edits) descending
		.sort((a, b) => b.total_failures + b.total_edits - (a.total_failures + a.total_edits));

	// 10. Return
	return { chains };
};

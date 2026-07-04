import type { LinkEvent, TaskCompleteLink, TaskLink, TaskListResult, TaskRecord } from "../types";

const isTaskLink = (link: LinkEvent): link is TaskLink => link.type === "task";
const isTaskCompleteLink = (link: LinkEvent): link is TaskCompleteLink =>
	link.type === "task_complete";

const buildTaskFromCreate = (link: TaskLink, ordinal: number): TaskRecord => ({
	task_id: link.task_id || `task-${ordinal}`,
	subject: link.subject ?? `Task ${ordinal}`,
	description: link.description,
	active_form: link.active_form,
	status: "pending",
	created_at: link.t,
	created_by: link.session_id,
});

const applyUpdate = (existing: TaskRecord, link: TaskLink): TaskRecord => ({
	...existing,
	...(link.owner ? { owner: link.owner } : {}),
	...(link.status === "in_progress" ? { status: "in_progress" as const } : {}),
	...(link.status === "completed" ? { status: "completed" as const, completed_at: link.t } : {}),
	...(link.blocked_by && link.blocked_by.length > 0 ? { blocked_by: link.blocked_by } : {}),
});

/** A status_change carrying status "deleted" removes the task entirely. */
const isDeletion = (link: TaskLink): boolean => link.status === "deleted";

const applyCompletion = (existing: TaskRecord, link: TaskCompleteLink): TaskRecord => ({
	...existing,
	status: "completed",
	completed_at: link.t,
	// Preserve existing subject; only override if empty and link has one
	...((!existing.subject || existing.subject === existing.task_id) && link.subject
		? { subject: link.subject }
		: {}),
});

const buildOrphanComplete = (link: TaskCompleteLink): TaskRecord => ({
	task_id: link.task_id,
	subject: link.subject ?? link.task_id,
	status: "completed",
	created_at: link.t,
	completed_at: link.t,
	created_by: link.session_id ?? "unknown",
	owner: link.agent,
});

/**
 * Try to find a task record by ID, with fallback to synthetic `task-{id}` key.
 * When matched via fallback, re-keys the record to use the real ID so subsequent
 * lookups work without fallback.
 */
const resolveTask = (
	map: ReadonlyMap<string, TaskRecord>,
	realId: string,
): { readonly record: TaskRecord | undefined; readonly map: ReadonlyMap<string, TaskRecord> } => {
	const direct = map.get(realId);
	if (direct) return { record: direct, map };

	// Try synthetic fallback: "1" → "task-1"
	const syntheticKey = `task-${realId}`;
	const synthetic = map.get(syntheticKey);
	if (!synthetic) return { record: undefined, map };

	// Re-key: remove synthetic entry, add with real ID
	const newMap = new Map([...map]);
	newMap.delete(syntheticKey);
	const rekeyed: TaskRecord = { ...synthetic, task_id: realId };
	newMap.set(realId, rekeyed);
	return { record: rekeyed, map: newMap };
};

export const extractTaskList = (links: readonly LinkEvent[]): TaskListResult => {
	const taskLinks = links.filter(isTaskLink);
	const taskCompleteLinks = links.filter(isTaskCompleteLink);

	// Build initial task records from create events
	const createLinks = taskLinks.filter((l) => l.action === "create");
	const seedMap = createLinks.reduce<ReadonlyMap<string, TaskRecord>>((acc, link, i) => {
		const ordinal = i + 1;
		const record = buildTaskFromCreate(link, ordinal);
		return new Map([...acc, [record.task_id, record]]);
	}, new Map());

	// Apply updates (assign, status_change) — with ID reconciliation
	const updateLinks = taskLinks.filter(
		(l) => l.action === "assign" || l.action === "status_change",
	);
	const updatedMap = updateLinks.reduce<ReadonlyMap<string, TaskRecord>>((acc, link) => {
		const { record: existing, map: reconciled } = resolveTask(acc, link.task_id);
		if (!existing) return acc;
		// A status_change to "deleted" removes the task from the list.
		if (isDeletion(link)) {
			const withoutDeleted = new Map([...reconciled]);
			withoutDeleted.delete(existing.task_id);
			return withoutDeleted;
		}
		return new Map([...reconciled, [existing.task_id, applyUpdate(existing, link)]]);
	}, seedMap);

	// Apply completions — with ID reconciliation
	const finalMap = taskCompleteLinks.reduce<ReadonlyMap<string, TaskRecord>>((acc, link) => {
		const { record: existing, map: reconciled } = resolveTask(acc, link.task_id);
		const record = existing ? applyCompletion(existing, link) : buildOrphanComplete(link);
		return new Map([...reconciled, [record.task_id, record]]);
	}, updatedMap);

	const tasks = [...finalMap.values()].sort((a, b) => a.created_at - b.created_at);
	const completedCount = tasks.filter((t) => t.status === "completed").length;

	return {
		tasks,
		total_count: tasks.length,
		completed_count: completedCount,
		completion_rate: tasks.length > 0 ? completedCount / tasks.length : 0,
	};
};

import { describe, expect, test } from "bun:test";
import { extractTaskList } from "../src/distill/task-list";
import type {
	LinkEvent,
	MessageLink,
	SpawnLink,
	TaskCompleteLink,
	TaskLink,
} from "../src/types";

// -- Helper factories --

const mkTaskCreate = (overrides: Partial<TaskLink> = {}): TaskLink => ({
	t: 1000,
	type: "task",
	action: "create",
	task_id: "task-1",
	session_id: "session-1",
	subject: "Build feature",
	...overrides,
});

const mkTaskUpdate = (overrides: Partial<TaskLink> = {}): TaskLink => ({
	t: 2000,
	type: "task",
	action: "status_change",
	task_id: "task-1",
	session_id: "session-1",
	...overrides,
});

const mkTaskComplete = (overrides: Partial<TaskCompleteLink> = {}): TaskCompleteLink => ({
	t: 5000,
	type: "task_complete",
	task_id: "task-1",
	agent: "builder-1",
	subject: "Build feature",
	...overrides,
});

const mkSpawn = (overrides: Partial<SpawnLink> = {}): SpawnLink => ({
	t: 500,
	type: "spawn",
	parent_session: "leader-session",
	agent_id: "agent-1",
	agent_type: "builder",
	...overrides,
});

const mkMessage = (overrides: Partial<MessageLink> = {}): MessageLink => ({
	t: 1500,
	type: "msg_send",
	session_id: "session-1",
	from: "leader",
	to: "builder-1",
	msg_type: "message",
	...overrides,
});

describe("extractTaskList", () => {
	test("empty links returns empty result", () => {
		const result = extractTaskList([]);

		expect(result.tasks).toEqual([]);
		expect(result.total_count).toBe(0);
		expect(result.completed_count).toBe(0);
		expect(result.completion_rate).toBe(0);
	});

	test("task creation from create links", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ task_id: "task-1", subject: "Build feature", session_id: "sess-1" }),
		];

		const result = extractTaskList(links);

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].task_id).toBe("task-1");
		expect(result.tasks[0].subject).toBe("Build feature");
		expect(result.tasks[0].status).toBe("pending");
		expect(result.tasks[0].created_at).toBe(1000);
		expect(result.tasks[0].created_by).toBe("sess-1");
		expect(result.total_count).toBe(1);
		expect(result.completed_count).toBe(0);
		expect(result.completion_rate).toBe(0);
	});

	test("task_id ordinal assignment for empty task_id", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ t: 1000, task_id: "", subject: "First task" }),
			mkTaskCreate({ t: 2000, task_id: "", subject: "Second task" }),
			mkTaskCreate({ t: 3000, task_id: "", subject: "Third task" }),
		];

		const result = extractTaskList(links);

		expect(result.tasks).toHaveLength(3);
		expect(result.tasks[0].task_id).toBe("task-1");
		expect(result.tasks[1].task_id).toBe("task-2");
		expect(result.tasks[2].task_id).toBe("task-3");
	});

	test("full lifecycle: create, assign, status_change, complete", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ t: 1000, task_id: "task-1", subject: "Build feature" }),
			mkTaskUpdate({ t: 2000, task_id: "task-1", action: "assign", owner: "builder-1" }),
			mkTaskUpdate({ t: 3000, task_id: "task-1", action: "status_change", status: "in_progress" }),
			mkTaskComplete({ t: 5000, task_id: "task-1" }),
		];

		const result = extractTaskList(links);

		expect(result.tasks).toHaveLength(1);
		const task = result.tasks[0];
		expect(task.task_id).toBe("task-1");
		expect(task.subject).toBe("Build feature");
		expect(task.owner).toBe("builder-1");
		expect(task.status).toBe("completed");
		expect(task.created_at).toBe(1000);
		expect(task.completed_at).toBe(5000);
	});

	test("blocked_by propagation from TaskUpdate", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ t: 1000, task_id: "task-1", subject: "Feature A" }),
			mkTaskCreate({ t: 1100, task_id: "task-2", subject: "Feature B" }),
			mkTaskUpdate({
				t: 2000,
				task_id: "task-2",
				action: "status_change",
				blocked_by: ["task-1"],
			}),
		];

		const result = extractTaskList(links);

		const task2 = result.tasks.find((t) => t.task_id === "task-2");
		expect(task2).toBeDefined();
		expect(task2?.blocked_by).toEqual(["task-1"]);
	});

	test("completion_rate calculation", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ t: 1000, task_id: "t1", subject: "Task 1" }),
			mkTaskCreate({ t: 1100, task_id: "t2", subject: "Task 2" }),
			mkTaskCreate({ t: 1200, task_id: "t3", subject: "Task 3" }),
			mkTaskCreate({ t: 1300, task_id: "t4", subject: "Task 4" }),
			mkTaskComplete({ t: 3000, task_id: "t1" }),
			mkTaskComplete({ t: 4000, task_id: "t2" }),
		];

		const result = extractTaskList(links);

		expect(result.total_count).toBe(4);
		expect(result.completed_count).toBe(2);
		expect(result.completion_rate).toBe(0.5);
	});

	test("mixed task and non-task links are filtered", () => {
		const links: readonly LinkEvent[] = [
			mkSpawn(),
			mkMessage(),
			mkTaskCreate({ t: 1000, task_id: "task-1", subject: "Build it" }),
			mkMessage({ t: 2500 }),
			mkTaskComplete({ t: 5000, task_id: "task-1" }),
		];

		const result = extractTaskList(links);

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].task_id).toBe("task-1");
		expect(result.tasks[0].status).toBe("completed");
		expect(result.total_count).toBe(1);
		expect(result.completed_count).toBe(1);
		expect(result.completion_rate).toBe(1);
	});

	test("description and active_form preservation", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({
				task_id: "task-1",
				subject: "Build feature",
				description: "Implement the widget with full tests",
				active_form: "Building widget...",
			}),
		];

		const result = extractTaskList(links);

		expect(result.tasks[0].description).toBe("Implement the widget with full tests");
		expect(result.tasks[0].active_form).toBe("Building widget...");
	});

	test("task_complete without matching create produces minimal record", () => {
		const links: readonly LinkEvent[] = [
			mkTaskComplete({
				t: 5000,
				task_id: "orphan-task",
				agent: "builder-1",
				subject: "Orphan task",
				session_id: "sess-orphan",
			}),
		];

		const result = extractTaskList(links);

		expect(result.tasks).toHaveLength(1);
		const task = result.tasks[0];
		expect(task.task_id).toBe("orphan-task");
		expect(task.subject).toBe("Orphan task");
		expect(task.status).toBe("completed");
		expect(task.created_at).toBe(5000);
		expect(task.completed_at).toBe(5000);
		expect(task.owner).toBe("builder-1");
		expect(task.created_by).toBe("sess-orphan");
	});

	test("tasks sorted by created_at", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ t: 3000, task_id: "t3", subject: "Third" }),
			mkTaskCreate({ t: 1000, task_id: "t1", subject: "First" }),
			mkTaskCreate({ t: 2000, task_id: "t2", subject: "Second" }),
		];

		const result = extractTaskList(links);

		expect(result.tasks[0].task_id).toBe("t1");
		expect(result.tasks[1].task_id).toBe("t2");
		expect(result.tasks[2].task_id).toBe("t3");
	});

	test("multiple tasks with mixed statuses", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ t: 1000, task_id: "t1", subject: "Task 1" }),
			mkTaskCreate({ t: 1100, task_id: "t2", subject: "Task 2" }),
			mkTaskCreate({ t: 1200, task_id: "t3", subject: "Task 3" }),
			mkTaskUpdate({ t: 2000, task_id: "t2", action: "status_change", status: "in_progress" }),
			mkTaskComplete({ t: 3000, task_id: "t1" }),
		];

		const result = extractTaskList(links);

		expect(result.tasks).toHaveLength(3);
		expect(result.tasks.find((t) => t.task_id === "t1")?.status).toBe("completed");
		expect(result.tasks.find((t) => t.task_id === "t2")?.status).toBe("in_progress");
		expect(result.tasks.find((t) => t.task_id === "t3")?.status).toBe("pending");
	});

	test("update for non-existent task is ignored", () => {
		const links: readonly LinkEvent[] = [
			mkTaskCreate({ t: 1000, task_id: "task-1", subject: "Real task" }),
			mkTaskUpdate({ t: 2000, task_id: "nonexistent", action: "assign", owner: "ghost" }),
		];

		const result = extractTaskList(links);

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].task_id).toBe("task-1");
		expect(result.tasks[0].owner).toBeUndefined();
	});
});

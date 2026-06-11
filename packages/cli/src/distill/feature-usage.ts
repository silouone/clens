import type { FeatureFlag, FeatureUsage, LoopWakeup, StoredEvent, WorkflowRun } from "../types";

// ── Detection signatures ────────────────────────────────────────────
//
// Loop (/loop):
//   - ScheduleWakeup tool calls (dynamic pacing; prompt may be <<autonomous-loop-dynamic>>)
//   - Skill tool with skill === "loop"
//   - UserPromptSubmit prompts starting with /loop
//   - CronCreate / ScheduleWakeup carrying the <<autonomous-loop sentinel
// Goal (/goal):
//   - /goal token inside UserPromptSubmit prompts (no dedicated tool exists)
// Workflow:
//   - Workflow tool calls (meta name/description embedded in the script input)

const AUTONOMOUS_SENTINEL = "<<autonomous-loop";
const GOAL_TOKEN = /(^|\s)\/goal(\s|$)/;
const LOOP_PROMPT = /^\s*\/loop(\s|$)/;

const GOAL_EXCERPT_LEN = 200;

type ToolEventData = {
	readonly tool_name?: unknown;
	readonly tool_input?: unknown;
	readonly prompt?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const isPreToolUse = (e: StoredEvent): boolean => e.event === "PreToolUse";

const toolName = (e: StoredEvent): string | undefined => {
	const name = (e.data as ToolEventData).tool_name;
	return typeof name === "string" ? name : undefined;
};

const toolInput = (e: StoredEvent): Record<string, unknown> | undefined =>
	asRecord((e.data as ToolEventData).tool_input);

const promptOf = (e: StoredEvent): string | undefined => {
	const prompt = (e.data as ToolEventData).prompt;
	return typeof prompt === "string" ? prompt : undefined;
};

// ── Loop extraction ─────────────────────────────────────────────────

const toLoopWakeup = (e: StoredEvent): LoopWakeup | undefined => {
	const input = toolInput(e);
	if (!input) return undefined;
	const delay = typeof input.delaySeconds === "number" ? input.delaySeconds : 0;
	const reason = typeof input.reason === "string" ? input.reason : undefined;
	return { t: e.t, delay_seconds: delay, ...(reason ? { reason } : {}) };
};

const inputContainsSentinel = (e: StoredEvent): boolean => {
	const input = toolInput(e);
	if (!input) return false;
	return Object.values(input).some(
		(v) => typeof v === "string" && v.includes(AUTONOMOUS_SENTINEL),
	);
};

const extractLoop = (events: readonly StoredEvent[]): FeatureUsage["loop"] => {
	const preTool = events.filter(isPreToolUse);
	const wakeupEvents = preTool.filter((e) => toolName(e) === "ScheduleWakeup");
	const wakeups = wakeupEvents.flatMap((e) => {
		const w = toLoopWakeup(e);
		return w ? [w] : [];
	});

	const skillInvocations = preTool.filter((e) => {
		if (toolName(e) !== "Skill") return false;
		return toolInput(e)?.skill === "loop";
	}).length;

	const loopPrompts = events.filter(
		(e) => e.event === "UserPromptSubmit" && LOOP_PROMPT.test(promptOf(e) ?? ""),
	).length;

	const autonomous = preTool.some(
		(e) => (toolName(e) === "ScheduleWakeup" || toolName(e) === "CronCreate") && inputContainsSentinel(e),
	);

	if (wakeups.length === 0 && skillInvocations === 0 && loopPrompts === 0 && !autonomous) {
		return undefined;
	}

	return {
		wakeup_count: wakeups.length,
		total_scheduled_wait_s: wakeups.reduce((sum, w) => sum + w.delay_seconds, 0),
		autonomous,
		skill_invocations: skillInvocations + loopPrompts,
		wakeups,
	};
};

// ── Goal extraction ─────────────────────────────────────────────────

const extractGoalText = (prompt: string): string => {
	const idx = prompt.search(GOAL_TOKEN);
	const fromGoal = prompt.slice(prompt.indexOf("/goal", idx)).trim();
	return fromGoal.length > GOAL_EXCERPT_LEN ? `${fromGoal.slice(0, GOAL_EXCERPT_LEN)}…` : fromGoal;
};

const extractGoal = (events: readonly StoredEvent[]): FeatureUsage["goal"] => {
	const goals = events.flatMap((e) => {
		if (e.event !== "UserPromptSubmit") return [];
		const prompt = promptOf(e);
		return prompt && GOAL_TOKEN.test(prompt) ? [extractGoalText(prompt)] : [];
	});
	return goals.length > 0 ? { goals } : undefined;
};

// ── Workflow extraction ─────────────────────────────────────────────

/** Pull name/description out of a workflow script's `export const meta = {...}` literal. */
const parseScriptMeta = (script: string): { name?: string; description?: string } => {
	const nameMatch = script.match(/name:\s*['"`]([^'"`]+)['"`]/);
	const descMatch = script.match(/description:\s*['"`]([^'"`]+)['"`]/);
	return {
		...(nameMatch ? { name: nameMatch[1] } : {}),
		...(descMatch ? { description: descMatch[1] } : {}),
	};
};

const toWorkflowRun = (e: StoredEvent): WorkflowRun => {
	const input = toolInput(e) ?? {};
	if (typeof input.name === "string") return { t: e.t, name: input.name };
	if (typeof input.script === "string") {
		const meta = parseScriptMeta(input.script);
		return { t: e.t, ...meta };
	}
	if (typeof input.scriptPath === "string") {
		const file = input.scriptPath.split("/").pop() ?? input.scriptPath;
		return { t: e.t, name: file.replace(/\.[^.]+$/, "") };
	}
	return { t: e.t };
};

const extractWorkflow = (events: readonly StoredEvent[]): FeatureUsage["workflow"] => {
	const runs = events
		.filter((e) => isPreToolUse(e) && toolName(e) === "Workflow")
		.map(toWorkflowRun);
	return runs.length > 0 ? { invocation_count: runs.length, runs } : undefined;
};

// ── Public API ──────────────────────────────────────────────────────

/** Extract loop/goal/workflow usage from session events. Undefined when none used. */
export const extractFeatureUsage = (events: readonly StoredEvent[]): FeatureUsage | undefined => {
	const loop = extractLoop(events);
	const goal = extractGoal(events);
	const workflow = extractWorkflow(events);

	const flags: readonly FeatureFlag[] = [
		...(loop ? (["loop"] as const) : []),
		...(goal ? (["goal"] as const) : []),
		...(workflow ? (["workflow"] as const) : []),
	];

	if (flags.length === 0) return undefined;

	return {
		flags,
		...(loop ? { loop } : {}),
		...(goal ? { goal } : {}),
		...(workflow ? { workflow } : {}),
	};
};

// ── Raw-content fast path (for session listing) ─────────────────────

const RAW_LOOP_MARKERS = [
	'"tool_name":"ScheduleWakeup"',
	AUTONOMOUS_SENTINEL,
	'"skill":"loop"',
] as const;

const RAW_WORKFLOW_MARKER = '"tool_name":"Workflow"';

/** A line is a goal hit only when it's a UserPromptSubmit whose prompt has the /goal token. */
const lineHasGoalPrompt = (line: string): boolean => {
	if (!line.includes('"event":"UserPromptSubmit"')) return false;
	try {
		const parsed: unknown = JSON.parse(line);
		const data = asRecord(asRecord(parsed)?.data);
		const prompt = data?.prompt;
		return typeof prompt === "string" && GOAL_TOKEN.test(prompt);
	} catch {
		return false;
	}
};

/**
 * Cheap substring-based detection over raw JSONL content.
 * Used by the session listing where full event parsing is too expensive.
 */
export const detectFeatureFlags = (rawContent: string): readonly FeatureFlag[] => {
	const loop = RAW_LOOP_MARKERS.some((m) => rawContent.includes(m))
		|| /"prompt":"\s*\/loop[ \\"]/.test(rawContent);
	const workflow = rawContent.includes(RAW_WORKFLOW_MARKER);
	const goal = rawContent.includes("/goal")
		&& rawContent.split("\n").some(lineHasGoalPrompt);

	return [
		...(loop ? (["loop"] as const) : []),
		...(goal ? (["goal"] as const) : []),
		...(workflow ? (["workflow"] as const) : []),
	];
};

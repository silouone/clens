import type {
	DetectionSource,
	FeatureFlag,
	FeatureUsage,
	GoalEntry,
	LoopUsage,
	LoopWakeup,
	StoredEvent,
	TranscriptEntry,
	WorkflowRun,
	WorkflowUsage,
} from "../types";

// ── Detection signatures (three tiers, strongest source wins) ───────
//
// Loop (/loop):
//   tier 1 structural/tool — ScheduleWakeup, Skill{loop}, CronCreate sentinel
//   tier 1 command         — UserPromptSubmit prompt starting with /loop
//   tier 2 command_tag     — <command-name>/loop</command-name> in a transcript user entry
//   tier 3 inferred        — "loop until", "keep iterating until", "self-pace(d)"
// Goal (/goal):
//   tier 1 command         — literal /goal token in a free-text UserPromptSubmit prompt
//   tier 2 command_tag     — <command-name>/goal</command-name> + <command-args> in the transcript
//   tier 3 inferred        — "the goal is…", "objective:", "set a goal" in the agent's own thinking/text
// Workflow:
//   tier 1 tool            — Workflow tool call (meta parsed from the script)
//   tier 3 inferred        — "orchestrate", "fan out", "spawn N agents" when no Workflow tool fired
//
// IMPORTANT (grounded in Phase 0): slash commands are NOT delivered to cLens hook
// events — `/goal …` never appears as a UserPromptSubmit prompt. The command_tag
// tier therefore lives entirely on the transcript side and only runs at distill
// time (where the transcript is read). The raw fast-path `detectFeatureFlags`
// below cannot see it; that gap is intentional and documented there.

const AUTONOMOUS_SENTINEL = "<<autonomous-loop";
const GOAL_TOKEN = /(^|\s)\/goal(\s|$)/;
const LOOP_PROMPT = /^\s*\/loop(\s|$)/;

const GOAL_EXCERPT_LEN = 200;

// Source precedence — higher wins when a feature is detected by several tiers.
const SOURCE_RANK: Readonly<Record<DetectionSource, number>> = {
	command: 3,
	tool: 3,
	command_tag: 2,
	inferred: 1,
};
const strongerSource = (a: DetectionSource, b: DetectionSource): DetectionSource =>
	SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;

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

// ── Phase 1.2 · Transcript text harvest ─────────────────────────────
//
// Flatten transcript entries into scannable spans. Pure + exported for unit
// testing. tool_result blocks are deliberately dropped so a semantic match can
// never fire on a file the agent merely read (false-positive guard, see below).

export type SpanKind = "thinking" | "text" | "user";

export interface FeatureTextSpan {
	readonly role: "user" | "assistant";
	readonly kind: SpanKind;
	readonly text: string;
	readonly t: number;
}

export const harvestTranscriptSpans = (
	entries: readonly TranscriptEntry[],
): readonly FeatureTextSpan[] =>
	entries.flatMap((entry): FeatureTextSpan[] => {
		const msg = entry.message;
		if (!msg) return [];
		const t = Date.parse(entry.timestamp) || 0;
		const content = msg.content;

		if (entry.type === "user") {
			// String content = a genuine user submission (incl. slash-command wrappers).
			if (typeof content === "string") {
				return [{ role: "user", kind: "user", text: content, t }];
			}
			// Array content on a user entry is tool_result fan-in (+ rare text). Drop
			// tool_result; keep only first-class user text.
			if (Array.isArray(content)) {
				return content.flatMap((b): FeatureTextSpan[] =>
					b.type === "text" ? [{ role: "user", kind: "user", text: b.text, t }] : [],
				);
			}
			return [];
		}

		if (entry.type === "assistant" && Array.isArray(content)) {
			return content.flatMap((b): FeatureTextSpan[] => {
				if (b.type === "thinking")
					return [{ role: "assistant", kind: "thinking", text: b.thinking, t }];
				if (b.type === "text") return [{ role: "assistant", kind: "text", text: b.text, t }];
				return [];
			});
		}

		return [];
	});

// Agent-authored spans only — semantic detection must read the agent's own
// reasoning/output, never a user prompt or a (already-dropped) tool_result.
const agentSpans = (spans: readonly FeatureTextSpan[]): readonly FeatureTextSpan[] =>
	spans.filter((s) => s.role === "assistant");

const userSpans = (spans: readonly FeatureTextSpan[]): readonly FeatureTextSpan[] =>
	spans.filter((s) => s.kind === "user");

// ── False-positive guards (semantic tier) ───────────────────────────
//
// Reject spans that are quoting this repo's own detector source (the literal
// "loop/goal/workflow" string and the identifiers below routinely appear when
// the agent reads feature-usage.ts / the plan and would otherwise self-trigger).
const REPO_SOURCE_GUARD =
	/loop\/goal\/workflow|extractFeatureUsage|GOAL_TOKEN|feature[_-]usage|DetectionSource|command-name>\/goal/i;
// Past-tense retrospectives ("the goal was to…") are descriptions of finished
// work, not goal-setting — exclude them from the goal semantic match.
const PAST_TENSE_GOAL = /\bgoals?\s+(was|were|had been)\b/i;

const isGuardedSpan = (text: string): boolean => REPO_SOURCE_GUARD.test(text);

const clip = (s: string): string => {
	const t = s.trim().replace(/\s+/g, " ");
	return t.length > GOAL_EXCERPT_LEN ? `${t.slice(0, GOAL_EXCERPT_LEN)}…` : t;
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
	return Object.values(input).some((v) => typeof v === "string" && v.includes(AUTONOMOUS_SENTINEL));
};

const COMMAND_TAG_LOOP = /<command-name>\/loop<\/command-name>/i;
const SEMANTIC_LOOP =
	/\bloop\s+until\b|\bkeep\s+iterating\s+until\b|\bself[- ]?pac(?:e|ed|ing)\b|\buntil\s+(?:the\s+)?tests?\s+pass\b/i;

const extractLoop = (
	events: readonly StoredEvent[],
	spans: readonly FeatureTextSpan[],
): LoopUsage | undefined => {
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
		(e) =>
			(toolName(e) === "ScheduleWakeup" || toolName(e) === "CronCreate") &&
			inputContainsSentinel(e),
	);

	const hasTool = wakeups.length > 0 || skillInvocations > 0 || autonomous;
	const hasCommand = loopPrompts > 0;
	const hasCommandTag = userSpans(spans).some((s) => COMMAND_TAG_LOOP.test(s.text));
	const hasSemantic = agentSpans(spans).some(
		(s) => !isGuardedSpan(s.text) && SEMANTIC_LOOP.test(s.text),
	);

	if (!hasTool && !hasCommand && !hasCommandTag && !hasSemantic) return undefined;

	// Strongest tier wins for the provenance stamp.
	const source: DetectionSource = hasTool
		? "tool"
		: hasCommand
			? "command"
			: hasCommandTag
				? "command_tag"
				: "inferred";

	return {
		wakeup_count: wakeups.length,
		total_scheduled_wait_s: wakeups.reduce((sum, w) => sum + w.delay_seconds, 0),
		autonomous,
		skill_invocations: skillInvocations + loopPrompts,
		wakeups,
		source,
	};
};

// ── Goal extraction ─────────────────────────────────────────────────

const extractGoalText = (prompt: string): string => {
	const idx = prompt.search(GOAL_TOKEN);
	const fromGoal = prompt.slice(prompt.indexOf("/goal", idx)).trim();
	return fromGoal.length > GOAL_EXCERPT_LEN ? `${fromGoal.slice(0, GOAL_EXCERPT_LEN)}…` : fromGoal;
};

// tier 1 — literal /goal typed in a free-text prompt (rare; commands bypass events).
const goalCommandEntries = (events: readonly StoredEvent[]): readonly GoalEntry[] =>
	events.flatMap((e): GoalEntry[] => {
		if (e.event !== "UserPromptSubmit") return [];
		const prompt = promptOf(e);
		return prompt && GOAL_TOKEN.test(prompt)
			? [{ text: extractGoalText(prompt), source: "command", t: e.t }]
			: [];
	});

// tier 2 — <command-name>/goal</command-name> + <command-args> in the transcript.
const COMMAND_TAG_GOAL = /<command-name>\/goal<\/command-name>/i;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/i;

const goalCommandTagEntries = (spans: readonly FeatureTextSpan[]): readonly GoalEntry[] =>
	userSpans(spans).flatMap((s): GoalEntry[] => {
		if (!COMMAND_TAG_GOAL.test(s.text)) return [];
		const args = s.text.match(COMMAND_ARGS)?.[1]?.trim();
		const text = args && args.length > 0 ? clip(args) : "/goal";
		return [{ text, source: "command_tag", t: s.t }];
	});

// tier 3 — declarative goal-setting in the agent's own thinking/text.
const SEMANTIC_GOAL =
	/\b(?:my|the|our|this\s+session(?:'s)?|session)\s+goal\s+(?:is|=|:)|\bobjective\s*:|\bset\s+a\s+goal\b/i;

const goalSemanticEntries = (spans: readonly FeatureTextSpan[]): readonly GoalEntry[] =>
	agentSpans(spans).flatMap((s): GoalEntry[] => {
		if (isGuardedSpan(s.text) || PAST_TENSE_GOAL.test(s.text)) return [];
		const m = s.text.match(SEMANTIC_GOAL);
		if (!m) return [];
		// Excerpt from the matched phrase forward, so the captured text reads as the goal.
		const from = s.text.slice(s.text.indexOf(m[0]));
		return [{ text: clip(from), source: "inferred", t: s.t }];
	});

interface GoalResult {
	readonly goals: readonly GoalEntry[];
	readonly source: DetectionSource;
}

const extractGoal = (
	events: readonly StoredEvent[],
	spans: readonly FeatureTextSpan[],
): GoalResult | undefined => {
	const command = goalCommandEntries(events);
	const commandTag = goalCommandTagEntries(spans);
	const semantic = goalSemanticEntries(spans);

	// Strongest non-empty tier wins (dedupe across tiers — no double counting).
	if (command.length > 0) return { goals: command, source: "command" };
	if (commandTag.length > 0) return { goals: commandTag, source: "command_tag" };
	if (semantic.length > 0) return { goals: semantic, source: "inferred" };
	return undefined;
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

const SEMANTIC_WORKFLOW =
	/\bfan\s+out\b|\borchestrat(?:e|ing|ion)\b|\bspawn\s+\d+\s+agents?\b|\bfan-out\b/i;

const extractWorkflow = (
	events: readonly StoredEvent[],
	spans: readonly FeatureTextSpan[],
): WorkflowUsage | undefined => {
	const runs = events
		.filter((e) => isPreToolUse(e) && toolName(e) === "Workflow")
		.map(toWorkflowRun);

	if (runs.length > 0) {
		return { invocation_count: runs.length, runs, source: "tool" };
	}

	// tier 3 — only when no real Workflow tool fired.
	const inferred = agentSpans(spans).some(
		(s) => !isGuardedSpan(s.text) && SEMANTIC_WORKFLOW.test(s.text),
	);
	if (inferred) {
		return { invocation_count: 0, runs: [], source: "inferred" };
	}
	return undefined;
};

// ── Public API ──────────────────────────────────────────────────────

/**
 * Extract loop/goal/workflow usage from session events, optionally enriched with
 * transcript spans (harvested via `harvestTranscriptSpans`). Undefined when none
 * used. The transcript arg is optional so events-only call sites/tests still pass.
 */
export const extractFeatureUsage = (
	events: readonly StoredEvent[],
	spans: readonly FeatureTextSpan[] = [],
): FeatureUsage | undefined => {
	const loop = extractLoop(events, spans);
	const goal = extractGoal(events, spans);
	const workflow = extractWorkflow(events, spans);

	const flags: readonly FeatureFlag[] = [
		...(loop ? (["loop"] as const) : []),
		...(goal ? (["goal"] as const) : []),
		...(workflow ? (["workflow"] as const) : []),
	];

	if (flags.length === 0) return undefined;

	// `inferred` is true when at least one detected feature's sole provenance is
	// the heuristic tier — the UI uses this to label a session honestly.
	const anyInferred =
		loop?.source === "inferred" || goal?.source === "inferred" || workflow?.source === "inferred";

	return {
		flags,
		...(loop ? { loop } : {}),
		...(goal ? { goal: { goals: goal.goals } } : {}),
		...(workflow ? { workflow } : {}),
		...(anyInferred ? { inferred: true } : {}),
	};
};

// ── Raw-content fast path (for session listing) ─────────────────────

// Structural markers whose mere presence on a line is a reliable loop signal:
// they only ever occur as the tool_name / skill of an actual loop tool call,
// not as free-floating text inside file content being read.
const RAW_LOOP_MARKERS = ['"tool_name":"ScheduleWakeup"', '"skill":"loop"'] as const;

const RAW_WORKFLOW_MARKER = '"tool_name":"Workflow"';

/**
 * The <<autonomous-loop sentinel is plain text that can appear anywhere — including
 * inside escaped file-content the agent merely read (e.g. this source file). It is a
 * loop signal ONLY when it rides inside an actual ScheduleWakeup / CronCreate tool
 * call, mirroring extractLoop's `autonomous` gate. So require both on the SAME line
 * (each JSONL line is one event) rather than anywhere in the whole blob.
 */
const lineHasAutonomousSentinel = (line: string): boolean =>
	line.includes(AUTONOMOUS_SENTINEL) &&
	(line.includes('"tool_name":"ScheduleWakeup"') || line.includes('"tool_name":"CronCreate"'));

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
 *
 * INTENTIONAL GAP (Phase 0 finding): slash commands never reach cLens raw events,
 * so the `command_tag` goal/loop tier and the `inferred` semantic tier are
 * invisible here — they live in the transcript, which the list scan deliberately
 * does NOT read (it would break feature-index's cheap (mtime,size)-keyed model).
 * The list badge therefore stays structural-only; the richer signal is surfaced
 * on session detail from the distilled `feature_usage`. Keeping the two consistent
 * for the transcript tiers would require reading the transcript per session, which
 * is out of scope for the fast path.
 */
export const detectFeatureFlags = (rawContent: string): readonly FeatureFlag[] => {
	const loop =
		RAW_LOOP_MARKERS.some((m) => rawContent.includes(m)) ||
		/"prompt":"\s*\/loop[ \\"]/.test(rawContent) ||
		(rawContent.includes(AUTONOMOUS_SENTINEL) &&
			rawContent.split("\n").some(lineHasAutonomousSentinel));
	const workflow = rawContent.includes(RAW_WORKFLOW_MARKER);
	const goal = rawContent.includes("/goal") && rawContent.split("\n").some(lineHasGoalPrompt);

	return [
		...(loop ? (["loop"] as const) : []),
		...(goal ? (["goal"] as const) : []),
		...(workflow ? (["workflow"] as const) : []),
	];
};

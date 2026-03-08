import { describe, expect, test } from "bun:test";
import {
	buildTransition,
	chainSessions,
	classifyLifecycle,
	classifyPhase,
	composeJourney,
	computeCumulativeStats,
	type SessionChainInput,
} from "../src/distill/journey";
import type { JourneyPhase, StatsResult } from "../src/types";

// --- Test helpers ---

const makeInput = (
	overrides: Partial<SessionChainInput> & { session_id: string },
): SessionChainInput => ({
	start_time: 1000,
	end_time: 60000,
	cwd: "/project",
	source: "startup",
	end_reason: "user_exit",
	event_count: 50,
	duration_ms: 59000,
	...overrides,
});

const makePhase = (
	overrides: Partial<JourneyPhase> & { session_id: string; phase_type: JourneyPhase["phase_type"] },
): JourneyPhase => ({
	source: "startup",
	duration_ms: 60000,
	event_count: 50,
	...overrides,
});

const makeStats = (overrides: Partial<StatsResult> = {}): StatsResult => ({
	total_events: 50,
	duration_ms: 60000,
	events_by_type: {},
	tools_by_name: {},
	tool_call_count: 20,
	failure_count: 2,
	failure_rate: 0.1,
	unique_files: [],
	...overrides,
});

// --- chainSessions ---

describe("chainSessions", () => {
	test("empty input returns empty array", () => {
		const result = chainSessions([]);
		expect(result).toEqual([]);
	});

	test("single session returns single-element group", () => {
		const result = chainSessions([makeInput({ session_id: "s1" })]);
		expect(result).toEqual([["s1"]]);
	});

	test("two sessions chained by clear within gap threshold", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 6000,
				end_time: 10000,
				cwd: "/proj",
				source: "clear",
			}),
		]);
		expect(result).toEqual([["s1", "s2"]]);
	});

	test("gap > 5000ms breaks chain", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 11000,
				end_time: 15000,
				cwd: "/proj",
				source: "clear",
			}),
		]);
		expect(result).toEqual([["s1"], ["s2"]]);
	});

	test("different cwd breaks chain", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj-a" }),
			makeInput({
				session_id: "s2",
				start_time: 6000,
				end_time: 10000,
				cwd: "/proj-b",
				source: "clear",
			}),
		]);
		expect(result).toEqual([["s1"], ["s2"]]);
	});

	test("compact source chains sessions", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 6000,
				end_time: 10000,
				cwd: "/proj",
				source: "compact",
			}),
		]);
		expect(result).toEqual([["s1", "s2"]]);
	});

	test("three-session chain when all conditions met", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 6000,
				end_time: 9000,
				cwd: "/proj",
				source: "clear",
			}),
			makeInput({
				session_id: "s3",
				start_time: 10000,
				end_time: 14000,
				cwd: "/proj",
				source: "compact",
			}),
		]);
		expect(result).toEqual([["s1", "s2", "s3"]]);
	});

	test("source=startup does not chain", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 6000,
				end_time: 10000,
				cwd: "/proj",
				source: "startup",
			}),
		]);
		expect(result).toEqual([["s1"], ["s2"]]);
	});

	test("undefined cwd breaks chain", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: undefined }),
			makeInput({
				session_id: "s2",
				start_time: 6000,
				end_time: 10000,
				cwd: undefined,
				source: "clear",
			}),
		]);
		expect(result).toEqual([["s1"], ["s2"]]);
	});

	test("sessions sorted by start_time regardless of input order", () => {
		const result = chainSessions([
			makeInput({
				session_id: "s2",
				start_time: 6000,
				end_time: 10000,
				cwd: "/proj",
				source: "clear",
			}),
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
		]);
		expect(result).toEqual([["s1", "s2"]]);
	});

	test("gap exactly at 5000ms still chains", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 10000,
				end_time: 14000,
				cwd: "/proj",
				source: "clear",
			}),
		]);
		expect(result).toEqual([["s1", "s2"]]);
	});

	test("gap at 5001ms breaks chain", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: 5000, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 10001,
				end_time: 14000,
				cwd: "/proj",
				source: "clear",
			}),
		]);
		expect(result).toEqual([["s1"], ["s2"]]);
	});

	test("uses end_time fallback to start_time when end_time undefined", () => {
		const result = chainSessions([
			makeInput({ session_id: "s1", start_time: 1000, end_time: undefined, cwd: "/proj" }),
			makeInput({
				session_id: "s2",
				start_time: 3000,
				end_time: 8000,
				cwd: "/proj",
				source: "clear",
			}),
		]);
		// gap = 3000 - 1000 = 2000 <= 5000, so should chain
		expect(result).toEqual([["s1", "s2"]]);
	});
});

// --- classifyPhase ---

describe("classifyPhase", () => {
	test("/prime detected", () => {
		const result = classifyPhase(makeInput({ session_id: "s1", first_prompt: "/prime setup" }));
		expect(result.phase_type).toBe("prime");
	});

	test("/brainstorm detected", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "/brainstorm ideas" }),
		);
		expect(result.phase_type).toBe("brainstorm");
	});

	test("/plan detected with word boundary", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "/plan the feature" }),
		);
		expect(result.phase_type).toBe("plan");
	});

	test("/plan_w_team detected", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "/plan_w_team orchestrate" }),
		);
		expect(result.phase_type).toBe("plan");
	});

	test("/planet does NOT trigger plan", () => {
		const result = classifyPhase(
			makeInput({
				session_id: "s1",
				first_prompt: "/planet earth info",
				duration_ms: 60000,
				event_count: 50,
			}),
		);
		expect(result.phase_type).not.toBe("plan");
	});

	test("/build detected with spec_ref extraction", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "/build specs/journey-detection.md" }),
		);
		expect(result.phase_type).toBe("build");
		expect(result.spec_ref).toBe("specs/journey-detection.md");
	});

	test("/build without spec_ref", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "/build the feature" }),
		);
		expect(result.phase_type).toBe("build");
		expect(result.spec_ref).toBeUndefined();
	});

	test("/review detected", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "/review PR changes" }),
		);
		expect(result.phase_type).toBe("review");
	});

	test("/test detected", () => {
		const result = classifyPhase(makeInput({ session_id: "s1", first_prompt: "/test run suite" }));
		expect(result.phase_type).toBe("test");
	});

	test("commit keyword detected", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "commit the changes" }),
		);
		expect(result.phase_type).toBe("commit");
	});

	test("tool ratio exploration: high read-to-write ratio", () => {
		const result = classifyPhase(
			makeInput({
				session_id: "s1",
				first_prompt: "explore the codebase",
				duration_ms: 60000,
				event_count: 50,
				tools_by_name: { Read: 20, Glob: 5, Grep: 10, Edit: 2, Write: 1 },
			}),
		);
		// (20+5+10) / max(2+1, 1) = 35/3 = 11.67 > 3.0
		expect(result.phase_type).toBe("exploration");
	});

	test("tool ratio NOT exploration when ratio <= 3", () => {
		const result = classifyPhase(
			makeInput({
				session_id: "s1",
				first_prompt: "work on code",
				duration_ms: 60000,
				event_count: 50,
				tools_by_name: { Read: 3, Edit: 5, Write: 2 },
			}),
		);
		// (3+0+0) / max(5+2, 1) = 3/7 = 0.43 <= 3.0
		expect(result.phase_type).not.toBe("exploration");
	});

	test("TaskCreate burst triggers orchestrated_build", () => {
		const result = classifyPhase(
			makeInput({
				session_id: "s1",
				first_prompt: "setup tasks",
				duration_ms: 60000,
				event_count: 50,
				tools_by_name: { TaskCreate: 5, Read: 2, Edit: 3 },
			}),
		);
		expect(result.phase_type).toBe("orchestrated_build");
	});

	test("TaskCreate <= 3 does NOT trigger orchestrated_build", () => {
		const result = classifyPhase(
			makeInput({
				session_id: "s1",
				first_prompt: "do some work",
				duration_ms: 60000,
				event_count: 50,
				tools_by_name: { TaskCreate: 3, Read: 2, Edit: 3 },
			}),
		);
		expect(result.phase_type).not.toBe("orchestrated_build");
	});

	test("short duration + low events triggers abort", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", duration_ms: 10000, event_count: 5 }),
		);
		expect(result.phase_type).toBe("abort");
	});

	test("duration exactly 30000 does NOT trigger abort", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", duration_ms: 30000, event_count: 5 }),
		);
		expect(result.phase_type).not.toBe("abort");
	});

	test("event_count exactly 15 does NOT trigger abort", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", duration_ms: 10000, event_count: 15 }),
		);
		expect(result.phase_type).not.toBe("abort");
	});

	test("freeform fallback when nothing matches", () => {
		const result = classifyPhase(
			makeInput({
				session_id: "s1",
				first_prompt: "do something interesting",
				duration_ms: 60000,
				event_count: 50,
			}),
		);
		expect(result.phase_type).toBe("freeform");
	});

	test("cascade priority: /prime wins over commit keyword", () => {
		const result = classifyPhase(
			makeInput({ session_id: "s1", first_prompt: "/prime commit setup" }),
		);
		expect(result.phase_type).toBe("prime");
	});

	test("exploration check uses max(writeOps, 1) to avoid division by zero", () => {
		const result = classifyPhase(
			makeInput({
				session_id: "s1",
				first_prompt: "look around",
				duration_ms: 60000,
				event_count: 50,
				tools_by_name: { Read: 10 },
			}),
		);
		// (10+0+0) / max(0+0, 1) = 10/1 = 10 > 3.0
		expect(result.phase_type).toBe("exploration");
	});
});

// --- buildTransition ---

describe("buildTransition", () => {
	test("calculates gap_ms from end_time", () => {
		const from = makeInput({ session_id: "s1", start_time: 1000, end_time: 5000 });
		const to = makeInput({ session_id: "s2", start_time: 8000 });
		const result = buildTransition(from, to);
		expect(result.gap_ms).toBe(3000);
	});

	test("uses start_time fallback when end_time undefined", () => {
		const from = makeInput({ session_id: "s1", start_time: 2000, end_time: undefined });
		const to = makeInput({ session_id: "s2", start_time: 7000 });
		const result = buildTransition(from, to);
		expect(result.gap_ms).toBe(5000);
	});

	test("trigger is compact_auto when source=compact", () => {
		const from = makeInput({ session_id: "s1" });
		const to = makeInput({ session_id: "s2", source: "compact" });
		const result = buildTransition(from, to);
		expect(result.trigger).toBe("compact_auto");
	});

	test("trigger is clear when source is not compact", () => {
		const from = makeInput({ session_id: "s1" });
		const to = makeInput({ session_id: "s2", source: "clear" });
		const result = buildTransition(from, to);
		expect(result.trigger).toBe("clear");
	});

	test("git_changed true when both commits defined and different", () => {
		const from = makeInput({ session_id: "s1", git_commit: "abc123" });
		const to = makeInput({ session_id: "s2", git_commit: "def456" });
		const result = buildTransition(from, to);
		expect(result.git_changed).toBe(true);
	});

	test("git_changed false when commits are the same", () => {
		const from = makeInput({ session_id: "s1", git_commit: "abc123" });
		const to = makeInput({ session_id: "s2", git_commit: "abc123" });
		const result = buildTransition(from, to);
		expect(result.git_changed).toBe(false);
	});

	test("git_changed false when from git_commit undefined", () => {
		const from = makeInput({ session_id: "s1" });
		const to = makeInput({ session_id: "s2", git_commit: "def456" });
		const result = buildTransition(from, to);
		expect(result.git_changed).toBe(false);
	});

	test("git_changed false when to git_commit undefined", () => {
		const from = makeInput({ session_id: "s1", git_commit: "abc123" });
		const to = makeInput({ session_id: "s2" });
		const result = buildTransition(from, to);
		expect(result.git_changed).toBe(false);
	});

	test("prompt_shift truncated to 80 chars", () => {
		const longPrompt = "x".repeat(200);
		const from = makeInput({ session_id: "s1" });
		const to = makeInput({ session_id: "s2", first_prompt: longPrompt });
		const result = buildTransition(from, to);
		expect(result.prompt_shift.length).toBe(80);
	});

	test("prompt_shift is empty string when no first_prompt", () => {
		const from = makeInput({ session_id: "s1" });
		const to = makeInput({ session_id: "s2" });
		const result = buildTransition(from, to);
		expect(result.prompt_shift).toBe("");
	});

	test("from_session and to_session set correctly", () => {
		const from = makeInput({ session_id: "from-id" });
		const to = makeInput({ session_id: "to-id" });
		const result = buildTransition(from, to);
		expect(result.from_session).toBe("from-id");
		expect(result.to_session).toBe("to-id");
	});
});

// --- classifyLifecycle ---

describe("classifyLifecycle", () => {
	test("single session returns single-session", () => {
		const result = classifyLifecycle([makePhase({ session_id: "s1", phase_type: "build" })]);
		expect(result).toBe("single-session");
	});

	test("prime + plan + build returns prime-plan-build", () => {
		const result = classifyLifecycle([
			makePhase({ session_id: "s1", phase_type: "prime" }),
			makePhase({ session_id: "s2", phase_type: "plan" }),
			makePhase({ session_id: "s3", phase_type: "build" }),
		]);
		expect(result).toBe("prime-plan-build");
	});

	test("prime + build (no plan) returns prime-build", () => {
		const result = classifyLifecycle([
			makePhase({ session_id: "s1", phase_type: "prime" }),
			makePhase({ session_id: "s2", phase_type: "build" }),
		]);
		expect(result).toBe("prime-build");
	});

	test("build only (no prime) returns build-only", () => {
		const result = classifyLifecycle([
			makePhase({ session_id: "s1", phase_type: "freeform" }),
			makePhase({ session_id: "s2", phase_type: "build" }),
		]);
		expect(result).toBe("build-only");
	});

	test("no build, no prime returns ad-hoc", () => {
		const result = classifyLifecycle([
			makePhase({ session_id: "s1", phase_type: "freeform" }),
			makePhase({ session_id: "s2", phase_type: "exploration" }),
		]);
		expect(result).toBe("ad-hoc");
	});

	test("prime + plan + build + review still returns prime-plan-build", () => {
		const result = classifyLifecycle([
			makePhase({ session_id: "s1", phase_type: "prime" }),
			makePhase({ session_id: "s2", phase_type: "plan" }),
			makePhase({ session_id: "s3", phase_type: "build" }),
			makePhase({ session_id: "s4", phase_type: "review" }),
		]);
		expect(result).toBe("prime-plan-build");
	});
});

// --- computeCumulativeStats ---

describe("computeCumulativeStats", () => {
	test("sums duration and events from phases", () => {
		const phases = [
			makePhase({ session_id: "s1", phase_type: "build", duration_ms: 30000, event_count: 20 }),
			makePhase({ session_id: "s2", phase_type: "build", duration_ms: 40000, event_count: 30 }),
		];
		const statsMap = new Map<string, StatsResult>([
			["s1", makeStats({ tool_call_count: 10, failure_count: 1 })],
			["s2", makeStats({ tool_call_count: 15, failure_count: 3 })],
		]);

		const result = computeCumulativeStats(phases, statsMap);
		expect(result.total_duration_ms).toBe(70000);
		expect(result.total_events).toBe(50);
		expect(result.total_tool_calls).toBe(25);
		expect(result.total_failures).toBe(4);
		expect(result.phase_count).toBe(2);
		expect(result.retry_count).toBe(0);
	});

	test("handles missing stats entries gracefully", () => {
		const phases = [
			makePhase({ session_id: "s1", phase_type: "build", duration_ms: 10000, event_count: 5 }),
			makePhase({ session_id: "s2", phase_type: "freeform", duration_ms: 20000, event_count: 10 }),
		];
		const statsMap = new Map<string, StatsResult>([
			["s1", makeStats({ tool_call_count: 8, failure_count: 2 })],
			// s2 missing from statsMap
		]);

		const result = computeCumulativeStats(phases, statsMap);
		expect(result.total_duration_ms).toBe(30000);
		expect(result.total_events).toBe(15);
		expect(result.total_tool_calls).toBe(8);
		expect(result.total_failures).toBe(2);
	});

	test("counts abort phases as retry_count", () => {
		const phases = [
			makePhase({ session_id: "s1", phase_type: "abort", duration_ms: 5000, event_count: 3 }),
			makePhase({ session_id: "s2", phase_type: "build", duration_ms: 60000, event_count: 50 }),
			makePhase({ session_id: "s3", phase_type: "abort", duration_ms: 8000, event_count: 7 }),
		];
		const statsMap = new Map<string, StatsResult>();

		const result = computeCumulativeStats(phases, statsMap);
		expect(result.retry_count).toBe(2);
		expect(result.phase_count).toBe(3);
	});

	test("empty phases yields zeroes", () => {
		const result = computeCumulativeStats([], new Map());
		expect(result.total_duration_ms).toBe(0);
		expect(result.total_events).toBe(0);
		expect(result.total_tool_calls).toBe(0);
		expect(result.total_failures).toBe(0);
		expect(result.phase_count).toBe(0);
		expect(result.retry_count).toBe(0);
	});
});

// --- composeJourney ---

describe("composeJourney", () => {
	test("end-to-end composition of a 3-phase journey", () => {
		const inputMap = new Map<string, SessionChainInput>([
			[
				"abcd1234-session-1",
				makeInput({
					session_id: "abcd1234-session-1",
					start_time: 1000,
					end_time: 60000,
					first_prompt: "/prime load context",
					source: "startup",
					duration_ms: 59000,
					event_count: 30,
					git_commit: "aaa",
				}),
			],
			[
				"efgh5678-session-2",
				makeInput({
					session_id: "efgh5678-session-2",
					start_time: 62000,
					end_time: 180000,
					first_prompt: "/plan the feature",
					source: "clear",
					duration_ms: 118000,
					event_count: 60,
					git_commit: "bbb",
				}),
			],
			[
				"ijkl9012-session-3",
				makeInput({
					session_id: "ijkl9012-session-3",
					start_time: 182000,
					end_time: 400000,
					first_prompt: "/build specs/journey-detection.md",
					source: "clear",
					duration_ms: 218000,
					event_count: 150,
					git_commit: "ccc",
				}),
			],
		]);

		const statsMap = new Map<string, StatsResult>([
			["abcd1234-session-1", makeStats({ tool_call_count: 10, failure_count: 0 })],
			["efgh5678-session-2", makeStats({ tool_call_count: 25, failure_count: 2 })],
			["ijkl9012-session-3", makeStats({ tool_call_count: 80, failure_count: 5 })],
		]);

		const sessionChain = ["abcd1234-session-1", "efgh5678-session-2", "ijkl9012-session-3"];
		const journey = composeJourney(sessionChain, inputMap, statsMap);

		// id is first 8 chars of first session_id
		expect(journey.id).toBe("abcd1234");

		// phases
		expect(journey.phases).toHaveLength(3);
		expect(journey.phases[0].phase_type).toBe("prime");
		expect(journey.phases[0].session_id).toBe("abcd1234-session-1");
		expect(journey.phases[1].phase_type).toBe("plan");
		expect(journey.phases[1].session_id).toBe("efgh5678-session-2");
		expect(journey.phases[2].phase_type).toBe("build");
		expect(journey.phases[2].session_id).toBe("ijkl9012-session-3");

		// spec_ref from build phase
		expect(journey.spec_ref).toBe("specs/journey-detection.md");

		// transitions
		expect(journey.transitions).toHaveLength(2);
		expect(journey.transitions[0].from_session).toBe("abcd1234-session-1");
		expect(journey.transitions[0].to_session).toBe("efgh5678-session-2");
		expect(journey.transitions[0].git_changed).toBe(true);
		expect(journey.transitions[1].from_session).toBe("efgh5678-session-2");
		expect(journey.transitions[1].to_session).toBe("ijkl9012-session-3");

		// lifecycle
		expect(journey.lifecycle_type).toBe("prime-plan-build");

		// cumulative stats
		expect(journey.cumulative_stats.total_duration_ms).toBe(59000 + 118000 + 218000);
		expect(journey.cumulative_stats.total_events).toBe(30 + 60 + 150);
		expect(journey.cumulative_stats.total_tool_calls).toBe(10 + 25 + 80);
		expect(journey.cumulative_stats.total_failures).toBe(0 + 2 + 5);
		expect(journey.cumulative_stats.phase_count).toBe(3);
		expect(journey.cumulative_stats.retry_count).toBe(0);

		// plan_drift is left undefined
		expect(journey.plan_drift).toBeUndefined();
	});

	test("single-session journey", () => {
		const inputMap = new Map<string, SessionChainInput>([
			[
				"solo1234-session",
				makeInput({
					session_id: "solo1234-session",
					first_prompt: "do something",
					duration_ms: 60000,
					event_count: 40,
				}),
			],
		]);
		const statsMap = new Map<string, StatsResult>([
			["solo1234-session", makeStats({ tool_call_count: 15, failure_count: 1 })],
		]);

		const journey = composeJourney(["solo1234-session"], inputMap, statsMap);
		expect(journey.phases).toHaveLength(1);
		expect(journey.phases[0].phase_type).toBe("freeform");
		expect(journey.lifecycle_type).toBe("single-session");
		expect(journey.transitions).toHaveLength(0);
		expect(journey.id).toBe("solo1234");
	});

	test("handles missing input gracefully with fallback phase", () => {
		const inputMap = new Map<string, SessionChainInput>();
		const statsMap = new Map<string, StatsResult>();

		const journey = composeJourney(["unknown-id"], inputMap, statsMap);
		expect(journey.phases).toHaveLength(1);
		expect(journey.phases[0].phase_type).toBe("freeform");
		expect(journey.phases[0].source).toBe("startup");
		expect(journey.phases[0].duration_ms).toBe(0);
		expect(journey.phases[0].event_count).toBe(0);
	});

	test("source mapping: startup, clear, compact", () => {
		const inputMap = new Map<string, SessionChainInput>([
			["s1", makeInput({ session_id: "s1", source: "startup", first_prompt: "a" })],
			["s2", makeInput({ session_id: "s2", source: "clear", first_prompt: "b" })],
			["s3", makeInput({ session_id: "s3", source: "compact", first_prompt: "c" })],
		]);
		const statsMap = new Map<string, StatsResult>();

		const journey = composeJourney(["s1", "s2", "s3"], inputMap, statsMap);
		expect(journey.phases[0].source).toBe("startup");
		expect(journey.phases[1].source).toBe("clear");
		expect(journey.phases[2].source).toBe("compact");
	});

	test("prompt truncated to 200 chars in phase", () => {
		const longPrompt = "z".repeat(300);
		const inputMap = new Map<string, SessionChainInput>([
			["s1", makeInput({ session_id: "s1", first_prompt: longPrompt })],
		]);
		const statsMap = new Map<string, StatsResult>();

		const journey = composeJourney(["s1"], inputMap, statsMap);
		expect(journey.phases[0].prompt?.length).toBe(200);
	});
});

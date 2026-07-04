import { describe, expect, test } from "bun:test";
import { computeActiveDuration } from "../src/distill/active-duration";
import type { TimingGapDecision } from "../src/types";

const makeTimingGap = (overrides: Partial<TimingGapDecision> = {}): TimingGapDecision => ({
	type: "timing_gap",
	t: 1000,
	gap_ms: 60_000,
	classification: "user_idle",
	...overrides,
});

describe("computeActiveDuration", () => {
	test("returns total as active when no gaps", () => {
		const result = computeActiveDuration([], 10_000);
		expect(result.active_ms).toBe(10_000);
		expect(result.idle_ms).toBe(0);
		expect(result.pause_ms).toBe(0);
	});

	test("subtracts user_idle gaps from total", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ gap_ms: 120_000, classification: "user_idle" }),
		];

		const result = computeActiveDuration(gaps, 300_000);
		expect(result.active_ms).toBe(180_000);
		expect(result.idle_ms).toBe(120_000);
		expect(result.pause_ms).toBe(0);
	});

	test("subtracts session_pause gaps from total", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ gap_ms: 600_000, classification: "session_pause" }),
		];

		const result = computeActiveDuration(gaps, 1_000_000);
		expect(result.active_ms).toBe(400_000);
		expect(result.idle_ms).toBe(0);
		expect(result.pause_ms).toBe(600_000);
	});

	test("handles mixed gap types", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ t: 1000, gap_ms: 120_000, classification: "user_idle" }),
			makeTimingGap({ t: 2000, gap_ms: 600_000, classification: "session_pause" }),
			makeTimingGap({ t: 3000, gap_ms: 200_000, classification: "user_idle" }),
		];

		const result = computeActiveDuration(gaps, 1_500_000);
		expect(result.idle_ms).toBe(320_000);
		expect(result.pause_ms).toBe(600_000);
		expect(result.active_ms).toBe(580_000);
	});

	test("ignores agent_thinking gaps (not subtracted)", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ gap_ms: 150_000, classification: "agent_thinking" }),
		];

		const result = computeActiveDuration(gaps, 300_000);
		expect(result.active_ms).toBe(300_000);
		expect(result.idle_ms).toBe(0);
		expect(result.pause_ms).toBe(0);
	});

	test("clamps active_ms to 0 when gaps exceed total", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ gap_ms: 500_000, classification: "user_idle" }),
			makeTimingGap({ gap_ms: 700_000, classification: "session_pause" }),
		];

		const result = computeActiveDuration(gaps, 100_000);
		expect(result.active_ms).toBe(0);
		expect(result.idle_ms).toBe(500_000);
		expect(result.pause_ms).toBe(700_000);
	});

	test("handles zero total duration", () => {
		const result = computeActiveDuration([], 0);
		expect(result.active_ms).toBe(0);
		expect(result.idle_ms).toBe(0);
		expect(result.pause_ms).toBe(0);
	});

	test("handles only timing gaps (agent_thinking not subtracted)", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ t: 1000, gap_ms: 120_000, classification: "user_idle" }),
			makeTimingGap({ t: 2000, gap_ms: 60_000, classification: "agent_thinking" }),
		];

		const result = computeActiveDuration(gaps, 500_000);
		// Only user_idle subtracted; agent_thinking is not
		expect(result.idle_ms).toBe(120_000);
		expect(result.pause_ms).toBe(0);
		expect(result.active_ms).toBe(380_000);
	});

	test("multiple user_idle gaps are summed", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ t: 1000, gap_ms: 130_000, classification: "user_idle" }),
			makeTimingGap({ t: 2000, gap_ms: 200_000, classification: "user_idle" }),
			makeTimingGap({ t: 3000, gap_ms: 170_000, classification: "user_idle" }),
		];

		const result = computeActiveDuration(gaps, 1_000_000);
		expect(result.idle_ms).toBe(500_000);
		expect(result.pause_ms).toBe(0);
		expect(result.active_ms).toBe(500_000);
	});

	test("multiple session_pause gaps are summed", () => {
		const gaps: readonly TimingGapDecision[] = [
			makeTimingGap({ t: 1000, gap_ms: 700_000, classification: "session_pause" }),
			makeTimingGap({ t: 2000, gap_ms: 800_000, classification: "session_pause" }),
		];

		const result = computeActiveDuration(gaps, 2_000_000);
		expect(result.pause_ms).toBe(1_500_000);
		expect(result.idle_ms).toBe(0);
		expect(result.active_ms).toBe(500_000);
	});
});

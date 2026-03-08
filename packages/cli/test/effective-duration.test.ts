import { describe, expect, test } from "bun:test";
import { computeEffectiveDuration, IDLE_THRESHOLD_MS } from "../src/utils";

const BASE = 1_700_000_000_000;
const MIN = 60_000;
const FIVE_MIN = 300_000;
const HOUR = 3_600_000;
const TWO_HOURS = 7_200_000;

describe("computeEffectiveDuration", () => {
	test("empty array returns all zeros", () => {
		const result = computeEffectiveDuration([]);
		expect(result).toEqual({
			effective_duration_ms: 0,
			idle_gaps_ms: 0,
			effective_end_t: 0,
			wall_duration_ms: 0,
		});
	});

	test("single timestamp returns zero durations with effective_end_t set", () => {
		const result = computeEffectiveDuration([BASE]);
		expect(result).toEqual({
			effective_duration_ms: 0,
			idle_gaps_ms: 0,
			effective_end_t: BASE,
			wall_duration_ms: 0,
		});
	});

	test("no gaps above threshold → effective equals wall", () => {
		const timestamps = [BASE, BASE + MIN, BASE + 2 * MIN, BASE + 3 * MIN, BASE + 4 * MIN];
		const result = computeEffectiveDuration(timestamps);

		expect(result.wall_duration_ms).toBe(4 * MIN);
		expect(result.idle_gaps_ms).toBe(0);
		expect(result.effective_duration_ms).toBe(4 * MIN);
		expect(result.effective_end_t).toBe(BASE + 4 * MIN);
	});

	test("trailing idle tail: 5 min work then 2 hours idle", () => {
		const timestamps = [
			BASE,
			BASE + MIN,
			BASE + 2 * MIN,
			BASE + 3 * MIN,
			BASE + 4 * MIN,
			BASE + FIVE_MIN,
			BASE + FIVE_MIN + TWO_HOURS,
		];
		const result = computeEffectiveDuration(timestamps);

		expect(result.wall_duration_ms).toBe(FIVE_MIN + TWO_HOURS);
		expect(result.idle_gaps_ms).toBe(TWO_HOURS);
		expect(result.effective_duration_ms).toBe(FIVE_MIN);
		expect(result.effective_end_t).toBe(BASE + FIVE_MIN);
	});

	test("mid-session gap: events, 1 hour gap, more events", () => {
		const timestamps = [
			BASE,
			BASE + MIN,
			BASE + MIN + HOUR,
			BASE + MIN + HOUR + MIN,
		];
		const result = computeEffectiveDuration(timestamps);

		const wall = MIN + HOUR + MIN;
		expect(result.wall_duration_ms).toBe(wall);
		expect(result.idle_gaps_ms).toBe(HOUR);
		expect(result.effective_duration_ms).toBe(wall - HOUR);
	});

	test("multiple gaps: all gaps subtracted from wall", () => {
		const gap1 = HOUR;
		const gap2 = TWO_HOURS;
		const timestamps = [
			BASE,
			BASE + MIN,
			BASE + MIN + gap1,
			BASE + MIN + gap1 + MIN,
			BASE + MIN + gap1 + MIN + gap2,
			BASE + MIN + gap1 + MIN + gap2 + MIN,
		];
		const result = computeEffectiveDuration(timestamps);

		const wall = 3 * MIN + gap1 + gap2;
		expect(result.wall_duration_ms).toBe(wall);
		expect(result.idle_gaps_ms).toBe(gap1 + gap2);
		expect(result.effective_duration_ms).toBe(3 * MIN);
	});

	test("all-idle session: two events separated by more than threshold", () => {
		const timestamps = [BASE, BASE + TWO_HOURS];
		const result = computeEffectiveDuration(timestamps);

		expect(result.wall_duration_ms).toBe(TWO_HOURS);
		expect(result.idle_gaps_ms).toBe(TWO_HOURS);
		expect(result.effective_duration_ms).toBe(0);
		expect(result.effective_end_t).toBe(BASE);
	});

	test("custom threshold: smaller threshold detects more gaps", () => {
		const customThreshold = MIN; // 1 minute
		const timestamps = [
			BASE,
			BASE + 30_000,          // 30s gap (under threshold)
			BASE + 30_000 + 90_000, // 90s gap (over 60s threshold)
			BASE + 30_000 + 90_000 + 30_000,
		];
		const result = computeEffectiveDuration(timestamps, customThreshold);

		const wall = 30_000 + 90_000 + 30_000;
		expect(result.wall_duration_ms).toBe(wall);
		expect(result.idle_gaps_ms).toBe(90_000);
		expect(result.effective_duration_ms).toBe(wall - 90_000);
	});

	test("custom threshold: same timestamps with default threshold has no gaps", () => {
		const timestamps = [
			BASE,
			BASE + 30_000,
			BASE + 30_000 + 90_000,
			BASE + 30_000 + 90_000 + 30_000,
		];
		const result = computeEffectiveDuration(timestamps);

		const wall = 30_000 + 90_000 + 30_000;
		expect(result.wall_duration_ms).toBe(wall);
		expect(result.idle_gaps_ms).toBe(0);
		expect(result.effective_duration_ms).toBe(wall);
	});

	test("unsorted input produces correct results", () => {
		const timestamps = [
			BASE + FIVE_MIN + TWO_HOURS,
			BASE + 2 * MIN,
			BASE,
			BASE + FIVE_MIN,
			BASE + 4 * MIN,
			BASE + MIN,
			BASE + 3 * MIN,
		];
		const result = computeEffectiveDuration(timestamps);

		expect(result.wall_duration_ms).toBe(FIVE_MIN + TWO_HOURS);
		expect(result.idle_gaps_ms).toBe(TWO_HOURS);
		expect(result.effective_duration_ms).toBe(FIVE_MIN);
		expect(result.effective_end_t).toBe(BASE + FIVE_MIN);
	});

	test("effective_end_t: trailing idle tail sets end to last active event", () => {
		const timestamps = [
			BASE,
			BASE + MIN,
			BASE + 2 * MIN,
			BASE + 2 * MIN + TWO_HOURS,
		];
		const result = computeEffectiveDuration(timestamps);

		expect(result.effective_end_t).toBe(BASE + 2 * MIN);
	});

	test("effective_end_t: no gaps sets end to last timestamp", () => {
		const timestamps = [BASE, BASE + MIN, BASE + 2 * MIN];
		const result = computeEffectiveDuration(timestamps);

		expect(result.effective_end_t).toBe(BASE + 2 * MIN);
	});

	test("gap exactly at threshold is not counted as idle", () => {
		const timestamps = [BASE, BASE + IDLE_THRESHOLD_MS];
		const result = computeEffectiveDuration(timestamps);

		expect(result.idle_gaps_ms).toBe(0);
		expect(result.effective_duration_ms).toBe(IDLE_THRESHOLD_MS);
	});

	test("gap one ms over threshold is counted as idle", () => {
		const timestamps = [BASE, BASE + IDLE_THRESHOLD_MS + 1];
		const result = computeEffectiveDuration(timestamps);

		expect(result.idle_gaps_ms).toBe(IDLE_THRESHOLD_MS + 1);
		expect(result.effective_duration_ms).toBe(0);
	});

	test("IDLE_THRESHOLD_MS is 5 minutes", () => {
		expect(IDLE_THRESHOLD_MS).toBe(300_000);
	});
});

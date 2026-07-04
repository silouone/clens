import type { ActiveDurationResult, TimingGapDecision } from "../types";

const isUserIdle = (d: TimingGapDecision): boolean => d.classification === "user_idle";

const isSessionPause = (d: TimingGapDecision): boolean => d.classification === "session_pause";

const sumGapMs = (gaps: readonly TimingGapDecision[]): number =>
	gaps.reduce((acc, g) => acc + g.gap_ms, 0);

export const computeActiveDuration = (
	timingGaps: readonly TimingGapDecision[],
	totalDurationMs: number,
): ActiveDurationResult => {
	const idle_ms = sumGapMs(timingGaps.filter(isUserIdle));
	const pause_ms = sumGapMs(timingGaps.filter(isSessionPause));
	const active_ms = Math.max(0, totalDurationMs - idle_ms - pause_ms);

	return { active_ms, idle_ms, pause_ms };
};

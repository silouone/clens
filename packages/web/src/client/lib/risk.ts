/**
 * Client-side risk score computation.
 * Ported from clens distill/risk-score.ts — pure functions, no I/O.
 */
import type { DistilledSession, RiskLevel } from "../../shared/types";

// ── Risk level classification ────────────────────────────────────────

const computeRiskLevel = (
	backtrackCount: number,
	abandonedEditCount: number,
	totalEditCount: number,
	failureRate: number,
): RiskLevel => {
	const abandonedRatio = totalEditCount > 0 ? abandonedEditCount / totalEditCount : 0;

	if (backtrackCount >= 3 || abandonedRatio > 0.5 || failureRate > 0.3) return "high";
	if (backtrackCount >= 1 || abandonedEditCount > 0) return "medium";
	return "low";
};

// ── Public API ───────────────────────────────────────────────────────

/**
 * Compute per-file risk levels from a distilled session.
 * Returns a Map keyed by file_path for O(1) lookups.
 */
export const computeClientRiskScores = (
	session: DistilledSession,
): ReadonlyMap<string, RiskLevel> => {
	const files = session.file_map.files;
	if (files.length === 0) return new Map();

	const chains = session.edit_chains?.chains ?? [];
	const backtracks = session.backtracks;

	return new Map(
		files.map((file) => {
			const filePath = file.file_path;

			const backtrackCount = backtracks.filter(
				(b) => b.file_path === filePath,
			).length;

			const fileChains = chains.filter((c) => c.file_path === filePath);
			const abandonedEditCount = fileChains.reduce(
				(sum, c) => sum + c.abandoned_edit_ids.length,
				0,
			);
			const totalEditCount = fileChains.reduce(
				(sum, c) => sum + c.total_edits,
				0,
			);
			const totalFailures = fileChains.reduce(
				(sum, c) => sum + c.total_failures,
				0,
			);

			const failureRate = totalEditCount > 0 ? totalFailures / totalEditCount : 0;

			return [filePath, computeRiskLevel(backtrackCount, abandonedEditCount, totalEditCount, failureRate)] as const;
		}),
	);
};

/** Tailwind classes for risk level badge styling. */
export const riskBadgeClass = (level: RiskLevel): string => {
	const classes: Readonly<Record<RiskLevel, string>> = {
		low: "bg-emerald-500",
		medium: "bg-amber-500",
		high: "bg-red-500",
	};
	return classes[level];
};

import type { DistilledSession } from "../types/distill";
import type { FileRiskScore, RiskLevel } from "../types/risk";

/**
 * Compute risk level from individual risk factors.
 * - high: 3+ backtracks OR >50% abandoned edits OR failure rate >30%
 * - medium: 1-2 backtracks OR some abandoned edits
 * - low: clean — no backtracks, no abandoned edits, low failure rate
 */
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

/**
 * Compute per-file risk scores from a distilled session.
 * Pure function — no I/O.
 */
export const computeFileRiskScores = (
	distilled: DistilledSession,
): readonly FileRiskScore[] => {
	const files = distilled.file_map.files;
	if (files.length === 0) return [];

	const chains = distilled.edit_chains?.chains ?? [];
	const backtracks = distilled.backtracks;

	return files.map((file): FileRiskScore => {
		const filePath = file.file_path;

		// Count backtracks targeting this file
		const backtrackCount = backtracks.filter(
			(b) => b.file_path === filePath,
		).length;

		// Find edit chains for this file
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
		const editChainLength = fileChains.length;

		// Failure rate scoped to this file's edit chains
		const failureRate =
			totalEditCount > 0 ? totalFailures / totalEditCount : 0;

		const riskLevel = computeRiskLevel(
			backtrackCount,
			abandonedEditCount,
			totalEditCount,
			failureRate,
		);

		return {
			file_path: filePath,
			risk_level: riskLevel,
			backtrack_count: backtrackCount,
			abandoned_edit_count: abandonedEditCount,
			total_edit_count: totalEditCount,
			failure_rate: failureRate,
			edit_chain_length: editChainLength,
		};
	});
};

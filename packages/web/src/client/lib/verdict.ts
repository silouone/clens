import type { DistilledSession } from "../../shared/types";
import type { CategoryKey } from "./categories";

// ── Outcome verdict (overview-moat-refactor, Wave 0) ─────────────────
//
// PURE. Derives an honesty-preserving outcome verdict from structural signals
// only — it NEVER claims semantic success (R-D1: "derived outcome … shall not
// present derived/estimated values as exact"). The three levels and their
// honesty contract:
//
//   issues   — the session did NOT reach a clean stop (`complete === false`).
//              The strongest signal is reserved for genuinely-incomplete runs.
//   partial  — completed, but ambiguous: either notable friction (a high tool
//              failure rate) OR nothing landed on disk (no files / commits /
//              working-tree changes). "Completed" is not the same as "good".
//   success  — completed AND produced changes AND low friction. The most we can
//              honestly assert: it finished and did something. (Not "it worked".)
//
// Friction downgrades success→partial rather than firing "issues", so a long,
// productive run with many backtracks but a tiny failure rate (the rich moat
// reference) reads as success — not a false alarm.

export type VerdictLevel = "success" | "partial" | "issues";

export type Verdict = {
	readonly level: VerdictLevel;
	/** Short microcaps headline (e.g. "Completed", "Incomplete"). */
	readonly label: string;
	/** Honest one-line qualifier — deliberately hedged, never overclaiming. */
	readonly detail: string;
	/** Channel the verdict LED/label is coloured with. */
	readonly category: CategoryKey;
};

/** Tool failure rate at/above which a completed run is downgraded to "partial". */
const FRICTION_FAILURE_RATE = 0.3;

const VERDICT_CATEGORY: Readonly<Record<VerdictLevel, CategoryKey>> = {
	success: "outcome",
	partial: "cost",
	issues: "risk",
};

type VerdictInput = {
	readonly complete: boolean;
	readonly filesModified: number;
	readonly commits: number;
	readonly workingTreeChanges: number;
	readonly failureRate: number;
};

/** Pull the structural verdict inputs out of a distilled session. */
export const verdictInput = (session: DistilledSession): VerdictInput => ({
	complete: session.complete,
	filesModified: session.file_map.files.filter((f) => f.edits > 0 || f.writes > 0).length,
	commits: session.git_diff.commits.length,
	workingTreeChanges: session.git_diff.working_tree_changes?.length ?? 0,
	failureRate: session.stats.failure_rate,
});

/** PURE: derive the outcome verdict from structural inputs. */
export const deriveVerdict = (input: VerdictInput): Verdict => {
	const producedWork = input.filesModified > 0 || input.commits > 0 || input.workingTreeChanges > 0;

	const make = (level: VerdictLevel, label: string, detail: string): Verdict => ({
		level,
		label,
		detail,
		category: VERDICT_CATEGORY[level],
	});

	if (!input.complete) {
		return make("issues", "Incomplete", "Session did not reach a clean stop.");
	}
	if (input.failureRate >= FRICTION_FAILURE_RATE) {
		return make(
			"partial",
			"Completed with friction",
			`Finished, but ~${Math.round(input.failureRate * 100)}% of tool calls failed along the way.`,
		);
	}
	if (!producedWork) {
		return make("partial", "No changes landed", "Completed without modifying files or committing.");
	}
	return make("success", "Completed", "Finished and produced changes.");
};

/** Convenience: derive the verdict straight from a session. */
export const sessionVerdict = (session: DistilledSession): Verdict =>
	deriveVerdict(verdictInput(session));

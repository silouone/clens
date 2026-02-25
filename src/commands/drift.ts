import type { PlanDriftReport } from "../types";
import { bold, green, red, yellow } from "./shared";

export const renderDriftReport = (drift: PlanDriftReport): string => {
	const matched = drift.expected_files.filter((f) => drift.actual_files.includes(f));

	const lines = [
		bold(`Plan Drift: ${drift.spec_path}`),
		"",
		`  Expected:     ${drift.expected_files.length} files`,
		`  Actual:       ${drift.actual_files.length} files`,
		`  Matched:      ${matched.length} files`,
		"",
	];

	const matchedLines =
		matched.length > 0
			? [green("  Matched files:"), ...matched.map((f) => green(`    ${f}`)), ""]
			: [];

	const unexpectedLines =
		drift.unexpected_files.length > 0
			? [
					yellow("  Unexpected files (not in spec):"),
					...drift.unexpected_files.map((f) => yellow(`    + ${f}`)),
					"",
				]
			: [];

	const missingLines =
		drift.missing_files.length > 0
			? [
					red("  Missing files (in spec, not touched):"),
					...drift.missing_files.map((f) => red(`    - ${f}`)),
					"",
				]
			: [];

	return [...lines, ...matchedLines, ...unexpectedLines, ...missingLines].join("\n");
};


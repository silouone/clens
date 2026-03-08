import { describe, expect, test } from "bun:test";
import { renderDriftReport } from "../src/commands/drift";
import type { PlanDriftReport } from "../src/types";

// --- Helpers ---

const makeReport = (overrides: Partial<PlanDriftReport> = {}): PlanDriftReport => ({
	spec_path: "specs/plan.md",
	expected_files: [],
	actual_files: [],
	unexpected_files: [],
	missing_files: [],
	drift_score: 0,
	...overrides,
});

// =============================================================================
// renderDriftReport
// =============================================================================

describe("renderDriftReport", () => {
	test("zero drift shows matched files", () => {
		const report = makeReport({
			expected_files: ["src/a.ts", "src/b.ts"],
			actual_files: ["src/a.ts", "src/b.ts"],
			drift_score: 0,
		});
		const output = renderDriftReport(report);
		expect(output).toContain("Plan Drift:");
		expect(output).toContain("Matched files:");
		expect(output).toContain("src/a.ts");
		expect(output).toContain("src/b.ts");
		expect(output).not.toContain("Unexpected files");
		expect(output).not.toContain("Missing files");
	});

	test("mixed drift shows unexpected and missing sections", () => {
		const report = makeReport({
			expected_files: ["src/a.ts", "src/b.ts", "src/c.ts"],
			actual_files: ["src/a.ts", "src/d.ts"],
			unexpected_files: ["src/d.ts"],
			missing_files: ["src/b.ts", "src/c.ts"],
			drift_score: 1,
		});
		const output = renderDriftReport(report);
		expect(output).toContain("Unexpected files");
		expect(output).toContain("+ src/d.ts");
		expect(output).toContain("Missing files");
		expect(output).toContain("- src/b.ts");
		expect(output).toContain("- src/c.ts");
	});

	test("high drift shows file counts and lists", () => {
		const report = makeReport({
			expected_files: ["src/a.ts"],
			actual_files: ["src/x.ts", "src/y.ts", "src/z.ts"],
			unexpected_files: ["src/x.ts", "src/y.ts", "src/z.ts"],
			missing_files: ["src/a.ts"],
			drift_score: 1.0,
		});
		const output = renderDriftReport(report);
		expect(output).toContain("Plan Drift:");
		expect(output).toContain("Expected:     1 files");
		expect(output).toContain("Actual:       3 files");
		expect(output).toContain("Unexpected files");
		expect(output).toContain("Missing files");
	});

	test("moderate drift shows matched count", () => {
		const report = makeReport({
			expected_files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
			actual_files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/e.ts"],
			unexpected_files: ["src/e.ts"],
			missing_files: ["src/d.ts"],
			drift_score: 0.5,
		});
		const output = renderDriftReport(report);
		expect(output).toContain("Matched:      3 files");
		expect(output).toContain("Expected:     4 files");
		expect(output).toContain("Actual:       4 files");
	});

	test("spec_path is displayed", () => {
		const report = makeReport({ spec_path: "specs/my-feature.md" });
		const output = renderDriftReport(report);
		expect(output).toContain("specs/my-feature.md");
	});
});


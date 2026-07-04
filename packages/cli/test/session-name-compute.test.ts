import { describe, expect, test } from "bun:test";
import { computeSessionName, resolveDisplayName } from "../src/session/session-name";

describe("computeSessionName", () => {
	test("returns null for null/undefined/empty input", () => {
		expect(computeSessionName(null)).toBeNull();
		expect(computeSessionName(undefined)).toBeNull();
		expect(computeSessionName("")).toBeNull();
		expect(computeSessionName("    ")).toBeNull();
	});

	test("returns a plain first prompt unchanged", () => {
		expect(computeSessionName("Fix the login bug")).toBe("Fix the login bug");
	});

	test("collapses internal whitespace and trims", () => {
		expect(computeSessionName("  Fix\n\tthe   login\n bug  ")).toBe("Fix the login bug");
	});

	test("strips <system-reminder>…</system-reminder> blocks", () => {
		const prompt =
			"<system-reminder>As you answer, use this context: foo bar</system-reminder>\nFix the login bug";
		expect(computeSessionName(prompt)).toBe("Fix the login bug");
	});

	test("strips multiple system-reminder blocks including multiline", () => {
		const prompt =
			"<system-reminder>\nline one\nline two\n</system-reminder>Real request<system-reminder>trailing</system-reminder>";
		expect(computeSessionName(prompt)).toBe("Real request");
	});

	test("strips <command-name>/<command-message>/<command-args> wrappers but keeps slash text", () => {
		const prompt =
			"<command-name>/prime</command-name>\n<command-message>prime is running</command-message>\n<command-args>this project</command-args>";
		// wrappers removed, inner text collapsed
		const result = computeSessionName(prompt);
		expect(result).not.toContain("<command");
		expect(result).toContain("/prime");
	});

	test("keeps slash-command text in plain prompts (R3)", () => {
		expect(computeSessionName("/prime & explore this project")).toBe(
			"/prime & explore this project",
		);
	});

	test("truncates to <= 60 chars with ellipsis when longer", () => {
		const long = "a".repeat(80);
		const result = computeSessionName(long);
		expect(result).not.toBeNull();
		expect([...(result as string)].length).toBeLessThanOrEqual(60);
		expect((result as string).endsWith("…")).toBe(true);
	});

	test("does not truncate exactly-60-char prompts", () => {
		const exact = "b".repeat(60);
		expect(computeSessionName(exact)).toBe(exact);
	});

	test("returns null when only harness noise remains after stripping", () => {
		const prompt = "<system-reminder>only noise here</system-reminder>";
		expect(computeSessionName(prompt)).toBeNull();
	});
});

describe("resolveDisplayName", () => {
	test("prefers user label over everything (R6)", () => {
		expect(
			resolveDisplayName({
				label: "My Label",
				customTitle: "CC Title",
				computed: "computed name",
				id: "a288eefb-1234",
			}),
		).toEqual({ display_name: "My Label", name_source: "label" });
	});

	test("falls back to custom_title when no label", () => {
		expect(
			resolveDisplayName({
				label: null,
				customTitle: "CC Title",
				computed: "computed name",
				id: "a288eefb-1234",
			}),
		).toEqual({ display_name: "CC Title", name_source: "custom_title" });
	});

	test("falls back to computed when no label or custom_title", () => {
		expect(
			resolveDisplayName({
				computed: "computed name",
				id: "a288eefb-1234",
			}),
		).toEqual({ display_name: "computed name", name_source: "computed" });
	});

	test("falls back to short id (8 chars) when nothing else (R4)", () => {
		expect(
			resolveDisplayName({
				id: "a288eefb-1234-5678",
			}),
		).toEqual({ display_name: "a288eefb", name_source: "id" });
	});

	test("treats whitespace-only label as absent (R8)", () => {
		expect(
			resolveDisplayName({
				label: "   ",
				computed: "computed name",
				id: "a288eefb-1234",
			}),
		).toEqual({ display_name: "computed name", name_source: "computed" });
	});

	test("treats empty/whitespace customTitle as absent", () => {
		expect(
			resolveDisplayName({
				customTitle: "  ",
				computed: "computed name",
				id: "a288eefb-1234",
			}),
		).toEqual({ display_name: "computed name", name_source: "computed" });
	});
});

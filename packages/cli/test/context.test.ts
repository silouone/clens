import { describe, expect, test } from "bun:test";
import { enrichSessionStart } from "../src/capture/context";

describe("enrichSessionStart", () => {
	test("extracts git branch", () => {
		const ctx = enrichSessionStart({ cwd: process.cwd() });
		// Should get some branch (we're in a git repo)
		expect(ctx.git_branch).toBeTruthy();
	});

	test("extracts git commit", () => {
		const ctx = enrichSessionStart({ cwd: process.cwd() });
		expect(ctx.git_commit).toBeTruthy();
		expect(ctx.git_commit?.length).toBeGreaterThanOrEqual(7);
	});

	test("gracefully handles non-git directory", () => {
		const ctx = enrichSessionStart({ cwd: "/tmp" });
		expect(ctx.git_branch).toBeNull();
		expect(ctx.git_commit).toBeNull();
	});

	test("preserves model from input", () => {
		const ctx = enrichSessionStart({ cwd: "/tmp", model: "claude-opus-4-6" });
		expect(ctx.model).toBe("claude-opus-4-6");
	});
});

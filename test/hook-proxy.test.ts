import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delegateToUserHooks } from "../src/capture/proxy";

const TEST_DIR = "/tmp/clens-test-proxy";
const FIXTURES = `${process.cwd()}/test/fixtures/hooks`;

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.clens`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("delegateToUserHooks", () => {
	test("returns null when no delegated hooks file", async () => {
		const result = await delegateToUserHooks("PreToolUse", "{}", TEST_DIR);
		expect(result).toBeNull();
	});

	test("returns null when no hooks for event type", async () => {
		writeFileSync(
			`${TEST_DIR}/.clens/delegated-hooks.json`,
			JSON.stringify({ PostToolUse: ["echo ok"] }),
		);
		const result = await delegateToUserHooks("PreToolUse", "{}", TEST_DIR);
		expect(result).toBeNull();
	});

	test("passes through allow hook output", async () => {
		writeFileSync(
			`${TEST_DIR}/.clens/delegated-hooks.json`,
			JSON.stringify({ PreToolUse: [`bash ${FIXTURES}/allow.sh`] }),
		);
		const result = await delegateToUserHooks("PreToolUse", "{}", TEST_DIR);
		expect(result?.hookSpecificOutput?.test).toBe("allowed");
	});

	test("propagates deny decision", async () => {
		writeFileSync(
			`${TEST_DIR}/.clens/delegated-hooks.json`,
			JSON.stringify({ PreToolUse: [`bash ${FIXTURES}/deny.sh`] }),
		);
		const result = await delegateToUserHooks("PreToolUse", "{}", TEST_DIR);
		expect(result?.permissionDecision).toBe("deny");
	});

	test("deny wins over allow", async () => {
		writeFileSync(
			`${TEST_DIR}/.clens/delegated-hooks.json`,
			JSON.stringify({ PreToolUse: [`bash ${FIXTURES}/allow.sh`, `bash ${FIXTURES}/deny.sh`] }),
		);
		const result = await delegateToUserHooks("PreToolUse", "{}", TEST_DIR);
		expect(result?.permissionDecision).toBe("deny");
	});

	test("handles crashing hook gracefully", async () => {
		writeFileSync(
			`${TEST_DIR}/.clens/delegated-hooks.json`,
			JSON.stringify({ PreToolUse: [`bash ${FIXTURES}/crash.sh`] }),
		);
		await delegateToUserHooks("PreToolUse", "{}", TEST_DIR);
		// Should not throw, should log error
		expect(existsSync(`${TEST_DIR}/.clens/errors.log`)).toBe(true);
	});

	test("handles malformed output gracefully", async () => {
		writeFileSync(
			`${TEST_DIR}/.clens/delegated-hooks.json`,
			JSON.stringify({ PreToolUse: [`bash ${FIXTURES}/malformed.sh`] }),
		);
		const result = await delegateToUserHooks("PreToolUse", "{}", TEST_DIR);
		expect(result).toBeNull();
	});
});

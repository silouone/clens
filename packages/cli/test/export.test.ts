import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { exportSession } from "../src/session/export";
import type { StoredEvent } from "../src/types";

const TEST_DIR = "/tmp/clens-test-export";

const makeStoredEvent = (
	overrides: Partial<StoredEvent> & { event: StoredEvent["event"] },
): StoredEvent => ({
	t: Date.now(),
	sid: "test",
	data: {},
	...overrides,
});

const writeSession = (sessionId: string, events: readonly StoredEvent[]) => {
	const content = events.map((e) => JSON.stringify(e)).join("\n");
	writeFileSync(`${TEST_DIR}/.clens/sessions/${sessionId}.jsonl`, `${content}\n`);
};

const tarList = (archivePath: string): readonly string[] => {
	const result = Bun.spawnSync(["tar", "-tzf", archivePath]);
	return result.stdout.toString().trim().split("\n").filter(Boolean);
};

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(`${TEST_DIR}/.clens/sessions`, { recursive: true });
	mkdirSync(`${TEST_DIR}/.clens/distilled`, { recursive: true });
	mkdirSync(`${TEST_DIR}/.clens/exports`, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("exportSession", () => {
	test("creates tar.gz archive in .clens/exports/", async () => {
		const events = [
			makeStoredEvent({
				t: 1000,
				sid: "test-sess",
				event: "SessionStart",
				data: {},
				context: {
					agent_type: "main",
					project_dir: TEST_DIR,
					cwd: TEST_DIR,
					git_branch: null,
					git_remote: null,
					git_commit: null,
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: null,
				},
			}),
			makeStoredEvent({ t: 5000, sid: "test-sess", event: "SessionEnd", data: {} }),
		] as const;
		writeSession("test-sess", events);

		const archivePath = await exportSession("test-sess", TEST_DIR);
		expect(existsSync(archivePath)).toBe(true);
		expect(archivePath).toContain(".clens/exports/");
		expect(archivePath).toEndWith(".tar.gz");
	});

	test("archive name follows pattern session-{id8}-{date}.tar.gz", async () => {
		const events = [
			makeStoredEvent({ t: 1000, sid: "abcd1234-full-uuid", event: "SessionStart", data: {} }),
			makeStoredEvent({ t: 5000, sid: "abcd1234-full-uuid", event: "SessionEnd", data: {} }),
		] as const;
		writeSession("abcd1234-full-uuid", events);

		const archivePath = await exportSession("abcd1234-full-uuid", TEST_DIR);
		const filename = archivePath.split("/").pop() ?? "";
		expect(filename).toMatch(/^session-abcd1234-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
	});

	test("archive contains manifest.json and session.jsonl", async () => {
		const events = [
			makeStoredEvent({ t: 1000, sid: "contents-test", event: "SessionStart", data: {} }),
			makeStoredEvent({ t: 5000, sid: "contents-test", event: "SessionEnd", data: {} }),
		] as const;
		writeSession("contents-test", events);

		const archivePath = await exportSession("contents-test", TEST_DIR);
		const files = tarList(archivePath);
		const hasManifest = files.some((f) => f.includes("manifest.json"));
		const hasSession = files.some((f) => f.includes("session.jsonl"));
		expect(hasManifest).toBe(true);
		expect(hasSession).toBe(true);
	});

	test("includes distilled.json when available", async () => {
		const events = [
			makeStoredEvent({ t: 1000, sid: "distilled-test", event: "SessionStart", data: {} }),
			makeStoredEvent({ t: 5000, sid: "distilled-test", event: "SessionEnd", data: {} }),
		] as const;
		writeSession("distilled-test", events);
		writeFileSync(
			`${TEST_DIR}/.clens/distilled/distilled-test.json`,
			JSON.stringify({ session_id: "distilled-test", stats: {} }),
		);

		const archivePath = await exportSession("distilled-test", TEST_DIR);
		const files = tarList(archivePath);
		const hasDistilled = files.some((f) => f.includes("distilled.json"));
		expect(hasDistilled).toBe(true);
	});

	test("manifest has correct session metadata", async () => {
		const events = [
			makeStoredEvent({
				t: 1000,
				sid: "meta-test",
				event: "SessionStart",
				data: {},
				context: {
					agent_type: "main",
					project_dir: TEST_DIR,
					cwd: TEST_DIR,
					git_branch: "feature/x",
					git_remote: null,
					git_commit: "abc123",
					git_worktree: null,
					team_name: null,
					task_list_dir: null,
					claude_entrypoint: null,
					model: null,
				},
			}),
			makeStoredEvent({ t: 5000, sid: "meta-test", event: "SessionEnd", data: {} }),
		] as const;
		writeSession("meta-test", events);

		const archivePath = await exportSession("meta-test", TEST_DIR);

		// Extract manifest to read it
		const extractDir = "/tmp/clens-export-extract";
		rmSync(extractDir, { recursive: true, force: true });
		mkdirSync(extractDir, { recursive: true });
		Bun.spawnSync(["tar", "-xzf", archivePath, "-C", extractDir]);

		const manifestFiles = Bun.spawnSync(["find", extractDir, "-name", "manifest.json"]);
		const manifestPath = manifestFiles.stdout.toString().trim();
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

		expect(manifest.session_id).toBe("meta-test");
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.agents).toBeArray();
		expect(manifest.agents[0].agent_type).toBe("main");
		expect(manifest.git_branch).toBe("feature/x");
		expect(manifest.git_commit).toBe("abc123");

		rmSync(extractDir, { recursive: true, force: true });
	});

	test("multi-agent: creates archive with agents/ subdirectory", async () => {
		const parentSid = "parent-ma-test";
		const childSid = "child-ma-test";

		const parentEvents = [
			makeStoredEvent({ t: 1000, sid: parentSid, event: "SessionStart", data: {} }),
			makeStoredEvent({ t: 10000, sid: parentSid, event: "SessionEnd", data: {} }),
		] as const;
		writeSession(parentSid, parentEvents);

		const childEvents = [
			makeStoredEvent({ t: 2000, sid: childSid, event: "SessionStart", data: {} }),
			makeStoredEvent({ t: 8000, sid: childSid, event: "SessionEnd", data: {} }),
		] as const;
		writeSession(childSid, childEvents);

		// Write _links.jsonl with spawn event
		const spawnLink = JSON.stringify({
			t: 1500,
			type: "spawn",
			parent_session: parentSid,
			agent_id: childSid,
			agent_type: "builder",
			agent_name: "builder-1",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawnLink}\n`);

		const archivePath = await exportSession(parentSid, TEST_DIR);
		const files = tarList(archivePath);
		const hasAgentsDir = files.some((f) => f.includes("agents/"));
		expect(hasAgentsDir).toBe(true);
		const hasParentInAgents = files.some((f) => f.includes(`agents/${parentSid}.jsonl`));
		const hasChildInAgents = files.some((f) => f.includes(`agents/${childSid}.jsonl`));
		expect(hasParentInAgents).toBe(true);
		expect(hasChildInAgents).toBe(true);
	});

	test("multi-agent: includes links.jsonl in archive", async () => {
		const parentSid = "parent-links-test";
		const childSid = "child-links-test";

		const parentEvents = [
			makeStoredEvent({ t: 1000, sid: parentSid, event: "SessionStart", data: {} }),
			makeStoredEvent({ t: 10000, sid: parentSid, event: "SessionEnd", data: {} }),
		] as const;
		writeSession(parentSid, parentEvents);

		const childEvents = [
			makeStoredEvent({ t: 2000, sid: childSid, event: "SessionStart", data: {} }),
			makeStoredEvent({ t: 8000, sid: childSid, event: "SessionEnd", data: {} }),
		] as const;
		writeSession(childSid, childEvents);

		const spawnLink = JSON.stringify({
			t: 1500,
			type: "spawn",
			parent_session: parentSid,
			agent_id: childSid,
			agent_type: "builder",
		});
		writeFileSync(`${TEST_DIR}/.clens/sessions/_links.jsonl`, `${spawnLink}\n`);

		const archivePath = await exportSession(parentSid, TEST_DIR);
		const files = tarList(archivePath);
		const hasLinks = files.some((f) => f.includes("links.jsonl"));
		expect(hasLinks).toBe(true);
	});

	test("throws on missing session file", async () => {
		await expect(exportSession("nonexistent-session", TEST_DIR)).rejects.toThrow("not found");
	});

	test("throws on empty session", async () => {
		writeFileSync(`${TEST_DIR}/.clens/sessions/empty-sess.jsonl`, "\n");
		await expect(exportSession("empty-sess", TEST_DIR)).rejects.toThrow("no events");
	});
});

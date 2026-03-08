import { describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTranscript, resolveTranscriptPath } from "../src/session/transcript";
import type { StoredEvent } from "../src/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures/transcripts/simple-session.jsonl");

describe("readTranscript", () => {
	test("parses valid transcript JSONL", () => {
		const entries = readTranscript(FIXTURE_PATH);
		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			expect(["user", "assistant"]).toContain(entry.type);
		}
	});

	test("filters out progress and file-history-snapshot entries", () => {
		const entries = readTranscript(FIXTURE_PATH);
		const hasProgress = entries.some(
			(e) => (e as unknown as Record<string, unknown>).type === "progress",
		);
		expect(hasProgress).toBe(false);
	});

	test("returns empty array for missing file", () => {
		const entries = readTranscript("/nonexistent/path.jsonl");
		expect(entries).toEqual([]);
	});

	test("returns empty array for malformed JSONL", () => {
		const tmpPath = "/tmp/test-malformed-transcript.jsonl";
		writeFileSync(tmpPath, "not json\n{invalid\n");
		const entries = readTranscript(tmpPath);
		expect(entries).toEqual([]);
		unlinkSync(tmpPath);
	});

	test("entries are sorted by timestamp", () => {
		const entries = readTranscript(FIXTURE_PATH);
		for (let i = 1; i < entries.length; i++) {
			const prev = new Date(entries[i - 1].timestamp).getTime();
			const curr = new Date(entries[i].timestamp).getTime();
			expect(curr).toBeGreaterThanOrEqual(prev);
		}
	});
});

describe("resolveTranscriptPath", () => {
	test("finds transcript_path from events", () => {
		const events: StoredEvent[] = [
			{ t: 1000, event: "SessionStart", sid: "test", data: {} },
			{
				t: 2000,
				event: "PreToolUse",
				sid: "test",
				data: { transcript_path: "/path/to/transcript.jsonl", tool_name: "Bash" },
			},
		];
		expect(resolveTranscriptPath(events)).toBe("/path/to/transcript.jsonl");
	});

	test("returns null when no transcript_path in events", () => {
		const events: StoredEvent[] = [{ t: 1000, event: "SessionStart", sid: "test", data: {} }];
		expect(resolveTranscriptPath(events)).toBeNull();
	});
});

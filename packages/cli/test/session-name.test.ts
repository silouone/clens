import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSessionName } from "../src/session/transcript";

const TMP_DIR = join(import.meta.dir, "tmp-session-name");

const setup = () => {
	try { rmSync(TMP_DIR, { recursive: true }); } catch { /* ignore */ }
	mkdirSync(TMP_DIR, { recursive: true });
};

const teardown = () => {
	try { rmSync(TMP_DIR, { recursive: true }); } catch { /* ignore */ }
};

describe("readSessionName", () => {
	test("returns null for non-existent file", () => {
		expect(readSessionName("/nonexistent/path.jsonl")).toBeNull();
	});

	test("returns null for empty file", () => {
		setup();
		const p = join(TMP_DIR, "empty.jsonl");
		writeFileSync(p, "");
		expect(readSessionName(p)).toBeNull();
		teardown();
	});

	test("returns null for file with no custom-title events", () => {
		setup();
		const p = join(TMP_DIR, "no-title.jsonl");
		writeFileSync(
			p,
			[
				JSON.stringify({ type: "user", uuid: "u1", timestamp: "2025-01-01T00:00:00Z", message: { role: "user", content: "hello" } }),
				JSON.stringify({ type: "assistant", uuid: "a1", timestamp: "2025-01-01T00:01:00Z", message: { role: "assistant", content: "hi" } }),
			].join("\n"),
		);
		expect(readSessionName(p)).toBeNull();
		teardown();
	});

	test("extracts customTitle from single custom-title event", () => {
		setup();
		const p = join(TMP_DIR, "single.jsonl");
		writeFileSync(
			p,
			[
				JSON.stringify({ type: "user", uuid: "u1", timestamp: "2025-01-01T00:00:00Z", message: { role: "user", content: "hello" } }),
				JSON.stringify({ type: "custom-title", customTitle: "\"My Session\"", sessionId: "abc123" }),
			].join("\n"),
		);
		expect(readSessionName(p)).toBe("My Session");
		teardown();
	});

	test("returns LAST customTitle when multiple rename events exist", () => {
		setup();
		const p = join(TMP_DIR, "multi.jsonl");
		writeFileSync(
			p,
			[
				JSON.stringify({ type: "custom-title", customTitle: "\"First Name\"", sessionId: "abc123" }),
				JSON.stringify({ type: "user", uuid: "u1", timestamp: "2025-01-01T00:00:00Z", message: { role: "user", content: "hello" } }),
				JSON.stringify({ type: "custom-title", customTitle: "\"Second Name\"", sessionId: "abc123" }),
				JSON.stringify({ type: "assistant", uuid: "a1", timestamp: "2025-01-01T00:01:00Z", message: { role: "assistant", content: "hi" } }),
				JSON.stringify({ type: "custom-title", customTitle: "\"Final Name\"", sessionId: "abc123" }),
			].join("\n"),
		);
		expect(readSessionName(p)).toBe("Final Name");
		teardown();
	});

	test("strips escaped quotes from value", () => {
		setup();
		const p = join(TMP_DIR, "quotes.jsonl");
		writeFileSync(
			p,
			JSON.stringify({ type: "custom-title", customTitle: "\"EDITS GIT DIFF\"", sessionId: "abc123" }),
		);
		expect(readSessionName(p)).toBe("EDITS GIT DIFF");
		teardown();
	});

	test("handles &amp; HTML entities in value", () => {
		setup();
		const p = join(TMP_DIR, "ampersand.jsonl");
		writeFileSync(
			p,
			JSON.stringify({ type: "custom-title", customTitle: "\"EDITS GIT DIFF &amp; agent attribution\"", sessionId: "abc123" }),
		);
		expect(readSessionName(p)).toBe("EDITS GIT DIFF & agent attribution");
		teardown();
	});

	test("handles malformed JSON lines gracefully", () => {
		setup();
		const p = join(TMP_DIR, "malformed.jsonl");
		writeFileSync(
			p,
			[
				"not valid json",
				"{ broken",
				JSON.stringify({ type: "custom-title", customTitle: "\"Good Title\"", sessionId: "abc123" }),
				"another bad line",
			].join("\n"),
		);
		expect(readSessionName(p)).toBe("Good Title");
		teardown();
	});

	test("works with real transcript format (mixed event types)", () => {
		setup();
		const p = join(TMP_DIR, "real.jsonl");
		writeFileSync(
			p,
			[
				JSON.stringify({ type: "user", uuid: "u1", timestamp: "2025-01-01T00:00:00Z", message: { role: "user", content: "implement feature" } }),
				JSON.stringify({ type: "assistant", uuid: "a1", timestamp: "2025-01-01T00:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "working..." }] } }),
				JSON.stringify({ type: "progress", timestamp: "2025-01-01T00:00:06Z" }),
				JSON.stringify({ type: "custom-title", customTitle: "\"Feature Implementation\"", sessionId: "2002ebf7-e611-4ac9-ad20-be9714f5e697" }),
				JSON.stringify({ type: "assistant", uuid: "a2", timestamp: "2025-01-01T00:00:10Z", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
			].join("\n"),
		);
		expect(readSessionName(p)).toBe("Feature Implementation");
		teardown();
	});

	test("returns value without quotes when no surrounding quotes present", () => {
		setup();
		const p = join(TMP_DIR, "noquotes.jsonl");
		writeFileSync(
			p,
			JSON.stringify({ type: "custom-title", customTitle: "Plain Title", sessionId: "abc123" }),
		);
		expect(readSessionName(p)).toBe("Plain Title");
		teardown();
	});
});

import { existsSync, readFileSync } from "node:fs";
import type { StoredEvent, TranscriptEntry } from "../types";

const isTranscriptEntry = (value: unknown): value is TranscriptEntry => {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.type === "string" &&
		typeof obj.timestamp === "string" &&
		typeof obj.uuid === "string"
	);
};

export const readTranscript = (transcriptPath: string): TranscriptEntry[] => {
	try {
		if (!existsSync(transcriptPath)) return [];
		const content = readFileSync(transcriptPath, "utf-8").trim();
		if (!content) return [];
		const entries = content
			.split("\n")
			.filter(Boolean)
			.flatMap((line): TranscriptEntry[] => {
				try {
					const parsed: unknown = JSON.parse(line);
					if (!isTranscriptEntry(parsed)) return [];
					return parsed.type === "user" || parsed.type === "assistant" ? [parsed] : [];
				} catch {
					return [];
				}
			});
		return [...entries].sort(
			(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);
	} catch {
		return [];
	}
};

export const resolveTranscriptPath = (events: StoredEvent[]): string | null => {
	const match = events.find((e) => e.data?.transcript_path);
	return (match?.data?.transcript_path as string) ?? null;
};

/** Type guard for custom-title transcript entries. */
const isCustomTitleEntry = (value: unknown): value is { readonly type: "custom-title"; readonly customTitle: string } => {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return obj.type === "custom-title" && typeof obj.customTitle === "string";
};

/** Strip surrounding escaped quotes from a customTitle value.
 *  e.g. `"\"EDITS GIT DIFF\""` -> `EDITS GIT DIFF` */
const stripEscapedQuotes = (raw: string): string => {
	const trimmed = raw.trim();
	const withoutOuter = trimmed.startsWith('"') && trimmed.endsWith('"')
		? trimmed.slice(1, -1)
		: trimmed;
	return withoutOuter.replace(/&amp;/g, "&");
};

/**
 * Read a Claude Code transcript JSONL and extract the session name.
 * Scans for `{"type":"custom-title","customTitle":"..."}` lines and returns the
 * LAST customTitle found (the user may rename multiple times). Strips surrounding
 * escaped quotes from the value.
 * Returns `null` if no custom-title event exists or the file is missing/unreadable.
 */
export const readSessionName = (transcriptPath: string): string | null => {
	try {
		if (!existsSync(transcriptPath)) return null;
		const content = readFileSync(transcriptPath, "utf-8").trim();
		if (!content) return null;
		const lastTitle = content
			.split("\n")
			.filter(Boolean)
			.reduce<string | null>((acc, line) => {
				try {
					const parsed: unknown = JSON.parse(line);
					return isCustomTitleEntry(parsed) ? stripEscapedQuotes(parsed.customTitle) : acc;
				} catch {
					return acc;
				}
			}, null);
		return lastTitle;
	} catch {
		return null;
	}
};

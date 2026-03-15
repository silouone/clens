// I/O layer for synthetic link scanning — reads session files to extract timestamp metadata.
// Used by distill/synthetic-links.ts via injection to maintain layer separation.

import { readdirSync, readFileSync } from "node:fs";

/** Metadata from scanning a session file (first + last line only). */
export interface SessionFileInfo {
	readonly sessionId: string;
	readonly startT: number;
	readonly endT: number | undefined;
}

/**
 * Parse first and last line of a session file to extract timestamp metadata.
 * Returns undefined if the file cannot be parsed or doesn't start with SessionStart.
 */
const parseSessionFile = (
	filePath: string,
	timeRange: { readonly minT: number; readonly maxT: number },
): { readonly startT: number; readonly endT: number | undefined } | undefined => {
	try {
		const content = readFileSync(filePath, "utf-8");
		const firstNewline = content.indexOf("\n");
		const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);

		const firstEvent: unknown = JSON.parse(firstLine);
		if (!firstEvent || typeof firstEvent !== "object" || !("event" in firstEvent) || !("t" in firstEvent)) return undefined;
		const { event, t: rawT } = firstEvent as { event: unknown; t: unknown };
		if (event !== "SessionStart" || typeof rawT !== "number") return undefined;

		const startT = rawT;

		// Filter: session must have started within parent's time range
		if (startT < timeRange.minT || startT > timeRange.maxT) return undefined;

		// Read last line for endT
		const trimmed = content.trimEnd();
		const lastNewline = trimmed.lastIndexOf("\n");
		const lastLine = lastNewline === -1 ? trimmed : trimmed.slice(lastNewline + 1);
		const lastEvent: unknown = JSON.parse(lastLine);
		const endT = lastEvent && typeof lastEvent === "object" && "t" in lastEvent && typeof (lastEvent as { t: unknown }).t === "number"
			? (lastEvent as { t: number }).t
			: undefined;

		return { startT, endT };
	} catch {
		return undefined;
	}
};

/**
 * Scan session files in .clens/sessions/ for timestamp metadata.
 * Reads only the first and last lines of each file for performance.
 * Filters to sessions that started within the parent session's time range.
 */
export const scanSessionFiles = (
	projectDir: string,
	parentSessionId: string,
	linkedSessionIds: ReadonlySet<string>,
	timeRange: { readonly minT: number; readonly maxT: number },
): readonly SessionFileInfo[] => {
	const sessionsDir = `${projectDir}/.clens/sessions`;

	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter(
				(f) => f.endsWith(".jsonl") && f !== "_links.jsonl",
			);
		} catch {
			return [];
		}
	})();

	return files.flatMap((file): readonly SessionFileInfo[] => {
		const sessionId = file.replace(".jsonl", "");

		// Skip parent session and already-linked sessions
		if (sessionId === parentSessionId || linkedSessionIds.has(sessionId)) return [];

		const parsed = parseSessionFile(`${sessionsDir}/${file}`, timeRange);
		if (!parsed) return [];

		return [{ sessionId, startT: parsed.startT, endT: parsed.endT }];
	});
};

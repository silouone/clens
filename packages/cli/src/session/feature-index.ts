import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { detectFeatureFlags } from "../distill/feature-usage";
import type { FeatureFlag } from "../types";

// ── Feature index ───────────────────────────────────────────────────
//
// Detecting loop/goal/workflow usage requires scanning full session JSONL
// files (signatures live in tool events anywhere in the file, not the
// first/last lines the lightweight listing reads). Session files are
// append-only, so a (mtime, size)-keyed cache makes the scan a one-time
// cost per file; subsequent listings only stat.

const INDEX_VERSION = 1;

interface FeatureIndexEntry {
	readonly flags: readonly FeatureFlag[];
	readonly mtime_ms: number;
	readonly size: number;
}

interface FeatureIndexFile {
	readonly version: number;
	readonly entries: Readonly<Record<string, FeatureIndexEntry>>;
}

const indexPath = (projectDir: string): string => `${projectDir}/.clens/feature-index.json`;

const VALID_FLAGS: readonly string[] = ["loop", "goal", "workflow"];

const sanitizeEntry = (value: unknown): FeatureIndexEntry | undefined => {
	if (!value || typeof value !== "object") return undefined;
	const obj = value as Record<string, unknown>;
	if (typeof obj.mtime_ms !== "number" || typeof obj.size !== "number") return undefined;
	if (!Array.isArray(obj.flags) || !obj.flags.every((f) => VALID_FLAGS.includes(f as string))) return undefined;
	return { flags: obj.flags as readonly FeatureFlag[], mtime_ms: obj.mtime_ms, size: obj.size };
};

const readIndexFile = (projectDir: string): Readonly<Record<string, FeatureIndexEntry>> => {
	const path = indexPath(projectDir);
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		const file = parsed as FeatureIndexFile;
		if (file.version !== INDEX_VERSION || !file.entries || typeof file.entries !== "object") return {};
		return Object.fromEntries(
			Object.entries(file.entries).flatMap(([sid, entry]) => {
				const clean = sanitizeEntry(entry);
				return clean ? [[sid, clean] as const] : [];
			}),
		);
	} catch {
		return {};
	}
};

const writeIndexFile = (projectDir: string, entries: Readonly<Record<string, FeatureIndexEntry>>): void => {
	try {
		const file: FeatureIndexFile = { version: INDEX_VERSION, entries };
		writeFileSync(indexPath(projectDir), JSON.stringify(file));
	} catch {
		// Cache write failure is non-fatal — next call re-scans
	}
};

/**
 * Feature flags for every session in a project, keyed by session ID.
 * Cache hits cost one stat per file; misses scan the raw JSONL once.
 */
export const readFeatureIndex = (projectDir: string): ReadonlyMap<string, readonly FeatureFlag[]> => {
	const sessionsDir = `${projectDir}/.clens/sessions`;

	const files = (() => {
		try {
			return readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl") && f !== "_links.jsonl");
		} catch {
			return [];
		}
	})();

	if (files.length === 0) return new Map();

	const cached = readIndexFile(projectDir);
	let dirty = false;

	const entries = files.flatMap((file): readonly (readonly [string, FeatureIndexEntry])[] => {
		const sessionId = file.replace(".jsonl", "");
		const filePath = `${sessionsDir}/${file}`;
		try {
			const stat = statSync(filePath);
			const hit = cached[sessionId];
			if (hit && hit.mtime_ms === stat.mtimeMs && hit.size === stat.size) {
				return [[sessionId, hit]];
			}
			const flags = detectFeatureFlags(readFileSync(filePath, "utf-8"));
			dirty = true;
			return [[sessionId, { flags, mtime_ms: stat.mtimeMs, size: stat.size }]];
		} catch {
			return [];
		}
	});

	if (dirty) writeIndexFile(projectDir, Object.fromEntries(entries));

	return new Map(entries.map(([sid, entry]) => [sid, entry.flags]));
};

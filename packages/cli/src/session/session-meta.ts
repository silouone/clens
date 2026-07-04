import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ColorName, SessionMeta } from "../types";
import { isColorName } from "../types";

/** Sidecar map: session id → cLens-owned metadata. */
export type SessionMetaMap = Readonly<Record<string, SessionMeta>>;

/** Path to the cLens session-metadata sidecar for a project. */
export const sessionMetaPath = (dir: string): string => `${dir}/.clens/session-meta.json`;

/** Coerce one raw sidecar entry into a clean SessionMeta, or null if unusable. */
const parseEntry = (raw: unknown): SessionMeta | null => {
	if (typeof raw !== "object" || raw === null) return null;
	const obj = raw as Record<string, unknown>;
	const label =
		typeof obj.label === "string" && obj.label.trim().length > 0 ? obj.label : undefined;
	// Drop invalid colors silently (graceful degradation); "none" is normalized away.
	const color =
		isColorName(obj.color) && obj.color !== "none" ? (obj.color as ColorName) : undefined;
	const updated_at = typeof obj.updated_at === "number" ? obj.updated_at : 0;
	return {
		...(label ? { label } : {}),
		...(color ? { color } : {}),
		updated_at,
	};
};

/**
 * Read the session-metadata sidecar. A missing or malformed file degrades
 * gracefully to `{}` and never throws (R15). Individual malformed entries are
 * dropped rather than failing the whole read.
 */
export const readSessionMeta = (dir: string): SessionMetaMap => {
	const path = sessionMetaPath(dir);
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, SessionMeta>>(
			(acc, [id, rawEntry]) => {
				const entry = parseEntry(rawEntry);
				return entry ? { ...acc, [id]: entry } : acc;
			},
			{},
		);
	} catch {
		return {};
	}
};

/**
 * Write the sidecar atomically via temp-file + rename (R15) so a concurrent
 * reader never observes a torn file. Creates the `.clens` directory if needed.
 */
export const writeSessionMeta = (dir: string, map: SessionMetaMap): void => {
	const clensDir = `${dir}/.clens`;
	if (!existsSync(clensDir)) mkdirSync(clensDir, { recursive: true });
	const path = sessionMetaPath(dir);
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, JSON.stringify(map, null, 2));
	renameSync(tmp, path);
};

/** Patch applied to a single session's sidecar entry. */
export interface SessionMetaPatch {
	readonly label?: string | null;
	readonly color?: ColorName | null;
}

/** A label is "clear" when null, empty, or whitespace-only (R7/R8). */
const isClearLabel = (label: string | null | undefined): boolean =>
	label === null || (typeof label === "string" && label.trim().length === 0);

/**
 * Set or clear a single session's label and/or color, persisting atomically.
 *  - `label`: null/empty/whitespace clears it (R7/R8); otherwise stored verbatim.
 *  - `color`: null or `"none"` clears the flag (R13); any other palette value sets it.
 *  - An invalid color value is rejected and existing metadata is left unchanged (R14).
 * When the resulting entry holds no label and no color it is removed entirely.
 */
export const setSessionMeta = (
	dir: string,
	id: string,
	patch: SessionMetaPatch,
): SessionMetaMap => {
	// Validate color first so an invalid value never mutates state (R14).
	const colorTouched = "color" in patch;
	if (colorTouched && patch.color !== null && !isColorName(patch.color)) {
		throw new Error(
			`Invalid color "${String(patch.color)}". Valid: none, red, amber, green, blue, violet, gray.`,
		);
	}

	const current = readSessionMeta(dir);
	const existing = current[id];

	const labelTouched = "label" in patch;
	const nextLabel = labelTouched
		? isClearLabel(patch.label)
			? undefined
			: (patch.label as string)
		: existing?.label;

	const nextColor = colorTouched
		? patch.color === null || patch.color === "none"
			? undefined
			: patch.color
		: existing?.color;

	const { [id]: _omit, ...rest } = current;

	// Drop the entry entirely when nothing remains.
	if (nextLabel === undefined && nextColor === undefined) {
		writeSessionMeta(dir, rest);
		return rest;
	}

	const entry: SessionMeta = {
		...(nextLabel !== undefined ? { label: nextLabel } : {}),
		...(nextColor !== undefined ? { color: nextColor } : {}),
		updated_at: Date.now(),
	};
	const next: SessionMetaMap = { ...rest, [id]: entry };
	writeSessionMeta(dir, next);
	return next;
};

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ClaudeMdInEffect, SettingsScope, SettingsSnapshot } from "../types";

/**
 * Tier-B / tier-C settings resolver (CFG-3). Snapshots the resolved `settings.json`
 * config (output style, statusline, plugins, default permission mode, configured
 * hook names) across scopes. Designed to run ONCE inside `enrichSessionStart`
 * (SessionStart / InstructionsLoaded+session_start) — NEVER on the hot path.
 *
 * Honesty + safety contract:
 *  - Every read is wrapped so a missing/malformed file resolves to `undefined`,
 *    never throwing (the capture layer must never crash — `hook.ts` budget/contract).
 *  - Values are merged with higher scope winning per key; provenance scope is
 *    recorded for `output_style`.
 *  - Only known-safe, low-noise keys are lifted (no command bodies, no PII paths —
 *    statusline keeps a basename only).
 */

const homeDir = (): string => process.env.HOME || process.env.USERPROFILE || "";

/** Scopes in lowest→highest precedence order, so a later read overrides earlier keys. */
const settingsFilesLowToHigh = (projectDir: string): ReadonlyArray<{
	readonly scope: SettingsScope;
	readonly path: string;
}> => {
	const home = homeDir();
	const managed = process.platform === "darwin"
		? "/Library/Application Support/ClaudeCode/managed-settings.json"
		: "/etc/claude-code/managed-settings.json";
	return [
		{ scope: "user", path: home ? join(home, ".claude", "settings.json") : "" },
		{ scope: "project", path: join(projectDir, ".claude", "settings.json") },
		{ scope: "local", path: join(projectDir, ".claude", "settings.local.json") },
		{ scope: "managed", path: managed },
	];
};

/** Read + parse a JSON settings file; any failure (missing/malformed) ⇒ undefined. */
const readSettingsFile = (path: string): Record<string, unknown> | undefined => {
	if (!path) return undefined;
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
};

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

/** Plugin keys whose value is exactly `true` (e.g. `superwhisper@superwhisper`). */
const enabledPluginKeys = (raw: unknown): readonly string[] | undefined => {
	if (!raw || typeof raw !== "object") return undefined;
	const keys = Object.entries(raw as Record<string, unknown>)
		.filter(([, v]) => v === true)
		.map(([k]) => k)
		.sort();
	return keys.length > 0 ? keys : undefined;
};

/** Configured hook event names (names only — never the command bodies; privacy + size). */
const hookEventNames = (raw: unknown): readonly string[] | undefined => {
	if (!raw || typeof raw !== "object") return undefined;
	const names = Object.keys(raw as Record<string, unknown>).sort();
	return names.length > 0 ? names : undefined;
};

const statusLineOf = (
	raw: unknown,
): { readonly type: string; readonly command_name?: string } | undefined => {
	if (!raw || typeof raw !== "object") return undefined;
	const obj = raw as Record<string, unknown>;
	const type = asString(obj.type);
	if (!type) return undefined;
	const command = asString(obj.command);
	return command ? { type, command_name: basename(command) } : { type };
};

const permissionsDefaultMode = (raw: unknown): string | undefined => {
	if (!raw || typeof raw !== "object") return undefined;
	return asString((raw as Record<string, unknown>).defaultMode);
};

/**
 * Resolve a settings snapshot for a project. Returns `undefined` only if no scope
 * yielded a single usable field (so the snapshot is never an empty husk). Never throws.
 *
 * @param source labels provenance: `"session_start"` (tier B, point-in-time) vs
 *   `"current"` (tier C distill-time fallback, may have drifted).
 */
export const resolveSettingsSnapshot = (
	projectDir: string,
	source: SettingsSnapshot["settings_source"] = "session_start",
): SettingsSnapshot | undefined => {
	// Scalars: higher scope wins (last write). Collections (hooks, plugins): union
	// across scopes per the spec's "array settings concatenate + dedupe" rule.
	let output_style: string | undefined;
	let output_style_scope: SettingsScope | undefined;
	let status_line: SettingsSnapshot["status_line"];
	let permission_default_mode: string | undefined;
	const pluginsAcc = new Set<string>();
	const hooksAcc = new Set<string>();

	for (const { scope, path } of settingsFilesLowToHigh(projectDir)) {
		const settings = readSettingsFile(path);
		if (!settings) continue;

		const style = asString(settings.outputStyle);
		if (style) {
			output_style = style;
			output_style_scope = scope;
		}
		const sl = statusLineOf(settings.statusLine);
		if (sl) status_line = sl;
		for (const p of enabledPluginKeys(settings.enabledPlugins) ?? []) pluginsAcc.add(p);
		const defMode = permissionsDefaultMode(settings.permissions);
		if (defMode) permission_default_mode = defMode;
		for (const h of hookEventNames(settings.hooks) ?? []) hooksAcc.add(h);
	}

	const plugins_enabled = pluginsAcc.size > 0 ? [...pluginsAcc].sort() : undefined;
	const hooks_configured = hooksAcc.size > 0 ? [...hooksAcc].sort() : undefined;

	const hasAny =
		output_style !== undefined ||
		status_line !== undefined ||
		plugins_enabled !== undefined ||
		permission_default_mode !== undefined ||
		hooks_configured !== undefined;
	if (!hasAny) return undefined;

	return {
		settings_source: source,
		captured_at: Date.now(),
		...(output_style !== undefined ? { output_style } : {}),
		...(output_style_scope !== undefined ? { output_style_scope } : {}),
		...(status_line !== undefined ? { status_line } : {}),
		...(plugins_enabled !== undefined ? { plugins_enabled } : {}),
		...(permission_default_mode !== undefined ? { permission_default_mode } : {}),
		...(hooks_configured !== undefined ? { hooks_configured } : {}),
	};
};

/**
 * Inferred CLAUDE.md fallback (CFG-5). When no `InstructionsLoaded` events were
 * captured (the installed binary may predate the event — BLOCKED-VERIFY: zero such
 * events exist today), record fact-of-existence of the project and user CLAUDE.md
 * files. Content is intentionally NOT read (out of scope v1). Every entry is
 * labeled `memory_type: "inferred"` so surfaces can disclose the lower confidence.
 * Never throws; returns an empty array when neither file exists.
 */
export const inferClaudeMd = (projectDir: string): readonly ClaudeMdInEffect[] => {
	const home = homeDir();
	const candidates: ReadonlyArray<string> = [
		join(projectDir, "CLAUDE.md"),
		join(projectDir, ".claude", "CLAUDE.md"),
		home ? join(home, ".claude", "CLAUDE.md") : "",
	];
	const seen = new Set<string>();
	const found: ClaudeMdInEffect[] = [];
	for (const path of candidates) {
		if (!path || seen.has(path)) continue;
		seen.add(path);
		try {
			if (existsSync(path)) found.push({ file_path: path, memory_type: "inferred" });
		} catch {
			// fact-of-existence probe must never break capture/distill
		}
	}
	return found;
};

#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import type { CaptureMode, HookEventType, StoredEvent } from "./types";
import { isCaptureMode } from "./types";
import { logError, resolveProjectRoot } from "./utils";

// --- Capture-time redaction (OSS-9) -----------------------------------------
// A PURE, deterministic transform applied to a raw hook payload before it is
// written to JSONL. `full` short-circuits (byte-identical to historic capture);
// `redacted` masks secret-looking values while keeping structure; `metadata`
// keeps only an allowlist of known-safe structural fields. No I/O, no mutation.

const REDACTED = "[REDACTED]";

/** Key names whose values are masked outright (case-insensitive substring match). */
const SENSITIVE_KEY =
	/secret|token|password|passwd|api[-_]?key|access[-_]?key|client[-_]?secret|credential|private[-_]?key|session[-_]?key|encryption[-_]?key|auth|bearer/i;

/** Value shapes that look like secrets regardless of their key. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
	/(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/, // provider API keys (OpenAI / Stripe style)
	/gh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
	/xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
	/AKIA[0-9A-Z]{16}/, // AWS access key id
	/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
	/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, // PEM private key
];

/** Inline env-style assignment of a secret-looking variable: `FOO_TOKEN=value`. */
const ENV_SECRET_ASSIGN =
	/((?:^|\n)[ \t]*[A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*[ \t]*=[ \t]*)\S+/g;

/** Structural string fields kept verbatim in `metadata` mode; all other strings are dropped. */
const METADATA_STRING_KEYS: ReadonlySet<string> = new Set([
	"hook_event_name", "session_id", "tool_name", "tool_use_id",
	"agent_id", "agent_type", "agent_name", "permission_mode",
	"memory_type", "load_reason", "source", "trigger", "model",
	"file_path", "cwd", "transcript_path", "status", "end_reason", "effort",
]);

const maskSecretString = (s: string): string =>
	SECRET_VALUE_PATTERNS.some((re) => re.test(s))
		? REDACTED
		: s.replace(ENV_SECRET_ASSIGN, `$1${REDACTED}`);

const redactValue = (value: unknown, mode: Exclude<CaptureMode, "full">): unknown => {
	if (typeof value === "string") return mode === "metadata" ? REDACTED : maskSecretString(value);
	if (Array.isArray(value)) return value.map((v) => redactValue(v, mode));
	if (value !== null && typeof value === "object") return redactObject(value as Record<string, unknown>, mode);
	return value; // number | boolean | null | undefined — structural, no cleartext
};

const redactObject = (
	obj: Record<string, unknown>,
	mode: Exclude<CaptureMode, "full">,
): Record<string, unknown> => {
	const entries = Object.entries(obj).flatMap(([key, value]): readonly (readonly [string, unknown])[] => {
		if (mode === "metadata") {
			if (value !== null && typeof value === "object") return [[key, redactValue(value, mode)]];
			if (typeof value === "string") return METADATA_STRING_KEYS.has(key) ? [[key, value]] : [];
			return [[key, value]]; // numbers / booleans / null kept as structural metadata
		}
		// redacted: mask values under sensitive key names, otherwise recurse.
		if (SENSITIVE_KEY.test(key)) {
			if (value !== null && typeof value === "object") return [[key, redactValue(value, mode)]];
			return [[key, value === null || value === undefined ? value : REDACTED]];
		}
		return [[key, redactValue(value, mode)]];
	});
	return Object.fromEntries(entries);
};

/** Pure redaction entry point. `full` returns the input unchanged. */
const redact = (value: unknown, mode: CaptureMode): unknown =>
	mode === "full" ? value : redactValue(value, mode);

/** Read the capture/redaction mode from `.clens/config.json`. Defaults to `full`. */
const readCaptureMode = (projectDir: string): CaptureMode => {
	try {
		const configPath = `${projectDir}/.clens/config.json`;
		if (!existsSync(configPath)) return "full";
		const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
		if (parsed !== null && typeof parsed === "object") {
			const mode = (parsed as Record<string, unknown>).mode;
			if (isCaptureMode(mode)) return mode;
		}
	} catch {
		// Malformed/unreadable config must never break capture — fall back to full.
	}
	return "full";
};

// Read stdin synchronously for performance
const raw = await Bun.stdin.text();
if (!raw.trim()) process.exit(0);

// Guard: reject non-JSON input silently (e.g. plain text, binary)
const firstChar = raw.trimStart()[0];
if (firstChar !== "{" && firstChar !== "[") process.exit(0);

const event = (Bun.argv[2] || "unknown") as HookEventType;

try {
	const input = JSON.parse(raw);
	const sid: string = input.session_id || "unknown";
	// Resolve the project root by walking up from cwd to the nearest `.clens/`
	// (or `.git/`) — prevents a subagent running in a subdirectory from
	// fragmenting session capture into a nested `.clens/`.
	const projectDir: string = resolveProjectRoot(input.cwd || process.cwd());

	// Guard: refuse to capture into a root that is itself nested under a `.clens/`
	// directory. Such a root produces a recursive `.clens/sessions/.clens/sessions`
	// capture dir — and because `resolveProjectRoot` prefers the nearest `.clens/`
	// marker, that nesting is self-perpetuating once it exists. Exact-segment match
	// (not substring) so a legit path like `.clens-backup/` is unaffected.
	if (projectDir.split(sep).includes(".clens")) process.exit(0);

	const sessionsDir = `${projectDir}/.clens/sessions`;
	mkdirSync(sessionsDir, { recursive: true });

	// Build stored event (with optional context enrichment on SessionStart or InstructionsLoaded with session_start)
	const shouldEnrichContext = event === "SessionStart"
		|| (event === "InstructionsLoaded" && input.load_reason === "session_start");

	const context = shouldEnrichContext
		? await (async () => {
			try {
				const { enrichSessionStart } = await import("./capture/context");
				return enrichSessionStart(input);
			} catch (err) {
				logError(projectDir, `hook:enrichSessionStart:${event}`, err);
				return undefined;
			}
		})()
		: undefined;

	// Apply opt-in redaction to the persisted payload only (link detection below
	// still uses the original `input` so cross-agent structure stays intact).
	const captureMode = readCaptureMode(projectDir);
	const data: Record<string, unknown> =
		captureMode === "full" ? input : (redact(input, captureMode) as Record<string, unknown>);

	const stored: StoredEvent = {
		t: Date.now(),
		event,
		sid,
		...(context ? { context } : {}),
		data,
	};

	// Append to session JSONL (hot path — appendFileSync is atomic for small writes)
	// biome-ignore lint/style/useTemplate: performance-critical hot path
	appendFileSync(`${sessionsDir}/${sid}.jsonl`, JSON.stringify(stored) + "\n");

	// Cross-agent link detection
	try {
		const { isLinkEvent, extractLinkEvent, appendLink } = await import("./capture/links");
		if (isLinkEvent(event, input)) {
			const linkEvent = extractLinkEvent(event, input);
			appendLink(projectDir, linkEvent);
		}
	} catch (err) {
		logError(projectDir, `hook:linkDetection:${event}`, err);
	}

	// Hook proxy delegation
	try {
		const delegatedPath = `${projectDir}/.clens/delegated-hooks.json`;
		if (existsSync(delegatedPath)) {
			const { delegateToUserHooks } = await import("./capture/proxy");
			const result = await delegateToUserHooks(event, raw, projectDir);
			if (result) {
				// Output merged result for Claude Code to consume
				process.stdout.write(JSON.stringify(result));
			}
		}
	} catch (err) {
		logError(projectDir, `hook:proxyDelegation:${event}`, err);
	}
} catch (err) {
	// Silent fail — NEVER break Claude Code workflow
	// Errors go to .clens/errors.log, not stdout/stderr
	try {
		const projectDir = process.cwd();
		const errorLog = `${projectDir}/.clens/errors.log`;
		mkdirSync(`${projectDir}/.clens`, { recursive: true });
		const errMessage = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
		const stackLines =
			err instanceof Error && err.stack
				? err.stack.split("\n").slice(0, 3).join("\n  ")
				: "no stack";
		const truncatedInput = raw.slice(0, 200);
		appendFileSync(
			errorLog,
			`${new Date().toISOString()} [${event}] ${errMessage}\n  stack: ${stackLines}\n  input: ${truncatedInput}\n`,
		);
	} catch {
		// Even error logging failed — truly silent
	}
	process.exit(0);
}

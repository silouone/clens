#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { sep } from "node:path";
import type { HookEventType, StoredEvent } from "./types";
import { logError, resolveProjectRoot } from "./utils";

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

	const stored: StoredEvent = {
		t: Date.now(),
		event,
		sid,
		...(context ? { context } : {}),
		data: input,
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

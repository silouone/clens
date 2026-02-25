#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import type { HookEventType, StoredEvent } from "./types";
import { logError } from "./utils";

// Read stdin synchronously for performance
const raw = await Bun.stdin.text();
if (!raw.trim()) process.exit(0);

const event = (Bun.argv[2] || "unknown") as HookEventType;

try {
	const input = JSON.parse(raw);
	const sid: string = input.session_id || "unknown";
	const projectDir: string = input.cwd || process.cwd();

	const sessionsDir = `${projectDir}/.clens/sessions`;
	mkdirSync(sessionsDir, { recursive: true });

	// Build stored event (with optional context enrichment on SessionStart)
	const context = event === "SessionStart"
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

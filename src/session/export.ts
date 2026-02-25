import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { ExportManifest, SpawnLink } from "../types";
import { BROADCAST_EVENTS } from "../types";
import { computeEffectiveDuration, findLastMeaningfulEvent } from "../utils";
import { readLinks, readSessionEvents } from "./read";

/** Safely extract a numeric timestamp from a parsed JSON object. */
const extractTimestamp = (obj: Record<string, unknown>): number | undefined =>
	typeof obj.t === "number" ? obj.t : undefined;

export const exportSession = async (
	sessionId: string,
	projectDir: string,
	_options?: { otel?: boolean },
): Promise<string> => {
	const sessionsDir = `${projectDir}/.clens/sessions`;
	const sessionPath = `${sessionsDir}/${sessionId}.jsonl`;
	const distilledPath = `${projectDir}/.clens/distilled/${sessionId}.json`;
	const linksPath = `${sessionsDir}/_links.jsonl`;

	if (!existsSync(sessionPath)) {
		throw new Error(`Session ${sessionId} not found.`);
	}

	const events = readSessionEvents(sessionId, projectDir);
	if (events.length === 0) {
		throw new Error(`Session ${sessionId} has no events.`);
	}

	const firstEvent = events[0];
	const lastEvent = events[events.length - 1];

	// Read links if available
	const links = readLinks(projectDir);

	// Detect multi-agent session
	const spawnLinks = links.filter((l): l is SpawnLink => l.type === "spawn");
	const isMultiAgent = spawnLinks.length > 0;

	// Build child agent entries from spawn links
	const readChildMetrics = (childPath: string): { readonly eventCount: number; readonly duration: number } => {
		if (!existsSync(childPath)) return { eventCount: 0, duration: 0 };
		try {
			const childContent = readFileSync(childPath, "utf-8").trim();
			const childLines = childContent.split("\n").filter(Boolean);
			if (childLines.length < 2) return { eventCount: childLines.length, duration: 0 };

			const parsedEvents: readonly Record<string, unknown>[] = childLines.map((l: string) => JSON.parse(l));
			const childTimestamps = parsedEvents
				.map((e) => extractTimestamp(e))
				.filter((t): t is number => t !== undefined);
			if (childTimestamps.length < 2) return { eventCount: childLines.length, duration: 0 };

			const childEffective = computeEffectiveDuration(childTimestamps);
			return {
				eventCount: childLines.length,
				duration: childEffective.effective_duration_ms,
			};
		} catch {
			return { eventCount: 0, duration: 0 };
		}
	};

	const childAgents = isMultiAgent
		? spawnLinks.map((spawn) => {
				const childPath = `${sessionsDir}/${spawn.agent_id}.jsonl`;
				const { eventCount, duration } = readChildMetrics(childPath);
				return {
					session_id: spawn.agent_id,
					agent_type: spawn.agent_type,
					agent_name: spawn.agent_name,
					event_count: eventCount,
					duration_ms: duration,
				};
			})
		: [];

	// Build manifest
	const parentTimestamps = events.map((e) => e.t);
	const parentEffective = computeEffectiveDuration(parentTimestamps);
	const manifest: ExportManifest = {
		version: "0.1.0",
		exported_at: new Date().toISOString(),
		session_id: sessionId,
		project_dir: projectDir,
		agents: [
			{
				session_id: sessionId,
				agent_type: firstEvent.context?.agent_type ?? "unknown",
				event_count: events.length,
				duration_ms: parentEffective.effective_duration_ms,
			},
			...childAgents,
		],
		messages_count: links.filter((l) => l.type === "msg_send").length,
		git_branch: firstEvent.context?.git_branch ?? undefined,
		git_commit: firstEvent.context?.git_commit ?? undefined,
	};

	// Build archive name
	const dateStr = new Date().toISOString().slice(0, 10);
	const idPrefix = sessionId.slice(0, 8);
	const exportName = isMultiAgent
		? `session-team-${idPrefix}-${dateStr}`
		: `session-${idPrefix}-${dateStr}`;
	const exportDir = `${projectDir}/.clens/exports`;
	mkdirSync(exportDir, { recursive: true });
	const archivePath = `${exportDir}/${exportName}.tar.gz`;

	// Create temp staging directory
	const stagingDir = `/tmp/clens-export-${Date.now()}`;
	const stageRoot = `${stagingDir}/${exportName}`;
	mkdirSync(stageRoot, { recursive: true });

	// Write manifest
	writeFileSync(`${stageRoot}/manifest.json`, JSON.stringify(manifest, null, 2));

	// Copy session files
	if (isMultiAgent) {
		mkdirSync(`${stageRoot}/agents`, { recursive: true });
		copyFileSync(sessionPath, `${stageRoot}/agents/${sessionId}.jsonl`);

		spawnLinks
			.filter((spawn) => existsSync(`${sessionsDir}/${spawn.agent_id}.jsonl`))
			.forEach((spawn) =>
				copyFileSync(
					`${sessionsDir}/${spawn.agent_id}.jsonl`,
					`${stageRoot}/agents/${spawn.agent_id}.jsonl`,
				),
			);

		if (existsSync(linksPath)) {
			copyFileSync(linksPath, `${stageRoot}/links.jsonl`);
		}
	} else {
		copyFileSync(sessionPath, `${stageRoot}/session.jsonl`);

		if (existsSync(distilledPath)) {
			copyFileSync(distilledPath, `${stageRoot}/distilled.json`);
		}
	}

	// Create tar.gz archive
	const result = Bun.spawnSync(["tar", "-czf", archivePath, "-C", stagingDir, exportName], {
		stderr: "pipe",
	});

	// Cleanup staging
	rmSync(stagingDir, { recursive: true, force: true });

	if (result.exitCode !== 0) {
		throw new Error(`Failed to create archive: ${result.stderr.toString()}`);
	}

	return archivePath;
};

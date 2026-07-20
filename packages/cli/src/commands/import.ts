import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { readRollout } from "../session/rollout";
import { green, red, yellow } from "./shared";

/** Rollout files Codex writes; the importer only ever reads these. */
const isRolloutFile = (name: string): boolean =>
	name.startsWith("rollout-") && name.endsWith(".jsonl");

/** Recursively collect rollout files under a directory (Codex nests by Y/M/D). */
const collectRollouts = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = `${dir}/${entry.name}`;
		if (entry.isDirectory()) return collectRollouts(full);
		return entry.isFile() && isRolloutFile(entry.name) ? [full] : [];
	});

/** Resolve the CLI positional into the concrete list of rollout files to import. */
const resolveRolloutFiles = (inputPath: string): string[] => {
	const stat = statSync(inputPath); // throws ENOENT with a clear message at the edge
	if (stat.isDirectory()) return collectRollouts(inputPath).sort();
	return [inputPath];
};

/**
 * `clens import codex <rollout-file|dir>` — read Codex rollout JSONL, normalize
 * to Claude-hook-shaped StoredEvents, and OVERWRITE `.clens/sessions/{sid}.jsonl`
 * (the importer emits the full event set at once; re-import replaces, never
 * appends). Everything downstream — distill, TUI, web — then works unchanged.
 */
export const importCommand = (args: {
	provider: string | undefined;
	inputPath: string | undefined;
	projectDir: string;
}): void => {
	if (args.provider !== "codex") {
		throw new Error(
			`Unknown import provider '${args.provider ?? ""}'. Supported: codex.\n` +
				"Usage: clens import codex <rollout-file|dir>",
		);
	}
	if (!args.inputPath) {
		throw new Error("Missing rollout path.\nUsage: clens import codex <rollout-file|dir>");
	}

	const files = resolveRolloutFiles(args.inputPath);
	if (files.length === 0) {
		console.log(yellow(`No rollout-*.jsonl files found under ${args.inputPath}`));
		return;
	}

	const sessionsDir = `${args.projectDir}/.clens/sessions`;
	mkdirSync(sessionsDir, { recursive: true });

	const imported = files.map((file) => importOne(file, sessionsDir)).filter((ok) => ok).length;

	if (imported === 0) {
		console.log(red("No sessions imported."));
		return;
	}
	console.log(
		green(`✓ Imported ${imported} Codex session${imported === 1 ? "" : "s"} into .clens/sessions`),
	);
};

/** Import one rollout file → `.clens/sessions/{sid}.jsonl` (overwrite). Returns whether it wrote. */
const importOne = (file: string, sessionsDir: string): boolean => {
	const events = readRollout(file);
	if (events.length === 0) {
		console.log(yellow(`  skipped (no mappable records): ${file}`));
		return false;
	}
	const sid = events[0].sid;
	const body = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
	writeFileSync(`${sessionsDir}/${sid}.jsonl`, body);
	console.log(green(`  ✓ ${sid}  (${events.length} events)  ← ${file}`));
	return true;
};

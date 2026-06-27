import type { ColorName } from "../types";
import { isColorName } from "../types";
import { readSessionMeta, setSessionMeta } from "../session/session-meta";
import { enrichSessionSummaries, listSessions } from "../session/read";
import { resolveSessionId } from "./shared";
import { bold, cyan, dim, green } from "./shared";

export interface NameCommandArgs {
	readonly sessionArg: string | undefined;
	readonly projectDir: string;
	/** Positional label (may be undefined). */
	readonly label: string | undefined;
	/** --color <value>, if provided. */
	readonly color: string | undefined;
	/** --clear flag: remove both label and color. */
	readonly clear: boolean;
	readonly json: boolean;
}

/** Resolve the current display name + meta for a session and print it. */
const printCurrent = (sessionId: string, projectDir: string, json: boolean): void => {
	const meta = readSessionMeta(projectDir)[sessionId];
	const summary = enrichSessionSummaries(
		listSessions(projectDir).filter((s) => s.session_id === sessionId),
		projectDir,
	)[0];

	if (json) {
		console.log(
			JSON.stringify(
				{
					session_id: sessionId,
					display_name: summary?.display_name ?? sessionId.slice(0, 8),
					name_source: summary?.name_source ?? "id",
					label: meta?.label ?? null,
					color: meta?.color ?? "none",
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(`${bold("Session")} ${cyan(sessionId.slice(0, 8))}`);
	console.log(`  ${dim("name")}    ${summary?.display_name ?? sessionId.slice(0, 8)} ${dim(`(${summary?.name_source ?? "id"})`)}`);
	console.log(`  ${dim("label")}   ${meta?.label ?? dim("—")}`);
	console.log(`  ${dim("color")}   ${meta?.color ?? dim("none")}`);
};

/**
 * `clens name <id> [label] [--color c] [--clear]`
 *  - no label/color/clear → prints current meta.
 *  - label → sets label (whitespace clears it).
 *  - --color <c> → sets/clears color (none clears); invalid → error.
 *  - --clear → clears both label and color.
 */
export const nameCommand = (args: NameCommandArgs): void => {
	const sessionId = resolveSessionId(args.sessionArg, false, args.projectDir);

	// --clear wins: remove both fields.
	if (args.clear) {
		setSessionMeta(args.projectDir, sessionId, { label: null, color: null });
		if (!args.json) console.log(green(`Cleared label and color for ${sessionId.slice(0, 8)}.`));
		else printCurrent(sessionId, args.projectDir, true);
		return;
	}

	const hasLabel = args.label !== undefined;
	const hasColor = args.color !== undefined;

	// No mutation requested → print current meta.
	if (!hasLabel && !hasColor) {
		printCurrent(sessionId, args.projectDir, args.json);
		return;
	}

	if (hasColor && !isColorName(args.color)) {
		throw new Error(
			`Invalid color "${String(args.color)}". Valid: none, red, amber, green, blue, violet, gray.`,
		);
	}

	setSessionMeta(args.projectDir, sessionId, {
		...(hasLabel ? { label: args.label } : {}),
		...(hasColor ? { color: args.color as ColorName } : {}),
	});

	if (args.json) {
		printCurrent(sessionId, args.projectDir, true);
		return;
	}

	const parts = [
		hasLabel ? (args.label?.trim() ? `label "${args.label}"` : "cleared label") : null,
		hasColor ? (args.color === "none" ? "cleared color" : `color ${args.color}`) : null,
	].filter((p): p is string => p !== null);
	console.log(green(`Updated ${sessionId.slice(0, 8)}: ${parts.join(", ")}.`));
};

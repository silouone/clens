import { createInterface } from "node:readline";
import { formatBytes } from "../utils";
import { type Flags, resolveSessionId } from "./shared";

/** Interactive [y/N] confirmation. Resolves true only on an explicit yes. */
const confirm = (question: string): Promise<boolean> => {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(`${question} [y/N] `, (answer) => {
			rl.close();
			resolve(/^y(es)?$/i.test(answer.trim()));
		});
	});
};

export const cleanCommand = async (args: {
	sessionArg: string | undefined;
	flags: Flags;
	projectDir: string;
}): Promise<void> => {
	const { cleanSession, cleanAll } = await import("../session/clean");

	// Targeted delete: an explicit session id, or --last (single most-recent file).
	const sid = args.sessionArg
		? resolveSessionId(args.sessionArg, args.flags.last, args.projectDir)
		: args.flags.last
			? resolveSessionId(undefined, true, args.projectDir)
			: null;

	if (sid) {
		const result = cleanSession(sid, args.projectDir, { force: args.flags.force });
		console.log(
			`Cleaned session ${result.session_id.slice(0, 8)}. Freed ${formatBytes(result.freed_bytes)}.`,
		);
		return;
	}

	// No target specified. Bare `clens clean` must delete nothing and error —
	// blanket deletion only happens behind the explicit --all lever.
	if (!args.flags.all) {
		throw new Error(
			"Nothing to clean. Specify a session id, --last for the most recent, or --all to remove every session in this project.",
		);
	}

	// --all: blanket delete of all sessions WITHIN the resolved project dir.
	// Gate it: confirm interactively, or require --yes when non-interactive.
	const confirmed =
		args.flags.yes ||
		(Boolean(process.stdin.isTTY) &&
			(await confirm(
				`Remove ALL session data in ${args.projectDir}/.clens/sessions? This cannot be undone.`,
			)));

	if (!confirmed) {
		if (!process.stdin.isTTY) {
			throw new Error(
				"Refusing to 'clean --all' without confirmation in a non-interactive context. Re-run with --yes to proceed.",
			);
		}
		console.log("Aborted. Nothing was deleted.");
		return;
	}

	const result = cleanAll(args.projectDir, { force: args.flags.force });
	if (result.skipped.length > 0) {
		console.log(
			result.skipped
				.map((id) => `Skipping ${id.slice(0, 8)} (not distilled). Use --force to override.`)
				.join("\n"),
		);
	}
	console.log(`Cleaned ${result.cleaned} session(s). Freed ${formatBytes(result.freed_bytes)}.`);
};

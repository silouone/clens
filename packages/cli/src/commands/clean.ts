import { formatBytes } from "../utils";
import { type Flags, resolveSessionId } from "./shared";

export const cleanCommand = async (args: {
	sessionArg: string | undefined;
	flags: Flags;
	projectDir: string;
}): Promise<void> => {
	const sid = args.sessionArg
		? resolveSessionId(args.sessionArg, args.flags.last, args.projectDir)
		: null;
	const { cleanSession, cleanAll } = await import("../session/clean");
	if (sid) {
		const result = cleanSession(sid, args.projectDir, { force: args.flags.force });
		console.log(
			`Cleaned session ${result.session_id.slice(0, 8)}. Freed ${formatBytes(result.freed_bytes)}.`,
		);
	} else if (args.flags.last) {
		const resolved = resolveSessionId(undefined, true, args.projectDir);
		const result = cleanSession(resolved, args.projectDir, { force: args.flags.force });
		console.log(
			`Cleaned session ${result.session_id.slice(0, 8)}. Freed ${formatBytes(result.freed_bytes)}.`,
		);
	} else {
		const result = cleanAll(args.projectDir, { force: args.flags.force });
		if (result.skipped.length > 0) {
			console.log(
				result.skipped
					.map((id) => `Skipping ${id.slice(0, 8)} (not distilled). Use --force to override.`)
					.join("\n"),
			);
		}
		console.log(`Cleaned ${result.cleaned} session(s). Freed ${formatBytes(result.freed_bytes)}.`);
	}
};

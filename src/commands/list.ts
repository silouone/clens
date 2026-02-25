import { formatBytes, formatDuration, formatSessionDate } from "../utils";
import { bold, dim, green, yellow } from "./shared";

/** Truncate a string to maxLen, adding ellipsis if needed. */
const truncate = (str: string, maxLen: number): string =>
	str.length > maxLen ? `${str.slice(0, maxLen - 1)}\u2026` : str;

export const listCommand = async (args: { projectDir: string; json: boolean }): Promise<void> => {
	const { listSessions, enrichSessionSummaries } = await import("../session/read");
	const rawSessions = listSessions(args.projectDir);
	const sessions = enrichSessionSummaries(rawSessions, args.projectDir);
	if (args.json) {
		console.log(JSON.stringify(sessions, null, 2));
		return;
	}
	if (sessions.length === 0) {
		console.log("No sessions found.");
		return;
	}
	console.log(
		bold(
			"ID".padEnd(12) +
				"Name".padEnd(27) +
				"Started".padEnd(15) +
				"Branch".padEnd(16) +
				"Team".padEnd(15) +
				"Type".padEnd(10) +
				"D".padEnd(3) +
				"Duration".padEnd(12) +
				"Events".padEnd(10) +
				"Status",
		),
	);
	console.log(dim("\u2500".repeat(130)));
	console.log(
		sessions
			.map((s) => {
				const id = s.session_id.slice(0, 8);
				const name = truncate(s.session_name ?? "-", 25);
				const started = formatSessionDate(s.start_time);
				const branch = (s.git_branch || "-").slice(0, 14);
				const team = (s.team_name || "-").slice(0, 13);
				const agentCount = s.agent_count ?? 0;
				const type = agentCount > 0 ? `multi(${agentCount})` : "solo";
				const distillMark = s.is_distilled ? "\u2713" : "-";
				const dur = formatDuration(s.duration_ms);
				const events = String(s.event_count);
				const status = s.status === "complete" ? green("complete") : yellow("[incomplete]");
				return `${id.padEnd(12)}${name.padEnd(27)}${started.padEnd(15)}${branch.padEnd(16)}${team.padEnd(15)}${type.padEnd(10)}${distillMark.padEnd(3)}${dur.padEnd(12)}${events.padEnd(10)}${status}`;
			})
			.join("\n"),
	);
	const totalSize = sessions.reduce(
		(sum: number, s: { file_size_bytes: number }) => sum + s.file_size_bytes,
		0,
	);
	console.log(dim(`\nTotal: ${formatBytes(totalSize)} across ${sessions.length} session(s)`));
	if (totalSize > 1024 * 1024 * 1024) {
		console.log(yellow("\u26a0 Total size exceeds 1GB. Consider running: clens clean"));
	}
};

import { green } from "./shared";

export const exportCommand = async (args: {
	sessionId: string;
	projectDir: string;
}): Promise<void> => {
	const { exportSession } = await import("../session/export");
	const outPath = await exportSession(args.sessionId, args.projectDir);
	console.log(green(`\u2713 Exported to ${outPath}`));
};

import { green } from "./shared";

export const exportCommand = async (args: {
	sessionId: string;
	projectDir: string;
	otel: boolean;
}): Promise<void> => {
	const { exportSession } = await import("../session/export");
	const outPath = await exportSession(args.sessionId, args.projectDir, { otel: args.otel });
	console.log(green(`\u2713 Exported to ${outPath}`));
};

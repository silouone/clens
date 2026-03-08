import { bold, cyan, dim } from "./shared";

interface WebCommandOptions {
	readonly projectDir: string;
	readonly port: number;
	readonly open: boolean;
}

/** Open a URL in the default browser (macOS). */
const openBrowser = (url: string): void => {
	try {
		Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
	} catch {
		// Silently ignore — user can open manually
	}
};

export const webCommand = async (options: WebCommandOptions): Promise<void> => {
	const { startServer, findProjectDir } = await import("@clens/web/server");

	const projectDir = findProjectDir(options.projectDir);
	const handle = startServer({
		projectDir,
		port: options.port,
	});

	const authUrl = `${handle.url}?token=${handle.token}`;

	console.log(`${bold("cLens Web")} started on ${cyan(handle.url)}`);
	console.log(`${dim("Token:")} ${handle.token}`);
	console.log(`${dim("Open:")}  ${authUrl}`);

	if (options.open) {
		openBrowser(authUrl);
	}

	// Keep process alive until interrupted
	process.on("SIGINT", () => {
		handle.stop();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		handle.stop();
		process.exit(0);
	});

	// Block indefinitely
	await new Promise(() => {});
};

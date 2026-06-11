import { bold, cyan, dim } from "./shared";

interface WebCommandOptions {
	readonly projectDir: string;
	readonly port: number;
	readonly open: boolean;
	readonly global: boolean;
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

	// In global mode, discover + register projects, then pass to server
	const projects = options.global
		? await (async () => {
			const { discoverAndRegisterProjects } = await import("../session/registry");
			return discoverAndRegisterProjects();
		})()
		: undefined;

	const handle = startServer({
		projectDir,
		port: options.port,
		...(projects && projects.length > 0 ? { projects } : {}),
	});

	const authUrl = `${handle.url}?token=${handle.token}`;

	console.log(`${bold("cLens Web")} started on ${cyan(handle.url)}`);
	if (projects && projects.length > 0) {
		console.log(`${dim("Mode:")}  global (${projects.length} project${projects.length === 1 ? "" : "s"})`);
	}
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

import { resolve } from "node:path";
import { bold, cyan, dim } from "./shared";

interface WebCommandOptions {
	readonly projectDir: string;
	readonly port: number;
	readonly open: boolean;
	readonly global: boolean;
}

/** Open a URL in the default browser (cross-platform: macOS / Linux / Windows). */
const openBrowser = (url: string): void => {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
	} catch {
		// Silently ignore — user can open manually
	}
};

export const webCommand = async (options: WebCommandOptions): Promise<void> => {
	// Force production mode by default: the dashboard is served from the bundled
	// static client (set NODE_ENV=development only when driving the vite dev server).
	if (!process.env.NODE_ENV) {
		process.env.NODE_ENV = "production";
	}

	// The web server is bundled into this CLI at build time (see build.ts); it is
	// NOT a runtime dependency, so npm consumers need nothing from @clens/web.
	const { startServer, findProjectDir } = await import("@clens/web/server");

	// Built client bundle ships next to the compiled CLI at dist/web/. When this
	// module is bundled into dist/cli.js, import.meta.dir resolves to dist/.
	const distDir = resolve(import.meta.dir, "web");

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
		distDir,
		...(projects && projects.length > 0 ? { projects } : {}),
	});

	const authUrl = `${handle.url}?token=${handle.token}`;

	console.log(`${bold("cLens Web")} started on ${cyan(handle.url)}`);
	if (handle.port !== options.port) {
		console.log(`${dim(`port ${options.port} busy → started on ${handle.port}`)}`);
	}
	if (projects && projects.length > 0) {
		console.log(
			`${dim("Mode:")}  global (${projects.length} project${projects.length === 1 ? "" : "s"})`,
		);
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

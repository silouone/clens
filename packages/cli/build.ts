/**
 * Build the published `clens` CLI artifact.
 *
 * Produces a fully self-contained npm package that needs no workspace packages
 * at install time:
 *   1. Bundles `cli.ts` and `hook.ts` with bun. The web server (Hono app) is
 *      pulled in inline via the `@clens/web/server` dynamic import in
 *      commands/web.ts, so it ships inside dist/cli.js — it is NOT a runtime
 *      dependency.
 *   2. Builds the SolidJS web client (vite) and copies the static bundle into
 *      dist/web/ so `clens web` can serve the dashboard in production mode.
 *
 * Run via `bun run build` (packages/cli) or `bun run build:cli` (repo root).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(cliDir, "../web");
const distDir = resolve(cliDir, "dist");
const webDist = resolve(distDir, "web");

// ── 1. Bundle CLI + hook (web server bundled inline via web.ts import) ──
// Spawn the exact same `bun build` invocations the package historically used so
// the inlining behaviour stays identical to what was verified.
const bundle = (entry: string): void => {
	const proc = Bun.spawnSync(
		["bun", "build", entry, "--outdir", "dist", "--target", "bun", "--entry-naming", "[name].js"],
		{ cwd: cliDir, stdout: "inherit", stderr: "inherit" },
	);
	if (proc.exitCode !== 0) {
		throw new Error(`bun build failed for ${entry} (exit ${proc.exitCode})`);
	}
};

bundle("src/cli.ts");
bundle("src/hook.ts");

// ── 2. Build the web client (vite) ──
const web = Bun.spawnSync(["bun", "run", "build"], {
	cwd: webDir,
	stdout: "inherit",
	stderr: "inherit",
});
if (web.exitCode !== 0) {
	throw new Error(`web client build failed (exit ${web.exitCode})`);
}

// ── 3. Copy the static client bundle into the CLI artifact ──
const srcWebDist = resolve(webDir, "dist");
if (!existsSync(resolve(srcWebDist, "index.html"))) {
	throw new Error(`web client build produced no index.html at ${srcWebDist}`);
}
rmSync(webDist, { recursive: true, force: true });
mkdirSync(webDist, { recursive: true });
cpSync(srcWebDist, webDist, {
	recursive: true,
	// Drop tsc's build cache — it is large and not part of the served bundle.
	filter: (src) => !src.endsWith(".tsbuildinfo"),
});

console.log(`Built CLI artifact -> ${distDir} (client -> ${webDist})`);

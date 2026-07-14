#!/usr/bin/env node
/**
 * Drift-proof publish guard.
 *
 * Asserts that `npm pack` for the target package ships ALL of:
 *   1. the web dashboard bundle (so `clens web` serves the dashboard in
 *      production mode),
 *   2. the type definitions referenced by the package's "types" field, and
 *   3. README.md + LICENSE (so the npm page renders and the MIT grant travels
 *      with the code). These are copied in by the `prepack` script; npm runs
 *      prepack for `npm pack` (incl. --dry-run) and `npm publish`.
 *
 * Either dropping out of the tarball is a silent regression that only surfaces
 * for end users post-publish. Running this in CI (every PR) and as a publish
 * gate (every tag) catches the drift before it ships.
 *
 * Usage: node scripts/verify-pack.mjs [packageDir]   (default: packages/cli)
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkgDir = resolve(process.cwd(), process.argv[2] ?? "packages/cli");
const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8"));

// `npm pack --dry-run --json` emits the would-be tarball manifest on stdout.
const raw = execSync("npm pack --dry-run --json", { cwd: pkgDir, encoding: "utf8" });
const files = JSON.parse(raw)[0].files.map((f) => f.path);
const has = (pred) => files.some(pred);

const errors = [];

// 1. Web dashboard bundle — `clens web` serves this static build in prod.
if (!has((p) => p === "dist/web/index.html")) {
	errors.push("missing dist/web/index.html (web dashboard bundle)");
}
if (!has((p) => p.startsWith("dist/web/assets/"))) {
	errors.push("missing dist/web/assets/* (web dashboard bundle)");
}

// 2. Type definitions referenced by the "types" field must be packed.
const typesPath = pkg.types?.replace(/^\.\//, "");
if (!typesPath) {
	errors.push('package.json has no "types" field');
} else if (!files.includes(typesPath)) {
	errors.push(`missing types entry "${typesPath}" (referenced by package.json "types")`);
}

// 3. README + LICENSE — copied in by prepack; the npm page and MIT grant depend
//    on them shipping inside the tarball.
if (!files.includes("README.md")) {
	errors.push("missing README.md (npm package page would render empty)");
}
if (!files.includes("LICENSE")) {
	errors.push("missing LICENSE (MIT grant would not travel with the package)");
}

if (errors.length > 0) {
	console.error(`Pack verification FAILED for ${pkg.name}@${pkg.version}:`);
	for (const e of errors) {
		console.error(`  - ${e}`);
	}
	process.exit(1);
}

console.log(
	`Pack OK: ${pkg.name}@${pkg.version} ships ${files.length} files; ` +
		`web bundle + types ("${typesPath}") present.`,
);

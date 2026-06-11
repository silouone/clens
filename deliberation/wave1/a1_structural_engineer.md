## Agent A1 — Structural Engineer: Wave 1 Analysis

### Key Findings

**[SERIOUS] The analytics-summary.jsonl is a derived cache with no invalidation contract**

The file `.clens/analytics-summary.jsonl` is written during `distill` (via `writeAnalyticsSummary`) and read by every analytics API call. The web dashboard's entire Usage and Insights pages depend exclusively on this file. The problem: the `distillCommand` in the CLI writes to it, and the web server's `commands.ts` also calls `distill()` but does NOT call `writeAnalyticsSummary` — it only calls `rebuildWorkUnitIndex`. This means sessions distilled from the web UI never populate the analytics-summary cache. The analytics pages will show stale or zero data if the user distills sessions through the browser rather than the CLI.

- Alternative: Extract a `persistDistillResult(result, ownerDir)` helper that writes the JSON, analytics-summary, and work-unit-index atomically, and call it from both code paths.

**[SERIOUS] The web package imports @clens/cli source paths directly, not the package boundary**

`packages/web/src/server/routes/sessions.ts` contains `import { ... } from "@clens/cli/src/session"` and similar deep path imports throughout the server routes. These are not going through the package's declared exports — they are reaching into internal source paths. Any internal refactor of the CLI package silently breaks the web server without the TypeScript compiler catching it at the package boundary.

- Alternative: Add an `exports` map to `packages/cli/package.json` that exposes stable sub-paths and update the web server imports.

**[SERIOUS] The distill pipeline is a monolithic 495-LOC synchronous orchestrator — any extractor failure cascades**

`packages/cli/src/distill/index.ts` is a single orchestrator that chains 20+ extractors sequentially. If any extractor throws, the entire distill fails and nothing is saved. The git-diff extractor is an async `await` in the middle of the chain, blocking all downstream extractors on a git subprocess.

- Alternative: Wrap each extractor in a try/catch that returns `undefined` on failure, allowing partial but valid distill output.

**[MODERATE] The session list fetches up to 5,000 sessions synchronously on every page load**

`packages/web/src/client/lib/stores.ts` calls `GET /api/sessions?sort=-start_time&limit=5000` unconditionally. The server reads every JSONL file's first and last lines plus full `_links.jsonl` scan per session. No server-side cache.

- Alternative: Cache the session list server-side with a 5-second TTL and reduce the client default limit to 200 with virtual scrolling.

**[MODERATE] The global multi-repo discovery runs `git rev-parse` per discovered directory on every cold start**

`discoverAndRegisterProjects()` spawns `git rev-parse` for every discovered `.clens` directory synchronously at web server startup.

- Alternative: Read existing registry first, only re-run discovery if older than 1 hour or with explicit `--refresh`.

**[MODERATE] The `buildSessionMap` rebuilds on every session detail request**

`resolveProjectDir` calls `buildSessionMap(projects)` with N `readdirSync` calls on every request.

- Alternative: Build the map once at route factory creation, invalidate on SSE distill_complete.

**[MINOR] v0.2.1 has never been published to npm despite being production-ready**

Users get v0.2.0 which lacks the web dashboard command entirely.

- Alternative: Publish v0.2.1 immediately.

### Proposals

1. Fix the `persistDistillResult` split (analytics-summary missing from web path) — 30 minutes
2. Stabilize the CLI/web package boundary with explicit exports — 1-2 hours
3. Publish v0.2.1 with the web dashboard as its flagship feature — 1 hour

### Priority Ranking

1. Fix the `persistDistillResult` data integrity gap
2. Stabilize the package boundary
3. Publish v0.2.1

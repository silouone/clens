---
id: clens-005-hermetic-global-tests
type: chore
status: in-progress
priority: 1
created: 2026-07-15
attempts: [{"runId":"clens-005-hermetic-global-tests-1784136713704","branch":"adw/clens-005-hermetic-global-tests","workspace":"/Users/silouane/adw-factory/runs/clens-005-hermetic-global-tests-1784136713704/workspace","outcome":"blocked"}]
---
# Make the global-registry tests hermetic (stop scanning the real ~/.clens)

`packages/cli/src/session/registry.ts` hardcodes the global dir as
`${homedir()}/.clens` (line 9, plus a direct `homedir()` use around line
163). `test/global-read.test.ts` and `test/session-registry.test.ts`
register their fixture projects into the REAL machine registry, so:

- `listGlobalSessions()` in tests scans every real registered project
  (35 on this machine today) — the two scanning tests take 35s+ against
  bun's 5s timeout and fail on any machine with a lived-in registry.
  Measured: the 9 tests of global-read.test.ts alone took 515s.
- Tests write fixture entries and backup files into the user's real
  `~/.clens` (a `projects.json.bak-*` dropping is sitting there now), and
  a crashed test run leaves fixture projects registered for real.

## What to do

- In `registry.ts`, resolve the global dir through ONE seam that honors an
  env override: `CLENS_GLOBAL_DIR` (absolute path; when unset, the default
  stays exactly `${homedir()}/.clens`). Route every `homedir()` use in the
  module through that resolution.
- In both test files: `beforeEach` create a fresh temp dir (under
  `tmpdir()`) and set `process.env.CLENS_GLOBAL_DIR` to it; `afterEach`
  restore the previous value and remove the temp dir. The tests must never
  read or write the real `~/.clens`.
- Grep `packages/cli/src` for other direct `homedir()`/`.clens` joins that
  read the registry or global config and route them through the same seam;
  leave anything unrelated untouched. Keep the diff minimal.

## Acceptance

- From `packages/cli`: `bun test test/global-read.test.ts
  test/session-registry.test.ts` — all pass in a few seconds (no test
  anywhere near the 5s timeout), regardless of the machine's real registry
  contents.
- With `CLENS_GLOBAL_DIR` unset, runtime behavior is unchanged
  (default path identical).
- `bun run lint`, `bun run typecheck`, `bun run test` all green.

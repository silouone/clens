---
id: clens-010-import-codex-autodiscover
type: feat
status: queued
priority: 2
created: 2026-07-23
attempts: [{"runId":"clens-010-import-codex-autodiscover-1784800353334","branch":"adw/clens-010-import-codex-autodiscover","workspace":"/Users/silouane/adw-factory/runs/clens-010-import-codex-autodiscover-1784800353334/workspace","outcome":"blocked","provider":"claude","model":"sonnet"}]
---
# `clens import codex` with no path: auto-discover `~/.codex/sessions/`

## Grounding (read the existing importer in-repo)

The explicit-path importer already shipped (clens-007): `clens import codex
<rollout-file|dir>`. This ticket ships the **auto-discover half** — the codex
sessions live at `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Read the existing
implementation before planning: `packages/cli/src/commands/import.ts` (the
subcommand + the `Missing rollout path` guard), the recursive discovery it uses
(`resolveRolloutFiles` / `collectRollouts`), and `packages/cli/test/import-command.test.ts`.
(The design note `specs/codex-rollout-import.md` is a local, gitignored doc — not
in this checkout; everything you need is in the code above and this ticket.)

## Feature

Today `clens import codex` with **no positional path** throws
`"Missing rollout path."` (`packages/cli/src/commands/import.ts`, the
`if (!args.inputPath)` guard). Instead, when the path is omitted, default to the
Codex sessions directory and import every `rollout-*.jsonl` under it:

- Resolve the default dir as `$CODEX_HOME/sessions` if `CODEX_HOME` is set, else
  `~/.codex/sessions` (the spec's canonical location,
  `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`).
- Reuse the existing recursive discovery (`resolveRolloutFiles` /
  `collectRollouts`) and the existing "no files found" message unchanged.
- If the default dir does not exist, emit a clear message (not a stack trace).
- An **explicit** path argument keeps its exact current behavior (regression).

## Why the env seam matters (hermetic tests)

Read the default dir through an env-injectable seam (`CODEX_HOME`) rather than
hard-coding `os.homedir()`, so the tests are hermetic — mirroring the repo's
existing hermeticity practice (clens-005). Tests point `CODEX_HOME` at a temp
fixture dir.

## Done looks like

1. `clens import codex` (no arg) resolves the default dir (env-overridable) and
   imports every rollout under it — same output as the explicit-dir path.
2. No-arg + absent default dir → a clear, friendly message, no crash.
3. Explicit-path behavior is byte-identical (regression test).
4. Help/usage text mentions the no-arg default.

Build tests-first against the plan, then harden coverage (the three cases above +
the explicit-path regression).

## Gate

`bun run lint && bun run typecheck && bun run test` all green.

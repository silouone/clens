---
id: clens-012-list-limit-flag
type: feat
status: queued
priority: 2
created: 2026-07-23
caps: { minutes: 45, turns: 300 }
attempts: []
---
# `clens list --limit <n>`: show only the N most recent sessions

## Feature

Add a value-taking `--limit <n>` flag to the existing `clens list` command that
truncates the output to the **N newest** sessions — for both the table view and
the `--json` array. Sessions are already sorted newest-first, so this is a
validated integer parse + a single slice + a footer tweak.

## Grounding (all in `packages/cli`, present on main — read before planning)

- `src/commands/list.ts` — `listCommand({ projectDir, json, global })`: add an
  optional `limit?: number`; slice `sessions` to the first `limit` entries before
  BOTH the `--json` branch and the table render; adjust the footer to read
  "showing N of M" when a limit is applied. Newest-first order is guaranteed by
  `src/session/read.ts` (local) and `src/session/global-read.ts` (global), so
  `--limit` composes with `--global` and `--json` for free.
- `src/cli.ts` — the `list` handler: extract the `--limit` value from the raw args
  using the SAME pattern the `--port` flag uses; register `--limit` in the
  `list` entry of `VALID_FLAGS_BY_COMMAND` AND in the `VALUE_FLAGS` set (so its
  value isn't mis-parsed as an unknown flag); add one help-text line.

## Semantics (fail fast)

- `--limit 0`, a negative, or non-numeric (`--limit abc`) → a descriptive error
  and a non-zero exit (e.g. `--limit must be a positive integer, got "abc"`).
- missing value → the same descriptive error.
- `limit >= session count` → show all (no error).

## Done looks like

1. `clens list --limit 2` → header + the 2 newest rows + footer "showing 2 of M".
2. `clens list --json --limit 2` → a JSON array of length 2 (the 2 newest).
3. `--limit 0` / `--limit abc` / missing value → non-zero exit + descriptive msg.
4. `--limit 99` with 3 sessions → all 3.

Build tests-first, then harden. `test/cli.test.ts` already has the `runCli`
harness + a `describe("cli list")` block writing inline fixture sessions to
`.clens/sessions`; give fixtures distinct start times so the tests assert the
*newest* N are kept. Hermetic — no new fixture files.

## Gate

`bun run lint && bun run typecheck && bun run test` all green.

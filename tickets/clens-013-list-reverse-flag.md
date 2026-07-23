---
id: clens-013-list-reverse-flag
type: feat
status: queued
priority: 2
created: 2026-07-23
caps: { minutes: 40, turns: 250 }
attempts: []
---
# `clens list --reverse`: list sessions oldest-first

## Feature (small + self-contained)

`clens list` prints sessions **newest-first**. Add a boolean `--reverse` flag
that flips the order to **oldest-first**, for both the table view and the
`--json` array. It composes with `--global` and `--json` unchanged.

## Grounding (present on main, `packages/cli`)

- `src/commands/list.ts` — `listCommand({ projectDir, json, global })`: add an
  optional `reverse?: boolean`; after `sessions` is fetched (already newest-first,
  guaranteed by `src/session/read.ts` / `global-read.ts`), reverse the array when
  the flag is set, BEFORE the `--json` branch and the table render. Nothing else
  changes.
- `src/cli.ts` — the `list` handler: read the boolean `--reverse` from the raw
  args (same pattern as the existing `--global`/`--json` boolean flags) and pass
  it; add `"--reverse"` to the `list` entry of `VALID_FLAGS_BY_COMMAND`. It takes
  no value, so it does NOT go in `VALUE_FLAGS`. Add one help-text line.

## Done looks like

1. `clens list --reverse` → the same rows, oldest-first (footer count unchanged).
2. `clens list --json --reverse` → the JSON array in reversed (oldest-first) order.
3. `clens list` (no flag) → byte-identical to today (newest-first).
4. Empty session list + `--reverse` → still prints `No sessions found.`, exit 0.

## Scope discipline

This is intentionally small: a boolean flag + an array reversal. Do NOT add
sorting keys, other flags, or refactors. Build tests-first (the 4 cases above),
then a light coverage pass. `test/cli.test.ts` has a `runCli` harness + a
`describe("cli list")` block writing inline fixtures to `.clens/sessions` with
distinct start times — reuse it; hermetic, no new fixture files.

## Gate

`bun run lint && bun run typecheck && bun run test` all green.

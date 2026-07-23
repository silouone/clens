---
id: clens-009-edits-highlight-mismatch
type: bug
status: done
priority: 2
created: 2026-07-23
attempts: [{"runId":"clens-009-edits-highlight-mismatch-1784800379163","branch":"adw/clens-009-edits-highlight-mismatch","workspace":"/Users/silouane/adw-factory/runs/clens-009-edits-highlight-mismatch-1784800379163/workspace","outcome":"in-review","pr":"https://github.com/silouone/clens/pull/18","provider":"claude","model":"sonnet"}]
---
# TUI Edits tab: the highlighted file is not the file Enter opens

## Symptom (reproducible)

In the session TUI's **Edits** tab (directory-grouped view — the default), the
inverse-video highlight sits on one file while pressing **Enter** opens a
*different* file. It misfires whenever a subdirectory's files interleave with a
parent directory's files in the flat sort order — which is the common case.

## Root cause (two different index spaces over the same `editFileIndex`)

- **Selection** — `getEditsFileList` (`packages/cli/src/commands/tui-state.ts`)
  sorts the files FLAT by **absolute** `file_path.localeCompare`, and Enter opens
  `files[state.editFileIndex]` (the "enter" case in the same file). Up/Down move
  `editFileIndex` over this flat list.
- **Display** — `groupFilesByDirectory`
  (`packages/cli/src/commands/tui-formatters.ts`) re-sorts by **relative** path,
  **groups by directory**, then highlights the entry whose grouped position
  (`fileIdx = baseIdx + i`, via cumulative `groupOffsets`) equals the passed
  `highlightIndex` (which the renderer wires to `state.editFileIndex`).

The grouped display order ≠ the flat selection order, so the highlighted line and
`files[editFileIndex]` name different files.

## Concrete repro

Three files whose flat-absolute sort is `[a.ts, lib/b.ts, z.ts]` (indices 0,1,2):
`/proj/src/a.ts`, `/proj/src/lib/b.ts`, `/proj/src/z.ts`. Directory grouping
renders them `a.ts, z.ts` (dir `.`) then `b.ts` (dir `lib`) → display indices
`a.ts=0, z.ts=1, b.ts=2`.

- `editFileIndex = 1` → **Enter opens `lib/b.ts`**, but the display **highlights
  `z.ts`**.
- `editFileIndex = 2` → **Enter opens `z.ts`**, but the display **highlights
  `b.ts`**.

## Expected behavior

The highlighted line MUST be the file Enter opens — i.e. the file at
`files[editFileIndex]` in the selection (flat) order, whatever the display
grouping. Fix so the two agree.

## Notes for the fix

- `groupFilesByAgent` (same file) shares the identical cumulative-offset pattern
  over the same `editFileIndex` and has the same latent defect — fix both.
- These formatters have **zero** existing test coverage, so a regression test that
  asserts "the highlighted entry == `files[highlightIndex]`" fails cleanly today
  (behavioral only — `lint` and `typecheck` stay green).

## Gate

`bun run lint && bun run typecheck && bun run test` all green, including the new
regression test that provably went red before the fix.

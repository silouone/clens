---
id: clens-011-fmtduration-hours
type: bug
status: in-progress
priority: 2
created: 2026-07-23
caps: { minutes: 45, turns: 300 }
attempts: []
---
# `fmtDuration` never renders hours — a 2h session prints "120m"

## Symptom (reproducible)

`fmtDuration` (`packages/cli/src/commands/format-helpers.ts`) formats a duration
as `"Xm[YYs]"` or `"Xs"` but **never renders hours**. A 2-hour session
(`7200000` ms) prints **`"120m"`**; a 90-minute session prints `"90m"`. Long
sessions and long edit-chains therefore show inflated minute counts across
`clens report` and `clens edits` (callers: `report.ts`, `edits.ts`,
`distill.ts`).

## Expected

Roll minutes over 60 into an hours component, consistent with the sibling
formatter `formatDuration` in `packages/cli/src/utils.ts` (which already emits an
`Xh…` form). E.g. `7200000` ms → `"2h0m"` (match the sibling's shape); sub-hour
and sub-minute durations are unchanged (`"5m03s"`, `"42s"`).

## Root cause

`fmtDuration` computes `minutes = Math.floor(totalSeconds / 60)` and stops there —
there is no `hours = Math.floor(minutes / 60)` step (unlike `utils.ts`
`formatDuration`, which has it).

## Notes for the fix

- Keep the existing sub-hour output byte-identical (minutes/seconds behavior
  unchanged); only add the hours rollover at ≥ 60 minutes.
- `fmtDuration` has **zero** existing test coverage, so a regression test
  asserting the ≥1h case (e.g. `fmtDuration(7200000) === "2h0m"`) fails cleanly
  today (behavioral only — `lint`/`typecheck` stay green).

## Gate

`bun run lint && bun run typecheck && bun run test` all green, including the new
regression test that provably went red before the fix.

---
id: clens-001-lint-errors
type: chore
status: done
priority: 1
created: 2026-07-15
attempts: [{"runId":"clens-001-lint-errors-1784130060111","branch":"adw/clens-001-lint-errors","workspace":"/Users/silouane/adw-factory/runs/clens-001-lint-errors-1784130060111/workspace","outcome":"blocked"}]
---
# Make `bun run lint` exit 0 (fix the 19 biome errors)

`bun run lint` currently fails at the repo root: 2 errors in `packages/cli`
and 17 errors in `packages/web`, all `assist/source/organizeImports`
(unsorted imports/exports), all safe-fixable.

## What to do

- Fix every biome ERROR in both packages so `bun run lint` exits 0 from the
  repo root. `bunx biome check --write` applies the safe fixes; scope your
  changes to the error diagnostics.
- Keep the diff minimal: do NOT mass-fix warnings or infos — separate
  tickets cover those (clens-002, clens-003).
- Do not change `biome.json`, disable rules, or add `biome-ignore` comments
  — every one of these errors has a clean mechanical fix.

## Acceptance

- `bun run lint` exits 0.
- `bun run typecheck` and `bun run test` stay green.
- No behavioral changes — import/export reordering only.

## Resolution (operator, 2026-07-15)

Retired as superseded: the full scope (all 19 biome errors, both packages)
was delivered by PR #13 (clens-005, merged 2026-07-15) — the hermeticity
fix un-masked the lint chain and the agent cleared the errors in its
repair round. Attempt 1's blocked outcome stands as recorded data
(non-hermetic global tests, the clens-005 root cause).

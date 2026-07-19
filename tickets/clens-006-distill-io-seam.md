---
id: clens-006-distill-io-seam
type: chore
status: in-progress
priority: 2
created: 2026-07-19
caps: { minutes: 45, turns: 300 }
attempts: [{"runId":"clens-006-distill-io-seam-1784470261685","branch":"adw/clens-006-distill-io-seam","workspace":"/work/remote","outcome":"in-review","pr":"https://github.com/silouone/clens/pull/17"}]
---
# Lift the last fs reads out of the distill layer (injected readers)

`packages/cli/src/distill/index.ts` opens with a TODO naming itself the last
I/O leak in the distill layer: the module imports `existsSync` + and
`readFileSync` from `node:fs` and reads files directly in two places:

1. `readClensConfig` (~lines 78–92): reads `<projectDir>/.clens/config.json`.
2. The plan-drift spec read inside `distill()` (~lines 342–350): after
   `detectSpecRef(allPrompts)` picks a spec path out of the session's own
   prompts, the module `existsSync` + `readFileSync`s
   `<projectDir>/<specRef>` and feeds it to `computePlanDrift`.

Because `specRef` is only known mid-distill (it is detected from prompts the
function itself extracts), the caller cannot pre-read the spec — so the seam
must be an **injected reader**, not pre-passed content.

## Task

Remove the `node:fs` import from `packages/cli/src/distill/index.ts` by
lifting both read sites behind injected function parameters (e.g. a
`readTextFile: (path: string) => string | undefined` — file-missing and
read/parse errors both map to `undefined`, preserving today's behavior).
Callers at the edge (every call site of `distill()` and, if exported
separately, `readClensConfig` — find them all; `packages/cli/src/commands/
distill.ts` and `packages/cli/src/commands/what.ts` are two known ones)
supply the real fs-backed default so CLI behavior is byte-identical.

Rules:

- Behavior must be unchanged: same outputs for the same sessions, config
  handling identical (missing/malformed → `undefined`), plan-drift identical
  (missing spec file → no `plan_drift`).
- Keep the injection surface minimal — one reader parameter (or one small
  options field) is enough; do NOT redesign `DistillOptions` beyond it, and
  do NOT touch the other `projectDir`-consuming extractors (git/diff
  attribution etc. are out of scope).
- Delete the TODO comment at the top of the file once it is true.
- Add/adjust unit tests so both seams are covered with in-memory fakes (a
  fake reader returning config JSON / spec content), including the
  missing-file and malformed-config paths.
- Match the existing code style (pure functions, no classes, biome-clean).

## Verify

- `grep -n "node:fs" packages/cli/src/distill/index.ts` → no matches.
- `bun run lint`, `bun run typecheck`, `bun run test` all green at the root.

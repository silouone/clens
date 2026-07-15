---
id: clens-003-web-lint-warnings
type: chore
status: in-review
priority: 2
created: 2026-07-15
caps: { minutes: 480, turns: 400 }
attempts: [{"runId":"clens-003-web-lint-warnings-1784143429132","branch":"adw/clens-003-web-lint-warnings","workspace":"/Users/silouane/adw-factory/runs/clens-003-web-lint-warnings-1784143429132/workspace","outcome":"in-review","pr":"https://github.com/silouone/clens/pull/15"}]
---
# Biome-clean packages/web (zero warnings and infos)

After clens-001, `packages/web` still carries ~51 biome warnings and ~35
infos: `style/useTemplate`, `performance/noAccumulatingSpread`,
`style/noNonNullAssertion`, `noUnusedImports`, `noUnusedVariables`, and
`complexity/useLiteralKeys`.

## What to do

- Bring `bunx biome check packages/web` (run from the repo root, or
  `bunx biome check .` from `packages/web`) to ZERO diagnostics — no
  errors, warnings, or infos.
- Apply safe fixes first (`--write`), then fix the rest by hand:
  - `noAccumulatingSpread`: replace spread-in-reduce with mutation of a
    local accumulator — keep the function's observable behavior identical.
  - `useLiteralKeys`: switch bracket access with constant string keys to
    dot access.
- Do not change `biome.json` or weaken rules. A targeted
  `// biome-ignore <rule>: <reason>` is allowed ONLY where a real fix would
  change public behavior — expect zero or near-zero of these.
- Touch only `packages/web`.

## Acceptance

- `bunx biome check packages/web` reports no diagnostics at any severity.
- `bun run lint`, `bun run typecheck`, `bun run test` all green.

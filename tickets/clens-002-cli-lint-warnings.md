---
id: clens-002-cli-lint-warnings
type: chore
status: in-progress
priority: 2
created: 2026-07-15
caps: { minutes: 480, turns: 400 }
attempts: [{"runId":"clens-002-cli-lint-warnings-1784140659034","branch":"adw/clens-002-cli-lint-warnings","workspace":"/Users/silouane/adw-factory/runs/clens-002-cli-lint-warnings-1784140659034/workspace","outcome":"blocked"},{"runId":"clens-002-cli-lint-warnings-1784141802037","branch":"adw/clens-002-cli-lint-warnings-2","workspace":"/Users/silouane/adw-factory/runs/clens-002-cli-lint-warnings-1784141802037/workspace","outcome":"in-review","pr":"https://github.com/silouone/clens/pull/14"}]
---
# Biome-clean packages/cli (zero warnings and infos)

After clens-001, `packages/cli` still carries ~82 biome warnings and ~27
infos: `noUnusedImports`, `noUnusedVariables`, `style/useTemplate`,
`style/noNonNullAssertion` (mostly in tests), and
`performance/noAccumulatingSpread`.

## What to do

- Bring `bunx biome check packages/cli` (run from the repo root, or
  `bunx biome check .` from `packages/cli`) to ZERO diagnostics — no
  errors, warnings, or infos.
- Apply safe fixes first (`--write`), then fix the rest by hand:
  - `noAccumulatingSpread`: replace spread-in-reduce with mutation of a
    local accumulator — keep the function's observable behavior identical.
  - `noNonNullAssertion` in tests: prefer explicit narrowing (e.g. throw or
    `expect(...).toBeDefined()` + guard) over `!`.
- Do not change `biome.json` or weaken rules. A targeted
  `// biome-ignore <rule>: <reason>` is allowed ONLY where a real fix would
  change public behavior — expect zero or near-zero of these.
- Touch only `packages/cli`.

## Acceptance

- `bunx biome check packages/cli` reports no diagnostics at any severity.
- `bun run lint`, `bun run typecheck`, `bun run test` all green.

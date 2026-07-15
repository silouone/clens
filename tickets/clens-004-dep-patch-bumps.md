---
id: clens-004-dep-patch-bumps
type: chore
status: in-review
priority: 2
created: 2026-07-15
attempts: [{"runId":"clens-004-dep-patch-bumps-1784144700507","branch":"adw/clens-004-dep-patch-bumps","workspace":"/Users/silouane/adw-factory/runs/clens-004-dep-patch-bumps-1784144700507/workspace","outcome":"in-review","pr":"https://github.com/silouone/clens/pull/16"}]
---
# Patch-level dependency bumps (biome, autoprefixer)

`bun outdated` shows two patch updates within the existing semver ranges:

- `packages/cli`: `@biomejs/biome` 2.5.3 → 2.5.4 (dev)
- `packages/web`: `autoprefixer` 10.5.2 → 10.5.3 (dev)

## What to do

- Bump both packages to the listed patch versions and update the lockfile
  (`bun update @biomejs/biome` in `packages/cli`, `bun update autoprefixer`
  in `packages/web`, or edit `package.json` + `bun install`).
- Patch-level ONLY — do not touch the major/minor updates `bun outdated`
  also lists (typescript, vite, tailwindcss, lucide-solid, @solidjs/router,
  undici-types).
- If the biome patch surfaces new lint diagnostics, fix them in the same
  change so the gates stay green — mention it in your summary.

## Acceptance

- `packages/cli/package.json` has `@biomejs/biome` at 2.5.4;
  `packages/web/package.json` has `autoprefixer` at 10.5.3; `bun.lock`
  updated accordingly.
- `bun run lint`, `bun run typecheck`, `bun run test` all green.

# Contributing to cLens

Thanks for your interest in contributing to cLens!

cLens is a Bun monorepo with two packages:

- **`packages/cli`** — the published `clens` package (CLI, hooks, distillers). This is what `npm install -g clens` installs.
- **`packages/web`** — `@clens/web`, the private web dashboard (SolidJS + Hono) served by `clens web`. Not published to npm; it ships bundled inside the CLI package.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0 (runtime, bundler, and test runner)

## Development Setup

1. Clone the repository.
2. Install all workspace dependencies from the repo root: `bun install`
3. Run the test suite: `bun test`

`bun install` installs dependencies for every workspace; you do not need to install per package.

## Project Structure

```
packages/
  cli/                — the published `clens` package
    src/
      cli.ts          — CLI entry point (thin dispatch)
      hook.ts         — universal hook handler (JSONL append, ~2ms budget)
      types/          — type definitions (leaf modules)
      capture/        — hook-time I/O (2ms budget)
      session/        — CLI-time session I/O (read/clean/export/transcript)
      distill/        — pure extractors (20+ extractors + orchestrator)
      commands/       — one file per CLI command
    test/             — unit + e2e tests (mirrors src/)
  web/                — `@clens/web` dashboard (private, SolidJS + Hono)
    src/
      client/         — SolidJS UI (pages, components, charts, stores)
      server/         — Hono API server
    test/             — api / gate / integration / unit tests
specs/                — implementation plans and brainstorms
```

## Commands

Run these from the repo root. Each delegates to the relevant workspace(s).

| Command | What it does |
|---|---|
| `bun test` | Run all tests (CLI + web API) |
| `bun run typecheck` | TypeScript type checking across both packages |
| `bun run lint` | Lint with Biome (CLI + web) |
| `bun run build` | Build both packages |

### Targeting a single package

| Command | What it does |
|---|---|
| `bun run test:cli` / `bun run test:web` | Test only the CLI / web package |
| `bun run lint:cli` / `bun run lint:web` | Lint only the CLI / web package |
| `bun run build:cli` / `bun run build:web` | Build only the CLI / web package |

You can also work inside a package directly, e.g. `bun run --filter clens lint:fix` to auto-fix CLI lint violations, or `bun run --filter @clens/web typecheck`.

### Building the CLI binary

The CLI compiles to standalone binaries:

```sh
bun run --filter clens build:bin
```

Note: `bun run build` (the JS bundle) is **not** the same as the live compiled binary. To exercise the binary locally you must run `build:bin` and use the produced `packages/cli/bin/clens`.

## Web dashboard development

The dashboard is a SolidJS client served by a Hono API.

Run both together from the repo root with one supervised command:

```sh
bun run dev          # supervised launcher: API + Vite dev server, auto-ports, auto-open
```

`bun run dev` (`scripts/dev.ts`) is the **sole port authority** — it allocates a free
API port and a free web port, wires the Vite proxy to the API it actually bound
(`CLENS_API_PORT`), and reaps the **entire process group** (including Vite's `esbuild`
daemons) on Ctrl-C, so nothing is orphaned. Useful flags:

```sh
bun run dev --local         # current project only (default is global)
bun run dev --no-open       # do not auto-open a browser
bun run dev --api-port N --web-port N   # seed ports (still auto-bumps if busy)
bun run dev:clean           # clean stale orphan dev processes, then launch
bun run dev:doctor          # report + clean orphaned dev processes; flags unkillable zombies (reboot to clear)
```

If you'd rather run the halves in separate terminals (escape hatches, still supported):

```sh
bun run dev:api          # Hono API, current project only
bun run dev:api:global   # Hono API across all registered projects
bun run dev:web          # Vite dev server (SolidJS client)
```

To run the dashboard the way end users do (against the compiled CLI):

```sh
clens web                # serves on http://localhost:3700, opens a browser
clens web --port 4000    # custom port
clens web --no-open      # do not auto-open a browser
clens web --global       # aggregate sessions across all registered projects
```

### UI styling

The dashboard follows the INSTRUMENT design system (IBM Plex Sans/Mono, square corners, 1px hairlines, a single signal-green accent). Design tokens live in `packages/web/src/client/index.css` and `tailwind.config.js` and are guarded by `packages/web/test/gate/design-tokens.test.ts` — keep token changes in sync or that gate will fail.

### UI review gate

There is no client-side component-test harness. Client UI changes are validated by the **web-review** gate (it starts the server and drives the dashboard in a browser). Run it before opening a PR that touches the web client, in addition to `bun run test:web` for the API layer.

## Pull Request Guidelines

- Branch from `main`.
- Keep PRs focused — one feature or fix per PR.
- All tests must pass: `bun test`.
- TypeScript must compile cleanly: `bun run typecheck`.
- Code must pass lint: `bun run lint`.
- Run `bun run --filter clens lint:fix` (and/or the web equivalent) before committing.
- For web client changes, run the web-review UI gate.

## Code Style

Code style is enforced by [Biome](https://biomejs.dev) (config in `biome.json`). Run `lint:fix` before committing to auto-fix formatting and lint issues. The codebase favors a functional style: immutable data, pure functions, and composition.

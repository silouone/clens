# Contributing to cLens

Thank you for your interest in contributing to clens!

## Prerequisites

- [Bun](https://bun.sh) >= 1.0

## Development Setup

1. Clone the repository
2. Install dependencies: `bun install`
3. Run tests: `bun test`

## Project Structure

```
src/          — Source code (CLI, hooks, format definitions, session management)
test/         — Test files (mirrors src/ structure)
.clens/ — Local session data directory (not committed)
specs/        — Implementation plans
```

## Development Commands

- `bun test` — Run all tests
- `bun run typecheck` — TypeScript type checking
- `bun run lint` — Lint with Biome
- `bun run lint:fix` — Auto-fix lint violations
- `bun run build` — Compile binary

## Pull Request Guidelines

- Branch from `main`
- Keep PRs focused — one feature or fix per PR
- All tests must pass (`bun test`)
- TypeScript must compile cleanly (`bun run typecheck`)
- Code must pass lint (`bun run lint`)
- Run `bun run lint:fix` before committing

## Code Style

Code style is enforced by [Biome](https://biomejs.dev). Run `bun run lint:fix` before committing to auto-fix formatting and lint issues.
